import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { getObject } from '@/lib/s3';
import { sectionKey } from '@/lib/bom/parse';
import { checkPieces, type SectionStd } from '@/lib/bom/checks';
import { resolveSection } from '@/lib/costing/mixedBom';
import type { PoBomPiece, PoExtraction } from '@/lib/po/fields';
import { extractFromSheet } from '@/modules/costing/server/extract';
import { confirmBom, importBom, previewBom } from '@/modules/bom/server/mutations';
import { generateIndent } from '@/modules/rm/server/indents';

// M15 step 4: on Confirm the indent job runs BOM -> drawing -> indent by itself and records how far
// it got (orders.job_status / job_note). It never guesses: any gap stops it with the reason, and the
// existing BOM / RM Indent tabs take over from there. "Re-run" on the PO tab runs it again.

export type JobStatus = 'ON_HOLD' | 'BOM_NEEDED' | 'BOM_FLAGS' | 'DRAWING_PENDING' | 'INDENT_DRAFTED' | 'FAILED';
export interface JobResult {
  status: JobStatus;
  note: string;
  steps: string[];
}

export const HOLD_LABEL = 'BOM/drawing on hold – awaiting client confirmation';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const SHEET_RE = /\.(xlsx|xlsm|xls|csv)$/i;

interface PieceIn {
  markNo: string | null;
  description: string | null;
  section: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  sets: number | null;
  totalQty: number | null;
  unitWtKg: number | null;
  structure: string | null;
}

/** A BOM upload made from pieces read by the job (mixed workbook or the PO's own BOM table). Same checks as an xlsx import. */
async function saveBomPieces(orderId: number, pieces: PieceIn[], meta: { fileName: string; source: string; s3Key: string | null; note: string }, user: AuthUser) {
  const sectionRows = await prisma.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true, approved: true } });
  const master = new Map<string, SectionStd>(sectionRows.map((s) => [s.sectionKey, { kgPerM: s.kgPerM.toNumber(), approved: s.approved }]));
  const gtp = Object.fromEntries(sectionRows.map((s) => [s.sectionKey, s.kgPerM.toNumber()]));
  let rowNo = 0;
  const rows = pieces.map((p) => {
    const unitKgm = p.unitWtKg && p.lengthMm ? p.unitWtKg / (p.lengthMm / 1000) : null;
    const key = resolveSection(sectionKey(p.section), unitKgm, gtp).key;
    const kgm = (key ? master.get(key)?.kgPerM : undefined) ?? (unitKgm ? r3(unitKgm) : null);
    const total = p.totalQty ?? (p.qtyPerSet !== null && p.sets !== null ? r3(p.qtyPerSet * p.sets) : null);
    return {
      rowNo: ++rowNo,
      markNo: p.markNo,
      description: p.description,
      section: p.section,
      sectionKey: key,
      lengthMm: p.lengthMm,
      qtyPerSet: p.qtyPerSet,
      sets: p.sets,
      totalQty: total,
      kgPerM: kgm,
      unitWtKg: kgm && p.lengthMm ? r3((kgm * p.lengthMm) / 1000) : p.unitWtKg,
      totalWtKg: kgm && p.lengthMm && total !== null ? r3((kgm * p.lengthMm * total) / 1000) : null,
      raw: { structure: p.structure, source: meta.source } as Prisma.InputJsonValue,
    };
  });
  const flags = checkPieces(rows, master);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
    const upload = await tx.bomUpload.create({
      data: {
        orderId,
        fileName: meta.fileName.slice(0, 255),
        s3Key: meta.s3Key,
        source: meta.source,
        columnMap: { source: meta.source, note: meta.note } as Prisma.InputJsonValue,
        rowCount: rows.length,
        uploadedById: user.id,
        uploadedByName: user.name,
      },
    });
    await tx.bomPiece.createMany({ data: rows.map((r, i) => ({ ...r, uploadId: upload.id, orderId, ...flags[i] })) });
    await tx.editLog.create({
      data: { tableName: 'bom_uploads', recordId: upload.id, fieldName: 'ALL_FIELDS', oldValue: 'NONE (New Record)', newValue: JSON.stringify({ orderId, source: meta.source, fileName: meta.fileName, rows: rows.length, note: meta.note }), ...auditUser(user) },
    });
    return { uploadId: upload.id, rows: rows.length, flagged: flags.filter((f) => f.issues).length };
  }, { timeout: 60_000 });
}

