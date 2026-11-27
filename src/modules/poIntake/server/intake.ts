import 'server-only';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { cleanFileName, getObject, putObject, s3Configured } from '@/lib/s3';
import { geminiConfigured, geminiMimeOf, geminiVia, GEMINI_MAX_INLINE_BYTES, N8N_MAX_INLINE_BYTES } from '@/lib/gemini';
import { downloadAttachmentByName } from '@/lib/mailbox';
import { normalizeDocketNo } from '@/lib/dockets';
import { PO_FIELDS, type PoExtraction, type PoFieldKey, type PoLineDraft, type PoPendingItem } from '@/lib/po/fields';
import { enrichExtraction } from '@/lib/po/enrich';
import { guardOwnFields, normaliseLine, parseDate, poKey, companyTokens } from '@/lib/po/normalise';
import { autoDocketPick, matchQuotedItems, rankDockets, runPoChecks, type DocketCandidate } from '@/lib/po/checks';
import { getPlanSettings } from '@/modules/settings/server';
import { createOrderInTx } from '@/modules/orders/server/mutations';
import type { ConfirmIntakeInput, DocKind, IntakeDoc, IntakeReview } from '../types';
import { extractPo, extractionFromAnswer, geminiRequestSpec } from './extract';
import { getMailThread, poMailCandidates, searchMailThreads, type MailFile, type MailThread } from '@/lib/mailDb';
import { callN8n, N8N_USER } from '@/lib/n8n';
import { columnsFromFields } from './columns';
import { runIndentJob, type JobResult } from './job';
import { customerFromSender, issuedByUs, mailSkipReason, senderFromWarnings } from '@/lib/po/direction';
import { archiveDate, threadHandled, type IntakeOfThread } from '@/lib/po/threadHandled';
import { fileForPo, filesForPart, focusLine, partTargets, splitThreadId } from '@/lib/po/multiPo';

const sql = Prisma.sql;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const KINDS: DocKind[] = ['PO', 'OFFER', 'BOM', 'DRAWING', 'OTHER'];

const fileKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * The kind to keep a file under: the AI's reading of the document wins when it says the file is OUR
 * offer (e.g. "AKS_Revised Price.pdf" typed as PO from its name) - prices are never read from it.
 */
export function aiKind(name: string, kind: DocKind, ex: Pick<PoExtraction, 'documents'> | null | undefined): DocKind {
  const d = ex?.documents?.find((x) => fileKey(x.name) === fileKey(name) || fileKey(x.name).includes(fileKey(name)) || fileKey(name).includes(fileKey(x.name)));
  if (!d) return kind;
  if (d.type === 'OFFER') return 'OFFER';
  if (d.type === 'PO' && kind === 'OFFER') return 'PO';
  return kind;
}
export const toKind = (v: unknown): DocKind => (KINDS.includes(String(v).toUpperCase() as DocKind) ? (String(v).toUpperCase() as DocKind) : 'OTHER');

export interface IntakeFile {
  name: string;
  type: string;
  buffer: Buffer;
  kind: DocKind;
}

const docUrl = (s3Key: string | null) => (s3Key ? `/api/attachments/${encodeURIComponent(s3Key)}` : null);
const today = () => new Date().toISOString().slice(0, 10);

/** Same key layout as /api/upload, so /api/attachments shows the original file name. */
async function storeFile(f: IntakeFile): Promise<string | null> {
  if (!s3Configured) return null;
  const key = `${randomBytes(6).toString('hex')}_${Date.now().toString(36)}_${cleanFileName(f.name)}`;
  await putObject(key, f.buffer, f.type || 'application/octet-stream');
  return key;
}

/**
 * Step 1-2 of "Add Order": store the attached files against a new intake, read the PO (and any
 * drawing) with Gemini, and return the review screen data. Nothing is written to orders yet.
 */
