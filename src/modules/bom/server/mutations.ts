import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { archiveFile } from '@/lib/s3';
import { autoMapHeaders, findHeaderRow, parsePieces, sectionKey, toNum, PIECE_FIELDS, type ColumnMap } from '@/lib/bom/parse';
import { checkPieces, type SectionStd } from '@/lib/bom/checks';
import { readWorkbook, sheetCells } from './workbook';
import { EDITABLE_PIECE_FIELDS, type EditablePieceField } from '../columns';

const sql = Prisma.sql;
type Tx = Prisma.TransactionClient;

export interface BomPreview {
  sheets: string[];
  sheetName: string;
  headerRow: number; // 0-based
  headers: string[];
  map: ColumnMap;
  sample: string[][];
  dataRows: number;
}

/** Workbook -> what the mapping step needs: sheets, detected header row, auto-mapped columns, sample rows. */
export function previewBom(buffer: Buffer, sheet?: string | null, headerRowOverride?: number | null): BomPreview {
  const wb = readWorkbook(buffer);
  const { sheetName, cells } = sheetCells(wb, sheet);
  const headerRow =
    headerRowOverride !== null && headerRowOverride !== undefined && headerRowOverride >= 0 && headerRowOverride < cells.length
      ? headerRowOverride
      : findHeaderRow(cells);
  const headers = (cells[headerRow] ?? []).map((c) => String(c ?? '').trim());
  const sample = cells.slice(headerRow + 1, headerRow + 9).map((r) => headers.map((_, i) => String(r?.[i] ?? '')));
  return { sheets: wb.SheetNames, sheetName, headerRow, headers, map: autoMapHeaders(headers), sample, dataRows: Math.max(0, cells.length - headerRow - 1) };
}

async function sectionMaster(tx: Tx | typeof prisma): Promise<Map<string, SectionStd>> {
  const rows = await tx.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true, approved: true } });
  return new Map(rows.map((r) => [r.sectionKey, { kgPerM: r.kgPerM.toNumber(), approved: r.approved }]));
}

/** Only real header names, one per field. */
function cleanMap(map: unknown, headers: string[]): ColumnMap {
  const out: ColumnMap = {};
  const m = (map && typeof map === 'object' ? map : {}) as Record<string, unknown>;
  for (const f of PIECE_FIELDS) {
    const h = typeof m[f] === 'string' ? (m[f] as string) : '';
    if (h && headers.includes(h)) out[f] = h;
  }
  return out;
}