/** Mixed (structure-wise) BOM workbook -> pieces with each structure's set count. Null if not that layout. */
function piecesFromMixedSheet(buffer: Buffer): { pieces: PieceIn[]; note: string } | null {
  let res;
  try {
    res = extractFromSheet(buffer);
  } catch {
    return null;
  }
  if (!res.groups?.length) return null;
  const multi = res.groups.length > 1;
  const pieces: PieceIn[] = [];
  res.groups.forEach((g, gi) => {
    const sets = g.sets ? Math.ceil(g.sets - 1e-9) : null;
    for (const l of g.lines) {
      if (l.category !== 'STRUCTURE') continue;
      pieces.push({
        markNo: l.markNo ? (multi ? `${gi + 1}-${l.markNo}` : l.markNo) : multi ? `${gi + 1}-R${pieces.length + 1}` : null,
        description: l.description,
        section: l.section,
        lengthMm: l.lengthMm,
        qtyPerSet: l.qtyPerSet,
        sets,
        totalQty: l.qtyPerSet !== null && sets !== null ? r3(l.qtyPerSet * sets) : null,
        unitWtKg: l.unitWtKg,
        structure: g.name,
      });
    }
  });
  return pieces.length ? { pieces, note: res.note } : null;
}

const fromPo = (p: PoBomPiece): PieceIn => ({ ...p });

/**
 * BOM step: bring the client BOM in when the order has one attached and it is not loaded yet.
 * Order of preference: attached BOM workbook, BOM table read from the PO documents. (The quotation
 * BOM is already copied in when the order is created.) Returns what it did.
 */
async function loadBom(orderId: number, user: AuthUser, steps: string[]) {
  const [docs, uploads, order] = await Promise.all([
    prisma.orderDocument.findMany({ where: { orderId, kind: { in: ['BOM', 'DRAWING', 'PO'] } }, orderBy: { id: 'asc' } }),
    prisma.bomUpload.findMany({ where: { orderId }, select: { fileName: true, source: true, status: true } }),
    prisma.order.findUnique({ where: { id: orderId }, select: { poExtract: true } }),
  ]);
  const loaded = new Set(uploads.map((u) => u.fileName));
  // A BOM already marked correct (e.g. a revised BOM uploaded by hand) is never replaced by the PO's own file.
  if (uploads.some((u) => u.status === 'CORRECT')) {
    steps.push('BOM: a BOM is already marked correct, the PO file is not re-loaded.');
    return;
  }
  const sheet = docs.find((d) => d.kind === 'BOM' && SHEET_RE.test(d.fileName));
  if (sheet) {
    if (loaded.has(sheet.fileName)) {
      steps.push(`BOM: ${sheet.fileName} already loaded.`);
      return;
    }
    if (!sheet.s3Key) {
      steps.push(`BOM: ${sheet.fileName} was not stored, upload it on the BOM tab.`);
      return;
    }
    const obj = await getObject(sheet.s3Key);
    if (!obj) throw new UserError(`BOM file ${sheet.fileName} is missing in storage.`);
    const buf = Buffer.from(obj.body);
    const mixed = piecesFromMixedSheet(buf);
    if (mixed) {
      const r = await saveBomPieces(orderId, mixed.pieces, { fileName: sheet.fileName, source: 'PO_BOM_FILE', s3Key: sheet.s3Key, note: mixed.note }, user);
      steps.push(`BOM: ${sheet.fileName} loaded as a structure-wise BOM, ${r.rows} piece rows, ${r.flagged} flagged.`);
      return;
    }
    const preview = previewBom(buf);
    try {
      const r = await importBom(orderId, { name: sheet.fileName, type: sheet.mimeType ?? '', buffer: buf }, { sheet: preview.sheetName, headerRow: preview.headerRow, map: preview.map }, user);
      steps.push(`BOM: ${sheet.fileName} imported (columns auto-mapped), ${r.rows} rows, ${r.flagged} flagged.`);
    } catch (e) {
      steps.push(`BOM: ${sheet.fileName} could not be imported automatically (${(e as Error).message}). Upload it on the BOM tab and map the columns.`);
    }
    return;
  }
  const extract = order?.poExtract as unknown as PoExtraction | null;
  const pieces = extract?.bomPieces ?? [];
  const names = docs.filter((d) => d.kind !== "BOM").map((d) => d.fileName).join("; ");
  const fileName = names ? `BOM read from the PO documents (${names})` : "BOM read from the PO documents";
  if (pieces.length && !uploads.some((u) => u.source === 'PO_COPY')) {
    const r = await saveBomPieces(orderId, pieces.map(fromPo), { fileName, source: 'PO_COPY', s3Key: null, note: 'Piece list read by AI from the PO / drawing. Check it against the drawing.' }, user);
    steps.push(`BOM: ${r.rows} piece rows read from the PO / drawing, ${r.flagged} flagged.`);
    return;
  }
  if (uploads.length) steps.push(`BOM: using the order's current BOM (${uploads.length} version${uploads.length > 1 ? 's' : ''}).`);
}