export async function startIntake(files: IntakeFile[], meta: { source: 'UPLOAD' | 'MAILBOX' | 'N8N_MAIL'; gmailMessageId?: string | null; mailSubject?: string | null }, user: AuthUser): Promise<IntakeReview> {
  if (!geminiConfigured()) throw new UserError('PO reading is not set up yet: GEMINI_API_KEY is missing on the server.');
  if (!s3Configured) throw new UserError('File storage is not configured (S3), so the PO copy cannot be kept against the order.');
  if (!files.length) throw new UserError('Attach the PO copy.');
  for (const f of files) {
    if (f.buffer.length === 0) throw new UserError(`${f.name} is empty.`);
    if (f.buffer.length > MAX_FILE_BYTES) throw new UserError(`${f.name} is larger than 25 MB.`);
  }
  const readable = files.filter((f) => (f.kind === 'PO' || f.kind === 'DRAWING') && geminiMimeOf(f.name));
  if (!readable.some((f) => f.kind === 'PO')) throw new UserError('Attach the PO copy as PDF or image (JPG / PNG). Mark it as "PO copy" (our own offer is "Offer (ours)" and is not read).');
  // The PO pages go first; drawings only while they fit the reading limit.
  const send: typeof readable = [];
  const limit = geminiVia() === 'n8n' ? N8N_MAX_INLINE_BYTES : GEMINI_MAX_INLINE_BYTES;
  let bytes = 0;
  for (const f of [...readable.filter((x) => x.kind === 'PO'), ...readable.filter((x) => x.kind === 'DRAWING')]) {
    if (bytes + f.buffer.length > limit && send.length) continue;
    send.push(f);
    bytes += f.buffer.length;
  }

  const intake = await prisma.poIntake.create({
    data: { source: meta.source, gmailMessageId: meta.gmailMessageId ?? null, mailSubject: meta.mailSubject?.slice(0, 500) ?? null, createdById: user.id, createdByName: user.name },
  });
  for (const f of files) {
    const s3Key = await storeFile(f);
    await prisma.orderDocument.create({
      data: { intakeId: intake.id, kind: f.kind, fileName: f.name.slice(0, 255), s3Key, mimeType: f.type || geminiMimeOf(f.name), sizeBytes: f.buffer.length, source: meta.source, gmailMessageId: meta.gmailMessageId ?? null, uploadedByName: user.name },
    });
  }

  let extraction: PoExtraction;
  try {
    extraction = await extractPo(send.map((f) => ({ name: f.name, mimeType: geminiMimeOf(f.name) as string, data: f.buffer })));
  } catch (e) {
    await prisma.poIntake.update({ where: { id: intake.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
  const skipped = readable.length - send.length;
  if (skipped) extraction.warnings.push(`${skipped} drawing file(s) were not read (size limit); their BOM can be uploaded on the BOM tab.`);
  await prisma.poIntake.update({ where: { id: intake.id }, data: { extracted: extraction as unknown as Prisma.InputJsonValue, model: extraction.model } });
  await prisma.editLog.create({
    data: { tableName: 'po_intakes', recordId: intake.id, fieldName: 'EXTRACTED', oldValue: null, newValue: JSON.stringify({ files: files.map((f) => `${f.kind}: ${f.name}`), model: extraction.model, lines: extraction.lines.length, bomPieces: extraction.bomPieces.length }), ...auditUser(user) },
  });
  return getIntakeReview(intake.id);
}

/** Mailbox variant: download the picked attachments, then the same as an upload. */
export async function startIntakeFromMail(messageId: string, picks: { fileName: string; kind: DocKind; messageId?: string }[], user: AuthUser) {
  if (!picks.length) throw new UserError('Pick the PO attachment.');
  const files: IntakeFile[] = [];
  let subject: string | null = null;
  for (const p of picks.slice(0, 10)) {
    const a = await downloadAttachmentByName(p.messageId || messageId, p.fileName);
    subject ??= a.subject;
    files.push({ name: a.fileName, type: a.mimeType, buffer: a.data, kind: p.kind });
  }
  return startIntake(files, { source: 'MAILBOX', gmailMessageId: messageId, mailSubject: subject }, user);
}

// ------------------------------------------------------------------ review data

/** Orders whose customer + PO no. are the same as this one (punctuation and Pvt/Ltd ignored). */
export async function findDuplicate(customer: string | null, poNumber: string | null, excludeOrderId?: number) {
  if (!poNumber) return null;
  const key = poKey(customer, poNumber);
  const p = poNumber.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const rows = await prisma.$queryRaw<{ id: number; po_number: string; client: string | null }[]>(
    sql`SELECT o.id, o.po_number, coalesce(nullif(o.client, ''), d.party_name) AS client FROM orders o JOIN "docket-party-name" d ON d.id = o.docket_id
        WHERE regexp_replace(upper(o.po_number), '[^0-9A-Z]', '', 'g') = ${p}`,
  );
  const hit = rows.find((r) => r.id !== excludeOrderId && (poKey(r.client, r.po_number) === key || !customer));
  // Same PO no. for another customer is allowed by the rule, but po_number is unique in the table.
  const sameNo = rows.find((r) => r.id !== excludeOrderId);
  if (hit) return { poNumber: hit.po_number, orderId: hit.id };
  if (sameNo) return { poNumber: sameNo.po_number, orderId: sameNo.id };
  return null;
}

async function docketCandidates(customer: string | null, endClient: string | null): Promise<DocketCandidate[]> {
  const toks = [...companyTokens(customer ?? ''), ...companyTokens(endClient ?? '')].filter((t) => t.length >= 3).slice(0, 8);
  // Prefix of each token catches typos at the end ("VETURES" still starts with "VE").
  const pats = toks.map((t) => `%${t.slice(0, Math.max(3, Math.min(5, t.length - 2)))}%`);
  if (!pats.length) return [];
  const dockets = await prisma.$queryRaw<{ id: number; docket_no: string | null; party: string | null; utility: string | null; state: string | null; site: string | null; orders: number }[]>(
    sql`SELECT d.id, d.docket_no_qtn_no AS docket_no, d.party_name AS party, d.utility, d.state, d.delivery_location AS site,
          (SELECT count(*)::int FROM orders o WHERE o.docket_id = d.id) AS orders
        FROM "docket-party-name" d
        WHERE d.party_name ILIKE ANY (${pats}) OR d.utility ILIKE ANY (${pats})
        ORDER BY d.id DESC LIMIT 150`,
  );
  if (!dockets.length) return [];
  const nos = dockets.map((d) => normalizeDocketNo(d.docket_no ?? '')).filter(Boolean);
  const items = await prisma.itemTable.findMany({
    where: { docketNoQtnNo: { in: nos, mode: 'insensitive' } },
    select: { id: true, docketNoQtnNo: true, itemNameParty: true, uom: true, qty: true, price: true, uomOfQtn: true, weightPerPiece: true, unitWtOfMemberKg: true },
    orderBy: { id: 'asc' },
  });
  const boms = await prisma.itemBom.findMany({ where: { docketId: { in: dockets.map((d) => d.id) }, status: 'CONFIRMED' }, select: { docketId: true } });
  const withBom = new Set(boms.map((b) => b.docketId));
  return dockets.map((d) => {
    const no = normalizeDocketNo(d.docket_no ?? '');
    return {
      id: d.id,
      docketNo: d.docket_no,
      party: d.party,
      utility: d.utility,
      state: d.state,
      site: d.site,
      orders: d.orders,
      hasBom: withBom.has(d.id),
      items: items
        .filter((i) => normalizeDocketNo(i.docketNoQtnNo ?? '') === no)
        .slice(0, 200)
        .map((i) => ({ id: i.id, name: i.itemNameParty, uom: i.uom, qty: i.qty, price: i.price, qtnUom: i.uomOfQtn, wt: i.weightPerPiece || i.unitWtOfMemberKg })),
    };
  });
}

const refList = (s: string | null | undefined) =>
  String(s ?? '')
    .split(/[;,\n]| and /i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
const normRef = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

async function libraryDrawings(drawingRef: string | null, approvalLetterNo: string | null) {
  const refs = refList(drawingRef).map(normRef);
  const letterDigits = (approvalLetterNo ?? '').match(/\d{3,}/g) ?? [];
  if (!refs.length && !letterDigits.length) return [];
  const rows = await prisma.approvedDrawing.findMany({
    where: { status: 'APPROVED' },
    select: { drawingNo: true, revision: true, approvalLetterNo: true, itemType: true },
  });
  return rows.filter((r) => {
    const n = normRef(r.drawingNo);
    if (refs.some((x) => x === n || (x.length >= 6 && (n.includes(x) || x.includes(n))))) return true;
    return letterDigits.some((d) => (r.approvalLetterNo ?? '').includes(d));
  }).slice(0, 50);
}

const ddmmyyyy = (ymd: string | null) => (ymd ? `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}` : null);
const DRAWING_ITEM = /drawing|drg|gtp|bom|bill of material|design|approval/i;

/**
 * Hold suggestion. The latest mail decides: items still pending there (with the date of that mail)
 * put the order on hold with exactly that reason. Otherwise the drawing check: approved per PO / mail,
 * approval letter, library hit or an attached drawing / BOM.
 */
export function suggestHold(e: {
  drawingStatus: string | null;
  drawingNote?: string | null;
  approvalLetterNo: string | null;
  hasLibrary: boolean;
  hasDrawingDoc: boolean;
  hasBomPieces: boolean;
  pending?: PoPendingItem[];
}) {
  const pend = e.pending ?? [];
  if (pend.length) {
    const list = pend.map((p) => `${p.item}${p.by ? ` (${p.by})` : ''}${p.since ? ` – pending since mail of ${ddmmyyyy(p.since)}` : ''}`).join('; ');
    return { on: true, reason: `Pending at the latest mail: ${list}.` };
  }
  if (e.drawingStatus === 'TO_BE_APPROVED') return { on: true, reason: `Drawing / BOM confirmation pending${e.drawingNote ? `: ${e.drawingNote}` : ' (per PO / mail)'}.` };
  if (e.drawingStatus === 'APPROVED') return { on: false, reason: `Drawing / GTP approved${e.drawingNote ? ` (${e.drawingNote})` : ' per PO / mail'}.` };
  if (e.approvalLetterNo) return { on: false, reason: `Approval letter on the PO: ${e.approvalLetterNo}.` };
  if (e.hasLibrary) return { on: false, reason: 'Drawing found in the Approved Drawing Library.' };
  if (e.hasDrawingDoc || e.hasBomPieces) return { on: false, reason: 'Drawing / BOM came with the PO.' };
  return {
    on: true,
    reason: 'No approved drawing or approval letter on the PO, and none in the library.',
  };
}

/** "Name <x@lanarsy.com>" -> the docket party whose name holds "lanarsy" (one party only), else null. */
async function partyFromSenderDomain(sender: string | null): Promise<string | null> {
  const dom = String(sender ?? '').match(/@([a-z0-9.-]+)>?\s*$/i)?.[1]?.toLowerCase();
  if (!dom || /ceebuildcompany|laserpowerinfra|gmail|yahoo|outlook|hotmail|rediff|googlemail/.test(dom)) return null;
  const label = dom.split('.')[0];
  if (label.length < 4) return null;
  const rows = await prisma.$queryRaw<{ party: string }[]>(sql`SELECT DISTINCT upper(trim(party_name)) AS party FROM "docket-party-name" WHERE party_name ILIKE ${'%' + label + '%'} LIMIT 3`);
  return rows.length === 1 ? rows[0].party : null;
}

export async function getIntakeReview(intakeId: number): Promise<IntakeReview> {
  const intake = await prisma.poIntake.findUnique({ where: { id: intakeId }, include: { documents: { orderBy: { id: 'asc' } } } });
  if (!intake) throw new UserError('This PO intake was not found.');
  const stored = intake.extracted as unknown as PoExtraction | null;
  if (!stored) throw new UserError(intake.error ? `Reading failed: ${intake.error}` : 'This PO has not been read yet.');
  const settings = await getPlanSettings();
  // HSN from the item master, GST "as per law", proposed delivery date (all yellow until accepted).
  const { extraction, proposedCompletion } = enrichExtraction(stored, { leadTimeDays: settings.leadTimeDays });
  const f = guardOwnFields(extraction.fields); // also cleans readings saved before the guard existed
  // The drawing status must agree with what is still pending at the latest mail.
  const pending = extraction.pending ?? [];
  const drawingPending = pending.filter((p) => DRAWING_ITEM.test(p.item));
  if (drawingPending.length && f.drawingStatus.value !== 'TO_BE_APPROVED') {
    const p = drawingPending[0];
    f.drawingStatus = { value: 'TO_BE_APPROVED', confidence: 'low', note: `latest mail${p.since ? ` (${ddmmyyyy(p.since)})` : ''}: ${p.item} still pending${f.drawingStatus.value ? `; the PO / older mail said ${f.drawingStatus.value.replace(/_/g, ' ').toLowerCase()}` : ''}` };
  }
  if (!f.customerName.value) {
    const sender = senderFromWarnings(extraction.warnings);
    const fromMail = customerFromSender(sender) ?? (await partyFromSenderDomain(sender));
    if (fromMail) f.customerName = { value: fromMail, confidence: 'low', note: `from the mail sender (the PO did not name the buyer clearly)${f.customerName.note ? `; ${f.customerName.note}` : ''}` };
  }
  const [cands, duplicateOf, library] = await Promise.all([
    docketCandidates(f.customerName.value, f.endClient.value),
    findDuplicate(f.customerName.value, f.poNumber.value),
    libraryDrawings(f.drawingRef.value, f.approvalLetterNo.value),
  ]);
  const ranked = rankDockets({ customer: f.customerName.value, endClient: f.endClient.value, project: f.project.value, site: [f.project.value, f.deliveryAddress.value].filter(Boolean).join(' '), lines: extraction.lines }, cands);
  const byId = new Map(cands.map((c) => [c.id, c]));
  // The customer's own offers first (latest revision pre-selected), other parties only as "other matches".
  const same = ranked.filter((r) => r.group === 'SAME_PARTY').slice(0, 8);
  const other = ranked.filter((r) => r.group === 'OTHER').slice(0, 4);
  const dockets = [...same, ...other].map((r) => ({ ...r, items: byId.get(r.id)?.items ?? [] }));
  const documents: IntakeDoc[] = intake.documents.map((d) => ({ id: d.id, kind: aiKind(d.fileName, d.kind as DocKind, extraction), fileName: d.fileName, mimeType: d.mimeType, url: docUrl(d.s3Key) }));
  return {
    intakeId: intake.id,
    status: intake.status,
    source: intake.source,
    mailSubject: intake.mailSubject,
    documents,
    extraction,
    dockets,
    suggestedDocketId: same.find((d) => d.relevant)?.id ?? same[0]?.id ?? other[0]?.id ?? null,
    duplicateOf,
    leadTimeDays: settings.leadTimeDays,
    today: today(),
    libraryDrawings: library,
    suggestedHold: suggestHold({
      drawingStatus: f.drawingStatus.value,
      drawingNote: f.drawingStatus.note ?? null,
      approvalLetterNo: f.approvalLetterNo.value,
      hasLibrary: library.length > 0,
      hasDrawingDoc: documents.some((d) => d.kind === 'DRAWING' || d.kind === 'BOM'),
      hasBomPieces: extraction.bomPieces.length > 0,
      pending,
    }),
    proposedCompletion,
    canReread: intake.status === 'EXTRACTED' && (intake.source !== 'N8N_MAIL' || String(intake.gmailMessageId ?? '').startsWith('thread:')),
  };
}

// ------------------------------------------------------------------ confirm

const lineFrom = (l: unknown): PoLineDraft | null => {
  const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
  const n = normaliseLine({ description: o.description, hsn: o.hsn, unit: o.unit, qty: o.qty, unitRate: o.unitRate, lineValue: o.lineValue, qtyVariation: o.qtyVarPct, confidence: 'high' });
  return n;
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(blank)' : String(v));

/**
 * Step 3-4: the reviewed form becomes the order. Blocks a duplicate PO; saves every field, the PO
 * lines (with our quoted rate), the files against the order, and one edit-log row per field the user
 * changed from what the AI read. Then the indent job starts.
 */
export async function confirmIntake(intakeId: number, input: ConfirmIntakeInput, user: AuthUser): Promise<{ id: number; job: JobResult | null; jobError?: string }> {
  const intake = await prisma.poIntake.findUnique({ where: { id: intakeId }, include: { documents: true } });
  if (!intake) throw new UserError('This PO intake was not found.');
  if (intake.status === 'CONFIRMED') throw new UserError(`Already confirmed as order #${intake.orderId}.`);
  if (intake.status !== 'EXTRACTED') throw new UserError(`This PO intake is ${intake.status.toLowerCase()}.`);
  const extraction = intake.extracted as unknown as PoExtraction;

  const { data, clean } = columnsFromFields(input.fields);
  const customer = clean.customerName ?? null;
  const poNumber = clean.poNumber as string;
  const poDate = clean.poDate as string;
  const dup = await findDuplicate(customer, poNumber);
  if (dup) throw new UserError(`Duplicate PO: ${dup.poNumber} is already order #${dup.orderId}. Not saved.`);

  const rawLines = Array.isArray(input.lines) ? input.lines.slice(0, 500) : [];
  const lines = rawLines.map(lineFrom).filter((l): l is PoLineDraft => !!l);
  const docket = await prisma.dockerPartyName.findUnique({ where: { id: input.docketId } });
  if (!docket) throw new UserError('Choose the docket (offer) this PO is for.');
  const items = docket.docketNoQtnNo
    ? await prisma.itemTable.findMany({
        where: { docketNoQtnNo: { equals: normalizeDocketNo(docket.docketNoQtnNo), mode: 'insensitive' } },
        select: { id: true, itemNameParty: true, uom: true, qty: true, price: true, uomOfQtn: true, weightPerPiece: true, unitWtOfMemberKg: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const priced = matchQuotedItems(lines, items.map((i) => ({ id: i.id, name: i.itemNameParty, uom: i.uom, qty: i.qty, price: i.price, qtnUom: i.uomOfQtn, wt: i.weightPerPiece || i.unitWtOfMemberKg })));
  const hold = { on: input.hold?.on === true, reason: String(input.hold?.reason ?? '').trim().slice(0, 1000) };
  if (hold.on && !hold.reason) throw new UserError('Say what the client still has to confirm (hold reason).');

  const orderId = await prisma.$transaction(
    async (tx) => {
      const { id } = await createOrderInTx(tx, { docketId: docket.id, poNumber, poDate, client: customer ?? undefined, remarks: input.remarks, poSource: 'PO_COPY' }, user);
      const total = data.totalValue as number | null | undefined;
      await tx.order.update({
        where: { id },
        data: {
          ...(data as Prisma.OrderUpdateInput),
          contractValue: total ?? null,
          poExtract: extraction as unknown as Prisma.InputJsonValue,
          ...(hold.on ? { onHold: true, holdReason: hold.reason, holdSince: new Date(), holdByName: user.name } : {}),
        },
      });
      if (priced.length) {
        await tx.orderPoLine.createMany({
          data: priced.map((l, i) => ({
            orderId: id,
            lineNo: i + 1,
            description: l.description,
            hsn: l.hsn,
            unit: l.unit,
            qty: l.qty,
            unitRate: l.unitRate,
            lineValue: l.lineValue,
            qtyVarPct: l.qtyVarPct,
            quotedRate: l.quotedRate ?? null,
            quotedItemId: l.quotedItemId ?? null,
          })),
        });
      }
      await tx.orderDocument.updateMany({ where: { intakeId }, data: { orderId: id } });
      // Our own offer that came with the mail is kept as OFFER, never as the PO copy.
      for (const d of intake.documents) {
        const k = aiKind(d.fileName, d.kind as DocKind, extraction);
        if (k !== d.kind) await tx.orderDocument.update({ where: { id: d.id }, data: { kind: k } });
      }
      await tx.poIntake.update({ where: { id: intakeId }, data: { status: 'CONFIRMED', orderId: id, confirmedAt: new Date() } });

      // Edit log: one row per field the reviewer changed from the AI reading (old = as read).
      const logs: Prisma.EditLogCreateManyInput[] = [];
      for (const fd of PO_FIELDS) {
        const read = extraction.fields[fd.key]?.value ?? null;
        const final = clean[fd.key as PoFieldKey] ?? null;
        if (show(read) !== show(final)) logs.push({ tableName: 'orders', recordId: id, fieldName: fd.key, oldValue: `AI read: ${show(read)}`, newValue: show(final), ...auditUser(user) });
      }
      const asRead = JSON.stringify(extraction.lines.map((l) => [l.description, l.unit, l.qty, l.unitRate, l.lineValue, l.qtyVarPct]));
      const asSaved = JSON.stringify(lines.map((l) => [l.description, l.unit, l.qty, l.unitRate, l.lineValue, l.qtyVarPct]));
      if (asRead !== asSaved) logs.push({ tableName: 'orders', recordId: id, fieldName: 'po_lines', oldValue: `AI read: ${asRead}`.slice(0, 20000), newValue: asSaved.slice(0, 20000), ...auditUser(user) });
      logs.push({
        tableName: 'orders',
        recordId: id,
        fieldName: 'PO_COPY',
        oldValue: null,
        newValue: JSON.stringify({ intakeId, files: intake.documents.map((d) => d.fileName), model: extraction.model, fieldsChanged: logs.length, hold: hold.on ? hold.reason : null }),
        ...auditUser(user),
      });
      await tx.editLog.createMany({ data: logs });
      return id;
    },
    { timeout: 60_000 },
  );

  try {
    return { id: orderId, job: await runIndentJob(orderId, user) };
  } catch (e) {
    return { id: orderId, job: null, jobError: (e as Error).message };
  }
}

export async function discardIntake(intakeId: number, user: AuthUser) {
  const intake = await prisma.poIntake.findUnique({ where: { id: intakeId }, select: { status: true } });
  if (!intake) throw new UserError('Not found.');
  if (intake.status === 'CONFIRMED') throw new UserError('Already confirmed; delete the order instead.');
  await prisma.poIntake.update({ where: { id: intakeId }, data: { status: 'DISCARDED' } });
  await prisma.editLog.create({ data: { tableName: 'po_intakes', recordId: intakeId, fieldName: 'status', oldValue: intake.status, newValue: 'DISCARDED', ...auditUser(user) } });
  return { id: intakeId };
}

/** Server-side re-check while the user edits the PO no. / customer on the review screen. */
export const checkDuplicate = (customer: string | null, poNumber: string | null) => findDuplicate(customer, poNumber);

/** Checks for an existing order (PO tab). */
export async function orderChecks(orderId: number, fields: Record<PoFieldKey, string | null>, lines: PoLineDraft[]) {
  const settings = await getPlanSettings();
  const dup = await findDuplicate(fields.customerName, fields.poNumber, orderId);
  return runPoChecks({ fields, lines, today: today(), leadTimeDays: settings.leadTimeDays, duplicateOf: dup });
}

// ------------------------------------------------------------------ n8n (PO mails from the mail archive)

/** PoIntake.gmailMessageId for mail-archive threads. */
export const threadRef = (threadId: string) => `thread:${threadId}`;
/**
 * Threads not to read again: read / confirmed, failed MAX_FAILS times, or discarded with no new
 * message since (a discarded thread that gets a new message is read again - see threadHandled).
 */
async function handledThreads(threads: { threadId: string; date: string | null }[]) {
  if (!threads.length) return new Set<string>();
  const rows = await prisma.poIntake.findMany({ where: { gmailMessageId: { in: threads.map((t) => threadRef(t.threadId)) } }, select: { gmailMessageId: true, status: true, createdAt: true, error: true } });
  const byThread = new Map<string, IntakeOfThread[]>();
  for (const r of rows) {
    const id = String(r.gmailMessageId).slice('thread:'.length);
    byThread.set(id, [...(byThread.get(id) ?? []), { status: r.status, createdAt: r.createdAt, error: r.error }]);
  }
  const done = new Set<string>();
  for (const t of threads) if (threadHandled(byThread.get(t.threadId) ?? [], archiveDate(t.date))) done.add(t.threadId);
  return done;
}

const forN8n = (t: MailThread) => ({
  threadId: t.threadId,
  subject: t.subject,
  sender: t.sender,
  date: t.date,
  mailText: t.text.slice(0, 6000),
  files: t.files
    .filter((f) => f.kind !== 'SKIP' && f.driveId)
    .slice(0, 12)
    .map((f) => ({ name: f.name, driveId: f.driveId, kind: f.kind })),
});

type N8nMail = ReturnType<typeof forN8n> & { focus?: string };

/** One separate PO of a multi-PO mail, read on its own (thread id "<thread>~<PO>", focus line for the AI). */
const partForN8n = (t: MailThread, partId: string, poNumber: string, poFile: MailFile): N8nMail => ({
  threadId: partId,
  subject: t.subject,
  sender: t.sender,
  date: t.date,
  mailText: t.text.slice(0, 6000),
  files: filesForPart(t.files, poFile)
    .slice(0, 8)
    .map((f) => ({ name: f.name, driveId: f.driveId, kind: f === poFile ? ('PO' as const) : f.kind })),
  focus: focusLine(poNumber, poFile.name),
});

/**
 * The other POs of multi-PO mails read in the last `days` days: listed by the first reading
 * (extraction.otherPos), not yet read on their own, and not already an order.
 */
async function pendingPoParts(days: number, limit: number): Promise<N8nMail[]> {
  const read = await prisma.poIntake.findMany({
    where: { source: 'N8N_MAIL', status: { in: ['EXTRACTED', 'CONFIRMED'] }, gmailMessageId: { startsWith: 'thread:' }, createdAt: { gte: new Date(Date.now() - days * 86400_000) } },
    select: { gmailMessageId: true, extracted: true },
    orderBy: { id: 'desc' },
  });
  const withOthers = read
    .map((r) => ({ id: String(r.gmailMessageId).slice('thread:'.length), ex: r.extracted as unknown as PoExtraction | null }))
    .filter((r) => !splitThreadId(r.id).part && (r.ex?.otherPos?.length ?? 0) > 0);
  if (!withOthers.length) return [];
  const orderPos = (await prisma.order.findMany({ select: { poNumber: true } })).map((o) => o.poNumber);
  const out: N8nMail[] = [];
  for (const r of withOthers) {
    const t = await getMailThread(r.id);
    if (!t) continue;
    const targets = partTargets(r.id, r.ex?.fields?.poNumber?.value ?? null, r.ex?.otherPos ?? [], t.files, orderPos);
    if (!targets.length) continue;
    const done = await handledThreads(targets.map((x) => ({ threadId: x.partId, date: null })));
    for (const x of targets) if (!done.has(x.partId)) out.push(partForN8n(t, x.partId, x.poNumber, x.file));
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** For the n8n schedule: new customer-PO mails not read yet, plus the prompt / schema / model to read them with. */
export async function n8nPoMails(days: number, limit: number) {
  const cands = await poMailCandidates(days, 60);
  const done = await handledThreads(cands);
  const mails: N8nMail[] = cands
    .filter((c) => !done.has(c.threadId) && !mailSkipReason(c.subject, c.sender).skip)
    .map(forN8n)
    .filter((m) => m.files.some((f) => f.kind === 'PO'))
    .slice(0, limit);
  // Then the other POs of mails that carried several (each becomes its own intake / order).
  if (mails.length < limit) {
    try {
      mails.push(...(await pendingPoParts(Math.max(days, 30), limit - mails.length)));
    } catch (e) {
      console.error('[n8n po-mails] other POs of a mail', e);
    }
  }
  return { ...geminiRequestSpec(), mails };
}

export interface N8nIntakePayload {
  threadId?: string;
  subject?: string | null;
  sender?: string | null;
  files?: { name?: string; kind?: string; mimeType?: string | null; base64?: string | null; error?: string | null }[];
  gemini?: { status?: number; text?: string } | null;
  model?: string | null;
  note?: string | null;
}

const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

/**
 * n8n posts back one PO mail it read: the files (base64) and Gemini's raw answer. Creates the intake
 * that waits on /orders/new for review (EXTRACTED), or records why not (DISCARDED = not a customer
 * PO, FAILED = reading failed). Idempotent per thread.
 */
export async function ingestN8nIntake(p: N8nIntakePayload) {
  const threadId = String(p.threadId ?? '').trim();
  // "<thread>" or "<thread>~<PO key>" for one PO of a mail carrying several (see multiPo.ts).
  if (!/^[0-9a-zA-Z_-]{6,64}(~[0-9A-Z-]{1,40})?$/.test(threadId)) throw new UserError('threadId is missing or invalid.');
  const ref = threadRef(threadId);
  const existing = await prisma.poIntake.findFirst({ where: { gmailMessageId: ref, status: { in: ['EXTRACTED', 'CONFIRMED'] } }, orderBy: { id: 'desc' } });
  if (existing) return { intakeId: existing.id, status: existing.status, duplicate: true };

  const subject = (p.subject ?? '').slice(0, 500) || null;
  const model = String(p.model ?? '').slice(0, 100) || null;
  const fail = async (status: 'FAILED' | 'DISCARDED', error: string, extracted?: PoExtraction) => {
    const it = await prisma.poIntake.create({
      data: {
        source: 'N8N_MAIL',
        status,
        gmailMessageId: ref,
        mailSubject: subject,
        model,
        error: error.slice(0, 1000),
        extracted: extracted ? (extracted as unknown as Prisma.InputJsonValue) : undefined,
        createdById: N8N_USER.id,
        createdByName: N8N_USER.name,
      },
    });
    await prisma.editLog.create({
      data: { tableName: 'po_intakes', recordId: it.id, fieldName: `N8N_${status}`, oldValue: null, newValue: JSON.stringify({ threadId, subject, error }).slice(0, 5000), ...auditUser(N8N_USER) },
    });
    return { intakeId: it.id, status, error };
  };

  const files: IntakeFile[] = [];
  const fileErrors: string[] = [];
  let total = 0;
  for (const f of (p.files ?? []).slice(0, 15)) {
    const name = String(f.name ?? 'file').slice(0, 255);
    if (f.error) {
      fileErrors.push(`${name}: ${f.error}`);
      continue;
    }
    if (!f.base64) continue; // uploaded afterwards through /api/n8n/po-file
    const buffer = Buffer.from(f.base64, 'base64');
    total += buffer.length;
    if (buffer.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
      fileErrors.push(`${name}: too large`);
      continue;
    }
    files.push({ name, type: f.mimeType || geminiMimeOf(name) || 'application/octet-stream', buffer, kind: toKind(f.kind) });
  }

  if (!p.gemini) return fail('FAILED', p.note || `No PO copy could be read from the mail.${fileErrors.length ? ' ' + fileErrors.join('; ') : ''}`);
  let extraction: PoExtraction;
  try {
    extraction = extractionFromAnswer(Number(p.gemini.status) || 0, String(p.gemini.text ?? ''), model || 'gemini');
  } catch (e) {
    return fail('FAILED', (e as Error).message);
  }
  if (extraction.documentType === 'NOT_A_PO') return fail('DISCARDED', `Not a customer PO (AI). ${extraction.warnings.join(' ')}`.trim(), extraction);
  const exf = extraction.fields;
  const ours = issuedByUs(
    { poNumber: exf.poNumber.value, customerName: exf.customerName.value, deliveryAddress: exf.deliveryAddress.value, endClient: exf.endClient.value, project: exf.project.value },
    subject,
    p.sender,
  );
  if (ours) return fail('DISCARDED', `Not a customer PO: ${ours}`, extraction);
  if (!s3Configured) return fail('FAILED', 'File storage (S3) is not configured on the dashboard.', extraction);
  if (fileErrors.length) extraction.warnings.push(`Not attached from the mail: ${fileErrors.join('; ')}`);
  if (subject) extraction.warnings.push(`Read by n8n from the mail "${subject}"${p.sender ? ` (${p.sender})` : ''}.`);

  const intake = await prisma.poIntake.create({
    data: { source: 'N8N_MAIL', gmailMessageId: ref, mailSubject: subject, model, extracted: extraction as unknown as Prisma.InputJsonValue, createdById: N8N_USER.id, createdByName: N8N_USER.name },
  });
  for (const f of files) {
    const s3Key = await storeFile(f);
    await prisma.orderDocument.create({
      data: { intakeId: intake.id, kind: f.kind, fileName: f.name, s3Key, mimeType: f.type, sizeBytes: f.buffer.length, source: 'N8N_MAIL', gmailMessageId: ref, uploadedByName: N8N_USER.name },
    });
  }
  await prisma.editLog.create({
    data: {
      tableName: 'po_intakes',
      recordId: intake.id,
      fieldName: 'EXTRACTED',
      oldValue: null,
      newValue: JSON.stringify({ by: 'n8n', threadId, files: files.map((f) => `${f.kind}: ${f.name}`), model, lines: extraction.lines.length, bomPieces: extraction.bomPieces.length }),
      ...auditUser(N8N_USER),
    },
  });
  const fl = extraction.fields;
  return { intakeId: intake.id, status: 'EXTRACTED', poNumber: fl.poNumber.value, customer: fl.customerName.value, reviewPath: `/orders/new?intake=${intake.id}` };
}

/** "Pick from mail": search the mail archive (Ceebuild mail with attachments). */
export async function searchMailArchive(q: string) {
  // Only POs a party sent to us: our own POs to suppliers, bounces and mails n8n found are not a customer PO are left out.
  const notPo = new Set(
    (
      await prisma.poIntake.findMany({
        where: { source: 'N8N_MAIL', status: 'DISCARDED', error: { startsWith: 'Not a customer PO' } },
        select: { gmailMessageId: true },
      })
    ).map((r) => r.gmailMessageId),
  );
  const threads = (await searchMailThreads(q)).filter((t) => !mailSkipReason(t.subject, t.sender).skip && !notPo.has(threadRef(t.threadId)));
  const done = await prisma.poIntake.findMany({
    where: { gmailMessageId: { in: threads.map((t) => threadRef(t.threadId)) }, status: { in: ['EXTRACTED', 'CONFIRMED'] } },
    select: { gmailMessageId: true, id: true, status: true, orderId: true },
  });
  const byRef = new Map(done.map((d) => [d.gmailMessageId, { id: d.id, status: d.status, orderId: d.orderId }]));
  return threads.map((t) => ({ ...t, intake: byRef.get(threadRef(t.threadId)) ?? null }));
}

/** Ask n8n to read one mail now (the user picked it and ticked the files). Returns at once; poll intakeForThread. */
export async function requestMailRead(threadId: string, picks: { name: string; kind: DocKind }[], user: AuthUser, part?: { partId: string; focus: string }) {
  const t = await getMailThread(threadId);
  if (!t) throw new UserError('Mail not found in the mail archive.');
  const wanted = new Map(picks.map((p) => [p.name, p.kind]));
  const files = t.files.filter((f) => wanted.has(f.name) && f.driveId).map((f) => ({ name: f.name, driveId: f.driveId, kind: wanted.get(f.name) as DocKind }));
  if (!files.some((f) => f.kind === 'PO')) throw new UserError('Tick the PO copy and mark it as "PO copy".');
  const id = part?.partId ?? threadId;
  const old = await prisma.poIntake.findFirst({ where: { gmailMessageId: threadRef(id), status: { in: ['EXTRACTED', 'CONFIRMED'] } } });
  if (old) return { intakeId: old.id as number | null, status: old.status, since: null as string | null };
  const since = new Date(Date.now() - 2000).toISOString();
  await callN8n('ceebuild-read-po-mail', { ...geminiRequestSpec(), mails: [{ threadId: id, subject: t.subject, sender: t.sender, date: t.date, mailText: t.text.slice(0, 6000), files, ...(part ? { focus: part.focus } : {}) }], requestedBy: user.name });
  return { intakeId: null as number | null, status: 'QUEUED', since };
}

/** Latest intake n8n made for a thread since `since` (the UI polls this after requestMailRead). */
export async function intakeForThread(threadId: string, since?: string | null) {
  return prisma.poIntake.findFirst({
    where: { gmailMessageId: threadRef(threadId), ...(since ? { createdAt: { gte: new Date(since) } } : {}) },
    orderBy: { id: 'desc' },
    select: { id: true, status: true, error: true, orderId: true },
  });
}

/** PO mails n8n has read in the last 30 days that are not confirmed yet (shown on /orders/new). */
export async function pendingIntakes() {
  const rows = await prisma.poIntake.findMany({
    where: { status: { in: ['EXTRACTED', 'FAILED', 'DISCARDED'] }, source: 'N8N_MAIL', createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    orderBy: { id: 'desc' },
    take: 60,
    select: { id: true, status: true, source: true, mailSubject: true, error: true, createdAt: true, extracted: true },
  });
  return rows.map((r) => {
    const e = r.extracted as unknown as PoExtraction | null;
    return {
      id: r.id,
      status: r.status,
      subject: r.mailSubject,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      poNumber: e?.fields?.poNumber?.value ?? null,
      customer: e?.fields?.customerName?.value ?? null,
      totalValue: e?.fields?.totalValue?.value ?? null,
    };
  });
}

/**
 * n8n uploads the files of a PO mail one by one (raw body, after the intake exists), so no large
 * base64 payload is held in n8n's memory. Only for intakes n8n created and that still wait for review.
 */
export async function attachN8nFile(intakeId: number, meta: { name: string; kind: string; mimeType: string | null }, buffer: Buffer) {
  const intake = await prisma.poIntake.findUnique({ where: { id: intakeId }, select: { id: true, status: true, source: true, gmailMessageId: true, extracted: true } });
  if (!intake || intake.source !== 'N8N_MAIL') throw new UserError('Intake not found.');
  if (intake.status !== 'EXTRACTED' && intake.status !== 'CONFIRMED') return { skipped: true, reason: `intake is ${intake.status.toLowerCase()}` };
  // An order made automatically before n8n finished uploading gets the late files too.
  const orderId = intake.status === 'CONFIRMED' ? ((await prisma.poIntake.findUnique({ where: { id: intakeId }, select: { orderId: true } }))?.orderId ?? null) : null;
  const name = meta.name.slice(0, 255) || 'file';
  if (!buffer.length) throw new UserError(`${name} is empty.`);
  if (buffer.length > MAX_FILE_BYTES) throw new UserError(`${name} is larger than 25 MB.`);
  const already = await prisma.orderDocument.findFirst({ where: { intakeId, fileName: name }, select: { id: true } });
  if (already) return { skipped: true, reason: 'already attached', documentId: already.id };
  const f: IntakeFile = { name, type: meta.mimeType || geminiMimeOf(name) || 'application/octet-stream', buffer, kind: aiKind(name, toKind(meta.kind), intake.extracted as unknown as PoExtraction | null) };
  const s3Key = await storeFile(f);
  const doc = await prisma.orderDocument.create({
    data: { intakeId, orderId, kind: f.kind, fileName: name, s3Key, mimeType: f.type, sizeBytes: buffer.length, source: 'N8N_MAIL', gmailMessageId: intake.gmailMessageId, uploadedByName: N8N_USER.name },
  });
  return { documentId: doc.id, kind: f.kind };
}

// ------------------------------------------------------------------ orders made automatically from PO mails

/** Docket id -> the date it was entered (yyyy-mm-dd). */
export async function docketDates(ids: number[]) {
  const rows = ids.length ? await prisma.dockerPartyName.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.createdAt.toISOString().slice(0, 10)]));
}

export type AutoOrderResult = { intakeId: number; created: boolean; orderId?: number; docketNo?: string | null; reason?: string; discarded?: boolean };

/**
 * A PO mail n8n read becomes an order without waiting for the review screen when it is safe:
 * a PO the party sent us (not our own PO to a supplier), not a duplicate, and an offer (docket) to
 * the same party that matches. The order's remarks say it was made automatically and what to check;
 * anything else stays on Orders -> "Received POs not yet orders" for a person to finish.
 */
const OLD_PO_DAYS = 30;
/** PO date (as read) more than 30 days ago. */
function isOldPo(poDate: string | null | undefined) {
  const iso = parseDate(poDate);
  const at = iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() : NaN;
  return Number.isFinite(at) && Date.now() - at > OLD_PO_DAYS * 86400000;
}

export async function autoCreateOrder(intakeId: number): Promise<AutoOrderResult> {
  const review = await getIntakeReview(intakeId);
  if (review.status !== 'EXTRACTED') return { intakeId, created: false, reason: `intake is ${review.status.toLowerCase()}` };
  const f = review.extraction.fields;
  const ours = issuedByUs(
    { poNumber: f.poNumber.value, customerName: f.customerName.value, deliveryAddress: f.deliveryAddress.value, endClient: f.endClient.value, project: f.project.value },
    review.mailSubject,
    senderFromWarnings(review.extraction.warnings),
  );
  if (ours) {
    await prisma.poIntake.update({ where: { id: intakeId }, data: { status: 'DISCARDED', error: `Not a customer PO: ${ours}`.slice(0, 1000) } });
    await prisma.editLog.create({ data: { tableName: 'po_intakes', recordId: intakeId, fieldName: 'status', oldValue: 'EXTRACTED', newValue: `DISCARDED (${ours})`.slice(0, 5000), ...auditUser(N8N_USER) } });
    return { intakeId, created: false, discarded: true, reason: ours };
  }
  if (review.duplicateOf) return { intakeId, created: false, reason: `PO ${review.duplicateOf.poNumber} is already order #${review.duplicateOf.orderId}.` };
  // Old POs (read late, e.g. the backlog before automatic reading) may already be supplied: a person decides.
  if (isOldPo(f.poDate.value))
    return { intakeId, created: false, reason: `PO dated ${f.poDate.value} is older than ${OLD_PO_DAYS} days – check and confirm by hand.` };
  const { pick: docket, why } = autoDocketPick(review.dockets, { endClient: f.endClient.value, project: f.project.value, poDate: parseDate(f.poDate.value) }, await docketDates(review.dockets.map((d) => d.id)));
  if (!docket) return { intakeId, created: false, reason: `Docket not chosen automatically: ${why}.` };

  const fields = Object.fromEntries(PO_FIELDS.map((fd) => [fd.key, f[fd.key]?.value ?? null])) as Record<PoFieldKey, string | null>;
  // A field the AI read but that cannot be saved (e.g. GST "15.12.000.00", delivery "As per requirement")
  // is left blank on the order and named in the remarks; a required one stops the automatic order.
  const blanked: string[] = [];
  for (let i = 0; i < PO_FIELDS.length; i++) {
    try {
      columnsFromFields(fields);
      break;
    } catch (e) {
      const msg = (e as Error).message;
      const fd = PO_FIELDS.find((x) => msg.startsWith(`${x.label}:`));
      if (!fd || fd.required || fields[fd.key] === null) return { intakeId, created: false, reason: msg };
      blanked.push(`${fd.label} "${fields[fd.key]}"`);
      fields[fd.key] = null;
    }
  }
  const proposed = review.proposedCompletion && !fields.completionDate ? ` Delivery date not on the PO (proposed ${review.proposedCompletion.date}).` : '';
  const left = blanked.length ? ` Left blank (could not be read as written): ${blanked.join('; ')}.` : '';
  try {
    const r = await confirmIntake(
      intakeId,
      {
        docketId: docket.id,
        fields,
        lines: review.extraction.lines,
        hold: review.suggestedHold,
        remarks: `Made automatically from the PO mail "${review.mailSubject ?? ''}" – check the PO fields and docket ${docket.docketNo ?? docket.id} (${why}; ${docket.reasons.join(', ')}).${proposed}${left}`.slice(0, 2000),
      },
      N8N_USER,
    );
    return { intakeId, created: true, orderId: r.id, docketNo: docket.docketNo };
  } catch (e) {
    return { intakeId, created: false, reason: (e as Error).message };
  }
}

/** Every PO mail waiting for review, read at least `minAgeMinutes` ago (so n8n has uploaded its files). */
export async function autoCreateOrders(minAgeMinutes = 5): Promise<AutoOrderResult[]> {
  const rows = await prisma.poIntake.findMany({
    where: { status: 'EXTRACTED', source: 'N8N_MAIL', createdAt: { lte: new Date(Date.now() - minAgeMinutes * 60_000) } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const out: AutoOrderResult[] = [];
  for (const r of rows) {
    try {
      out.push(await autoCreateOrder(r.id));
    } catch (e) {
      out.push({ intakeId: r.id, created: false, reason: (e as Error).message });
    }
  }
  return out;
}

/** Received POs (read from mail) that are not orders yet, with why - for the Orders page. */
export async function receivedPosNotOrders() {
  const rows = await prisma.poIntake.findMany({ where: { status: 'EXTRACTED', source: 'N8N_MAIL' }, orderBy: { id: 'desc' }, take: 100, select: { id: true } });
  const out: { intakeId: number; subject: string | null; customer: string | null; poNumber: string | null; poDate: string | null; totalValue: string | null; reason: string }[] = [];
  for (const r of rows) {
    try {
      const rv = await getIntakeReview(r.id);
      const f = rv.extraction.fields;
      const auto = autoDocketPick(rv.dockets, { endClient: f.endClient.value, project: f.project.value, poDate: parseDate(f.poDate.value) }, await docketDates(rv.dockets.map((d) => d.id)));
      const reason = rv.duplicateOf
        ? `Already order #${rv.duplicateOf.orderId} (PO ${rv.duplicateOf.poNumber})`
        : isOldPo(f.poDate.value)
          ? `Old PO (dated ${f.poDate.value}) – check it is not already supplied, then choose the docket and confirm`
          : !auto.pick
          ? `Choose the docket: ${auto.why}`
          : 'Some PO fields could not be saved as read – open it, check and confirm';
      out.push({ intakeId: r.id, subject: rv.mailSubject, customer: f.customerName.value, poNumber: f.poNumber.value, poDate: f.poDate.value, totalValue: f.totalValue.value, reason });
    } catch (e) {
      out.push({ intakeId: r.id, subject: null, customer: null, poNumber: null, poDate: null, totalValue: null, reason: (e as Error).message });
    }
  }
  return out;
}

/**
 * Read a PO again (after the reading rules were improved). Mail intakes go back to n8n with the
 * thread's files (the UI polls intakeForThread); uploads are read again from the stored files. The
 * old reading is discarded and logged as superseded.
 */
export async function rereadIntake(intakeId: number, user: AuthUser) {
  const intake = await prisma.poIntake.findUnique({ where: { id: intakeId }, include: { documents: { orderBy: { id: 'asc' } } } });
  if (!intake) throw new UserError('This PO intake was not found.');
  if (intake.status === 'CONFIRMED') throw new UserError(`Already confirmed as order #${intake.orderId}; edit it on the order's PO tab.`);
  const supersede = async (by: string) => {
    await prisma.poIntake.update({ where: { id: intakeId }, data: { status: 'DISCARDED', error: `Superseded: read again (${by}).` } });
    await prisma.editLog.create({ data: { tableName: 'po_intakes', recordId: intakeId, fieldName: 'status', oldValue: intake.status, newValue: `DISCARDED (read again: ${by})`, ...auditUser(user) } });
  };
  const ref = String(intake.gmailMessageId ?? '');
  if (intake.source === 'N8N_MAIL' && ref.startsWith('thread:')) {
    const fullId = ref.slice('thread:'.length);
    const { threadId, part } = splitThreadId(fullId);
    const t = await getMailThread(threadId);
    if (!t) throw new UserError('Mail not found in the mail archive.');
    if (part) {
      // One PO of a multi-PO mail: read only its own PO file again.
      const poNo = (intake.extracted as unknown as PoExtraction | null)?.fields?.poNumber?.value || part;
      const poFile = fileForPo(t.files, part, null) ?? fileForPo(t.files, poNo, null);
      if (!poFile) throw new UserError(`The PO file of ${poNo} was not found in the mail any more.`);
      const partFiles = filesForPart(t.files, poFile).map((x) => ({ name: x.name, kind: (x === poFile ? 'PO' : x.kind) as DocKind }));
      await supersede('n8n');
      const r = await requestMailRead(threadId, partFiles, user, { partId: fullId, focus: focusLine(poNo, poFile.name) });
      return { mode: 'mail' as const, threadId: fullId, ...r };
    }
    const files = t.files.filter((x) => x.driveId && (x.kind === 'PO' || x.kind === 'BOM' || x.kind === 'DRAWING')).map((x) => ({ name: x.name, kind: x.kind as DocKind }));
    if (!files.some((x) => x.kind === 'PO')) throw new UserError('No PO copy found in the mail any more.');
    await supersede('n8n');
    const r = await requestMailRead(threadId, files, user);
    return { mode: 'mail' as const, threadId, ...r };
  }
  const files: IntakeFile[] = [];
  for (const d of intake.documents) {
    if (!d.s3Key) continue;
    const obj = await getObject(d.s3Key);
    if (obj) files.push({ name: d.fileName, type: d.mimeType ?? geminiMimeOf(d.fileName) ?? 'application/octet-stream', buffer: Buffer.from(obj.body), kind: d.kind as DocKind });
  }
  if (!files.some((x) => x.kind === 'PO')) throw new UserError('The stored PO copy was not found; attach it again.');
  await supersede('upload');
  const review = await startIntake(files, { source: intake.source === 'MAILBOX' ? 'MAILBOX' : 'UPLOAD', gmailMessageId: intake.gmailMessageId, mailSubject: intake.mailSubject }, user);
  return { mode: 'upload' as const, review };
}