export async function importBom(
  orderId: number,
  file: { name: string; type: string; buffer: Buffer },
  opts: { sheet?: string | null; headerRow?: number | null; map: unknown },
  user: AuthUser,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, poNumber: true } });
  if (!order) throw new UserError('Order not found.');

  const preview = previewBom(file.buffer, opts.sheet, opts.headerRow);
  const map = cleanMap(opts.map, preview.headers);
  if (!map.markNo && !map.section) throw new UserError('Map at least the Mark no or Section column.');
  if (!map.lengthMm) throw new UserError('Map the Length column.');
  if (!map.totalQty && !map.qtyPerSet) throw new UserError('Map a quantity column (Total qty or Qty per set).');

  const { cells } = sheetCells(readWorkbook(file.buffer), preview.sheetName);
  const pieces = parsePieces(cells, preview.headerRow, map);
  if (pieces.length === 0) throw new UserError('No data rows found under the header row.');
  const negativeRows = pieces.filter((p) => p.negative.length > 0);
  if (negativeRows.length) {
    throw new UserError(
      'Negative numbers are not allowed. Fix the sheet and upload again: ' +
        negativeRows.slice(0, 10).map((p) => `row ${p.rowNo} (${p.negative.join(', ')})`).join('; ') +
        (negativeRows.length > 10 ? ` and ${negativeRows.length - 10} more` : ''),
    );
  }

  // Archive first (outside the transaction): a failed upload stops the import with nothing saved.
  const s3Key = await archiveFile(`bom/order-${orderId}`, file.name, file.buffer, file.type);

  return prisma.$transaction(
    async (tx) => {
      // Same lock as confirmBom: a new version and a confirm of the previous one can't interleave.
      await lockOrderRow(tx, orderId);
      const flags = checkPieces(pieces, await sectionMaster(tx));
      const upload = await tx.bomUpload.create({
        data: {
          orderId,
          fileName: file.name.slice(0, 255),
          s3Key,
          sheetName: preview.sheetName,
          columnMap: map as Prisma.InputJsonValue,
          rowCount: pieces.length,
          uploadedById: user.id,
          uploadedByName: user.name,
        },
      });
      await tx.bomPiece.createMany({
        data: pieces.map((p, i) => ({
          uploadId: upload.id,
          orderId,
          rowNo: p.rowNo,
          markNo: p.markNo,
          description: p.description,
          section: p.section,
          sectionKey: p.sectionKey,
          lengthMm: p.lengthMm,
          qtyPerSet: p.qtyPerSet,
          sets: p.sets,
          totalQty: p.totalQty,
          kgPerM: p.kgPerM,
          unitWtKg: p.unitWtKg,
          totalWtKg: p.totalWtKg,
          raw: p.raw as Prisma.InputJsonValue,
          ...flags[i],
        })),
      });
      await tx.editLog.create({
        data: {
          tableName: 'bom_uploads',
          recordId: upload.id,
          fieldName: 'ALL_FIELDS',
          oldValue: 'NONE (New Record)',
          newValue: JSON.stringify({ orderId, poNumber: order.poNumber, fileName: file.name, sheet: preview.sheetName, rows: pieces.length, map }),
          ...auditUser(user),
        },
      });
      return { uploadId: upload.id, rows: pieces.length, flagged: flags.filter((f) => f.issues).length };
    },
    { timeout: 60_000 },
  );
}