async function record(orderId: number, result: JobResult, user: AuthUser) {
  const before = await prisma.order.findUnique({ where: { id: orderId }, select: { jobStatus: true } });
  await prisma.order.update({ where: { id: orderId }, data: { jobStatus: result.status, jobNote: [result.note, ...result.steps].join('\n').slice(0, 4000), jobAt: new Date() } });
  await prisma.editLog.create({ data: { tableName: 'orders', recordId: orderId, fieldName: 'job_status', oldValue: before?.jobStatus ?? null, newValue: `${result.status}: ${result.note}`, ...auditUser(user) } });
  return result;
}

/** BOM -> drawing -> indent for one order. Safe to run again; it continues from where it stopped. */
export async function runIndentJob(orderId: number, user: AuthUser): Promise<JobResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, onHold: true, holdReason: true } });
  if (!order) throw new UserError('Order not found.');
  const steps: string[] = [];
  try {
    if (order.onHold) return await record(orderId, { status: 'ON_HOLD', note: `${HOLD_LABEL}${order.holdReason ? `: ${order.holdReason.replace(/\.+$/, '')}` : ''}. Release the hold to continue.`, steps }, user);

    await loadBom(orderId, user, steps);
    const latest = await prisma.bomUpload.findFirst({ where: { orderId }, orderBy: { id: 'desc' }, select: { id: true, status: true, fileName: true } });
    if (!latest) return await record(orderId, { status: 'BOM_NEEDED', note: 'No BOM yet: attach the client BOM on the BOM tab (or with the PO), then re-run.', steps }, user);

    if (latest.status !== 'CORRECT') {
      const [{ flagged }] = await prisma.$queryRaw<{ flagged: number }[]>(Prisma.sql`SELECT count(*)::int AS flagged FROM bom_pieces
        WHERE upload_id = ${latest.id} AND (flag_mark_length OR flag_blank_qty OR flag_kgm OR flag_fractional_sets OR flag_section)`);
      if (flagged > 0) return await record(orderId, { status: 'BOM_FLAGS', note: `BOM "${latest.fileName}" has ${flagged} flagged row(s). Fix them on the BOM tab and mark it ✓ Correct, then re-run.`, steps }, user);
      try {
        await confirmBom(latest.id, '', user);
        steps.push('BOM: no flags, marked ✓ Correct by the indent job.');
      } catch (e) {
        return await record(orderId, { status: 'BOM_FLAGS', note: `BOM could not be confirmed: ${(e as Error).message}`, steps }, user);
      }
    }

    const existing = await prisma.rmIndent.findFirst({ where: { orderId, kind: 'PRIMARY', status: { in: ['DRAFT', 'ISSUED'] }, bomUploadId: latest.id }, select: { indentNo: true, status: true } });
    if (existing) return await record(orderId, { status: 'INDENT_DRAFTED', note: `Indent ${existing.indentNo} (${existing.status.toLowerCase()}) already made from the current BOM.`, steps }, user);

    const ind = await generateIndent(orderId, 'MIXED', 'Made by the indent job when the order was confirmed from the PO copy.', user);
    return await record(orderId, { status: 'INDENT_DRAFTED', note: `Draft indent ${ind.indentNo} made (Mixed: custom + 6 m). Check and issue it on the RM Indent tab.`, steps }, user);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'Unexpected error, see the server log.';
    if (!(e instanceof UserError)) console.error('[indent job]', e);
    return record(orderId, { status: 'FAILED', note: msg, steps }, user);
  }
}

/** Put the order on hold (BOM/drawing awaiting client confirmation). */
export async function setHold(orderId: number, on: boolean, reason: string, user: AuthUser) {
  const why = reason.trim().slice(0, 1000);
  if (on && !why) throw new UserError('Say what the client still has to confirm.');
  const before = await prisma.order.findUnique({ where: { id: orderId }, select: { onHold: true, holdReason: true } });
  if (!before) throw new UserError('Order not found.');
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: on ? { onHold: true, holdReason: why, holdSince: new Date(), holdByName: user.name } : { onHold: false, holdReason: null, holdSince: null, holdByName: null },
    }),
    prisma.editLog.create({
      data: { tableName: 'orders', recordId: orderId, fieldName: 'on_hold', oldValue: before.onHold ? `ON: ${before.holdReason ?? ''}` : 'OFF', newValue: on ? `ON: ${why}` : 'OFF (released)', ...auditUser(user) },
    }),
  ]);
  // Releasing the hold continues the job; setting it records the stop.
  return runIndentJob(orderId, user);
}