/** Re-run the checks over a whole upload (mark/length clashes depend on other rows) and save changed flags. */
export async function recheckUpload(tx: Tx, uploadId: number) {
  const rows = await tx.bomPiece.findMany({
    where: { uploadId },
    select: { id: true, markNo: true, sectionKey: true, lengthMm: true, qtyPerSet: true, sets: true, totalQty: true, kgPerM: true, unitWtKg: true },
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return;
  const n = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
  const flags = checkPieces(
    rows.map((r) => ({ ...r, qtyPerSet: n(r.qtyPerSet), sets: n(r.sets), totalQty: n(r.totalQty), kgPerM: n(r.kgPerM), unitWtKg: n(r.unitWtKg) })),
    await sectionMaster(tx),
  );
  // One UPDATE for the whole upload.
  const values = Prisma.join(
    rows.map((r, i) => {
      const f = flags[i];
      return sql`(${r.id}::int, ${f.flagMarkLength}::boolean, ${f.flagBlankQty}::boolean, ${f.flagKgm}::boolean, ${f.flagFractionalSets}::boolean, ${f.flagSection}::boolean, ${f.issues}::text)`;
    }),
    ', ',
  );
  await tx.$executeRaw(sql`UPDATE bom_pieces p SET flag_mark_length = v.ml, flag_blank_qty = v.bq, flag_kgm = v.kg,
      flag_fractional_sets = v.fs, flag_section = v.sc, issues = v.iss
    FROM (VALUES ${values}) AS v(id, ml, bq, kg, fs, sc, iss) WHERE p.id = v.id`);
}

/**
 * Lock one BOM upload row for the rest of the transaction. Every write that changes a BOM's pieces,
 * flags or status takes this lock first, so an edit and "Correct BOM" (or a re-check) can never
 * interleave. Returns false when the upload does not exist.
 */
/** Locks the order row. Lock order is always order -> upload, so the two locks can't deadlock. */
async function lockOrderRow(tx: Tx, orderId: number): Promise<void> {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
  if (rows.length === 0) throw new UserError('Order not found.');
}

export async function lockUpload(tx: Tx, uploadId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>(sql`SELECT id FROM bom_uploads WHERE id = ${uploadId} FOR UPDATE`);
  return rows.length > 0;
}

/**
 * Re-check every BOM still in DRAFT, e.g. after the section master changed. Call it AFTER the
 * section change has committed: each BOM is re-checked in its own short transaction (under the
 * BOM's lock), so a long list of drafts never blocks BOM edits for long. A failure on one BOM is
 * logged and the rest still run; confirmBom re-checks again under its lock, so a stale flag can
 * never get a BOM past the gate.
 */
export async function recheckOpenUploads() {
  const open = await prisma.bomUpload.findMany({ where: { status: 'DRAFT' }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const u of open) {
    try {
      await prisma.$transaction(
        async (tx) => {
          if (!(await lockUpload(tx, u.id))) return;
          const cur = await tx.bomUpload.findUnique({ where: { id: u.id }, select: { status: true } });
          if (cur?.status !== 'DRAFT') return;
          await recheckUpload(tx, u.id);
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      console.error(`[bom] re-check of upload ${u.id} failed`, err);
    }
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Edit one cell of a piece, recompute its totals, re-run the checks, audit the change. */
export async function updatePiece(pieceId: number, field: string, value: string, user: AuthUser) {
  if (!(EDITABLE_PIECE_FIELDS as readonly string[]).includes(field)) throw new UserError('This column cannot be edited.');
  const f = field as EditablePieceField;

  return prisma.$transaction(async (tx) => {
    // Lock the BOM first, then read the row and its status under the lock (see lockUpload).
    const ref = await tx.bomPiece.findUnique({ where: { id: pieceId }, select: { uploadId: true } });
    if (!ref || !(await lockUpload(tx, ref.uploadId))) throw new UserError('Row not found.');
    const piece = await tx.bomPiece.findUnique({ where: { id: pieceId }, include: { upload: { select: { status: true } } } });
    if (!piece) throw new UserError('Row not found.');
    if (piece.upload.status !== 'DRAFT') throw new UserError('This BOM is marked correct. Reopen it to edit.');

    const text = value.trim();
    const data: Prisma.BomPieceUpdateInput = {};
    if (f === 'markNo') data.markNo = text || null;
    else if (f === 'section') {
      data.section = text || null;
      data.sectionKey = sectionKey(text);
    } else {
      const n = text === '' ? null : toNum(text);
      if (text !== '' && n === null) throw new UserError('Enter a number.');
      if (n !== null && n < 0) throw new UserError('Negative values are not allowed.');
      if (f === 'lengthMm') data.lengthMm = n === null ? null : Math.round(n);
      else data[f] = n;
    }

    // Recompute totals from the edited row.
    const cur = {
      lengthMm: f === 'lengthMm' ? (data.lengthMm as number | null) : piece.lengthMm,
      qtyPerSet: f === 'qtyPerSet' ? (data.qtyPerSet as number | null) : piece.qtyPerSet?.toNumber() ?? null,
      sets: f === 'sets' ? (data.sets as number | null) : piece.sets?.toNumber() ?? null,
      totalQty: f === 'totalQty' ? (data.totalQty as number | null) : piece.totalQty?.toNumber() ?? null,
      kgPerM: f === 'kgPerM' ? (data.kgPerM as number | null) : piece.kgPerM?.toNumber() ?? null,
      unitWtKg: f === 'unitWtKg' ? (data.unitWtKg as number | null) : piece.unitWtKg?.toNumber() ?? null,
    };
    if ((f === 'qtyPerSet' || f === 'sets') && cur.qtyPerSet !== null && cur.sets !== null) {
      cur.totalQty = round3(cur.qtyPerSet * cur.sets);
      data.totalQty = cur.totalQty;
    }
    data.totalWtKg =
      cur.totalQty === null
        ? null
        : cur.unitWtKg !== null
          ? round3(cur.unitWtKg * cur.totalQty)
          : cur.kgPerM !== null && cur.lengthMm !== null
            ? round3((cur.kgPerM * cur.lengthMm * cur.totalQty) / 1000)
            : null;

    const oldVal = f === 'lengthMm' ? piece.lengthMm : (piece[f] as unknown);
    await tx.bomPiece.update({ where: { id: pieceId }, data });
    await recheckUpload(tx, piece.uploadId);
    await tx.editLog.create({
      data: {
        tableName: 'bom_pieces',
        recordId: pieceId,
        fieldName: f,
        oldValue: oldVal === null || oldVal === undefined ? '' : String(oldVal),
        newValue: text,
        ...auditUser(user),
      },
    });
    return { id: pieceId };
  }, { timeout: 30_000 });
}

/** "✓ Correct BOM": needs no flags left, or an Admin override with a note. */
export async function confirmBom(uploadId: number, note: string, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const ref = await tx.bomUpload.findUnique({ where: { id: uploadId }, select: { orderId: true } });
    if (!ref) throw new UserError('BOM not found.');
    // Order lock first (same as importBom), so a newer upload can't slip in while this one is confirmed.
    await lockOrderRow(tx, ref.orderId);
    if (!(await lockUpload(tx, uploadId))) throw new UserError('BOM not found.');
    const upload = await tx.bomUpload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new UserError('BOM not found.');
    if (upload.status === 'CORRECT') throw new UserError('This BOM is already marked correct.');
    const latest = await tx.bomUpload.findFirst({ where: { orderId: upload.orderId }, orderBy: { id: 'desc' }, select: { id: true } });
    if (latest?.id !== uploadId) throw new UserError('Only the latest BOM of the order can be confirmed.');

    // Fresh flags under the lock (the section master may have changed since the last re-check).
    await recheckUpload(tx, uploadId);
    const [{ flagged }] = await tx.$queryRaw<{ flagged: number }[]>(sql`SELECT count(*)::int AS flagged FROM bom_pieces
      WHERE upload_id = ${uploadId} AND (flag_mark_length OR flag_blank_qty OR flag_kgm OR flag_fractional_sets OR flag_section)`);
    const overrideNote = note.trim().slice(0, 1000);
    if (flagged > 0) {
      if (user.role !== 'Admin') throw new UserError(`${flagged} row(s) still have issues. Fix them, or ask an Admin to override.`);
      if (!overrideNote) throw new UserError(`${flagged} row(s) still have issues. Add a note explaining the override.`);
    }
    await tx.bomUpload.update({
      where: { id: uploadId },
      data: { status: 'CORRECT', confirmedById: user.id, confirmedByName: user.name, confirmedAt: new Date(), overrideNote: flagged > 0 ? overrideNote : null },
    });
    await tx.editLog.create({
      data: {
        tableName: 'bom_uploads',
        recordId: uploadId,
        fieldName: 'status',
        oldValue: 'DRAFT',
        newValue: flagged > 0 ? `CORRECT (override, ${flagged} flagged: ${overrideNote})` : 'CORRECT',
        ...auditUser(user),
      },
    });
    return { id: uploadId };
  }, { timeout: 30_000 });
}

/** Reopen a confirmed BOM. One an Admin confirmed with an override note can only be reopened by an Admin. */
export async function reopenBom(uploadId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockUpload(tx, uploadId))) throw new UserError('BOM not found.');
    const upload = await tx.bomUpload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new UserError('BOM not found.');
    if (upload.status !== 'CORRECT') throw new UserError('This BOM is not marked correct.');
    if (upload.overrideNote && user.role !== 'Admin') {
      throw new UserError('An Admin approved this BOM with an override. Only an Admin can reopen it.');
    }
    await tx.bomUpload.update({ where: { id: uploadId }, data: { status: 'DRAFT', confirmedById: null, confirmedByName: null, confirmedAt: null, overrideNote: null } });
    await recheckUpload(tx, uploadId);
    await tx.editLog.create({
      data: {
        tableName: 'bom_uploads',
        recordId: uploadId,
        fieldName: 'status',
        oldValue: upload.overrideNote ? `CORRECT (override: ${upload.overrideNote})` : 'CORRECT',
        newValue: 'DRAFT (reopened)',
        ...auditUser(user),
      },
    });
    return { id: uploadId };
  }, { timeout: 30_000 });
}
