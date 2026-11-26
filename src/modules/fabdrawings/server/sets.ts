import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { currentCuttingHash } from './generate';

// Part 2: revisions of a fabrication drawing, issue to production, "confirmed by production", and
// the cutting gate. DRAFT -> ISSUED -> CONFIRMED; issuing or confirming a Rev supersedes the older
// issued / confirmed Revs of the same drawing no. A Rev whose BOM changed since it was made is
// OUT OF DATE (not stored: worked out from the cutting-list hash) and cannot be issued or confirmed.

type Tx = Prisma.TransactionClient;

export interface DrawingSetView {
  id: number;
  drawingNo: string;
  rev: number;
  status: string;
  outOfDate: boolean;
  itemBomId: number | null;
  pageCount: number | null;
  changeNote: string | null;
  preparedByName: string | null;
  createdAt: string;
  issuedTo: string | null;
  issuedAt: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  confirmRemarks: string | null;
  toConfirm: string[];
  confirmedItems: { text: string; ok: boolean }[] | null;
  hasPdf: boolean;
  issues: { sentAt: string; sentTo: string; cc: string | null; sentByName: string | null; result: string; note: string | null }[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function isOutOfDate(s: { itemBomId: number | null; itemCode: string; cuttingHash: string | null; status: string }) {
  if (!s.itemBomId || !s.cuttingHash || s.status === 'SUPERSEDED') return false;
  try {
    return (await currentCuttingHash(s.itemBomId, s.itemCode)) !== s.cuttingHash;
  } catch {
    // BOM no longer confirmed / deleted: the drawing cannot stand.
    return true;
  }
}

/** Drawing revisions of an item BOM (or every BOM of a docket), newest first. */
export async function listDrawingSets(where: { itemBomId?: number; docketId?: number }): Promise<DrawingSetView[]> {
  if (!where.itemBomId && !where.docketId) throw new UserError('Give the BOM or the docket.');
  const sets = await prisma.fabDrawingSet.findMany({
    where: where.itemBomId ? { itemBomId: where.itemBomId } : { docketId: where.docketId },
    include: { issues: { orderBy: { sentAt: 'desc' } } },
    orderBy: [{ drawingNo: 'asc' }, { rev: 'desc' }],
  });
  const out: DrawingSetView[] = [];
  for (const s of sets) {
    const snap = (s.snapshot ?? {}) as { toConfirm?: string[] };
    out.push({
      id: s.id,
      drawingNo: s.drawingNo,
      rev: s.rev,
      status: s.status,
      outOfDate: await isOutOfDate(s),
      itemBomId: s.itemBomId,
      pageCount: s.pageCount,
      changeNote: s.changeNote,
      preparedByName: s.preparedByName,
      createdAt: s.createdAt.toISOString(),
      issuedTo: s.issuedTo,
      issuedAt: iso(s.issuedAt),
      confirmedByName: s.confirmedByName,
      confirmedAt: iso(s.confirmedAt),
      confirmRemarks: s.confirmRemarks,
      toConfirm: snap.toConfirm ?? [],
      confirmedItems: (s.confirmedItems as { text: string; ok: boolean }[] | null) ?? null,
      hasPdf: !!s.s3Key,
      issues: s.issues.map((i) => ({ sentAt: i.sentAt.toISOString(), sentTo: i.sentTo, cc: i.cc, sentByName: i.sentByName, result: i.result, note: i.note })),
    });
  }
  return out;
}

async function supersedeOlder(tx: Tx, set: { id: number; drawingNo: string; rev: number }, user: AuthUser) {
  const older = await tx.fabDrawingSet.findMany({ where: { drawingNo: set.drawingNo, rev: { lt: set.rev }, status: { in: ['DRAFT', 'ISSUED', 'CONFIRMED'] } }, select: { id: true, rev: true, status: true } });
  for (const o of older) {
    await tx.fabDrawingSet.update({ where: { id: o.id }, data: { status: 'SUPERSEDED' } });
    await tx.editLog.create({ data: { tableName: 'fab_drawing_sets', recordId: o.id, fieldName: 'status', oldValue: o.status, newValue: `SUPERSEDED by Rev ${set.rev}`, ...auditUser(user) } });
  }
}

const EMAILS = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const emailList = (v: unknown) =>
  String(v ?? '')
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Issue a DRAFT Rev to production (Satya), cc management. The dashboard cannot send mail from the
 * company Gmail: the issue is logged as PENDING with the PDF stored, and the mail is sent by hand
 * (or by the n8n "send fabrication drawing" flow once it is set up) – result then marked SENT.
 */
export async function issueDrawingSet(setId: number, input: { to?: unknown; cc?: unknown; note?: unknown; sent?: unknown }, user: AuthUser) {
  const to = emailList(input.to);
  const cc = emailList(input.cc);
  if (to.length === 0) throw new UserError('Give the production e-mail to issue to.');
  const bad = [...to, ...cc].filter((e) => !EMAILS.test(e));
  if (bad.length) throw new UserError(`Not an e-mail address: ${bad.join(', ')}.`);
  const set = await prisma.fabDrawingSet.findUnique({ where: { id: setId } });
  if (!set) throw new UserError('Drawing revision not found.');
  if (set.status !== 'DRAFT') throw new UserError(`${set.drawingNo} Rev ${set.rev} is ${set.status.toLowerCase()}; only a draft can be issued.`);
  if (await isOutOfDate(set)) throw new UserError(`The BOM changed after ${set.drawingNo} Rev ${set.rev} was made: generate the drawing again before issuing.`);
  return prisma.$transaction(async (tx) => {
    await tx.fabDrawingSet.update({ where: { id: setId }, data: { status: 'ISSUED', issuedTo: to.join(', '), issuedAt: new Date() } });
    const sent = input.sent === true;
    await tx.fabDrawingIssue.create({
      data: { setId, sentTo: to.join(', '), cc: cc.join(', ') || null, sentByName: user.name, result: sent ? 'SENT' : 'PENDING', note: String(input.note ?? '').trim().slice(0, 500) || (sent ? 'Sent by hand' : 'To send – PDF attached to the mail by hand') },
    });
    await supersedeOlder(tx, set, user);
    await tx.editLog.create({ data: { tableName: 'fab_drawing_sets', recordId: setId, fieldName: 'status', oldValue: 'DRAFT', newValue: `ISSUED to ${to.join(', ')}${cc.length ? ` cc ${cc.join(', ')}` : ''}`, ...auditUser(user) } });
    return { id: setId, status: 'ISSUED' };
  });
}

/** Mark the last issue of a Rev as sent (mail went out by hand). */
export async function markIssueSent(setId: number, user: AuthUser) {
  const last = await prisma.fabDrawingIssue.findFirst({ where: { setId }, orderBy: { sentAt: 'desc' } });
  if (!last) throw new UserError('This revision has not been issued.');
  await prisma.$transaction([
    prisma.fabDrawingIssue.update({ where: { id: last.id }, data: { result: 'SENT', note: `${last.note ?? ''} · sent, marked by ${user.name}`.slice(0, 500) } }),
    prisma.editLog.create({ data: { tableName: 'fab_drawing_issues', recordId: last.id, fieldName: 'result', oldValue: last.result, newValue: 'SENT', ...auditUser(user) } }),
  ]);
  return { id: last.id };
}

/**
 * "Confirmed by production": every to-be-confirmed point ticked (or the remarks say why not), then the
 * Rev is CONFIRMED and cutting may start. A change wanted = remarks + a new Rev instead.
 */
export async function confirmDrawingSet(setId: number, input: { items?: unknown; remarks?: unknown }, user: AuthUser) {
  const set = await prisma.fabDrawingSet.findUnique({ where: { id: setId } });
  if (!set) throw new UserError('Drawing revision not found.');
  if (set.status !== 'ISSUED') throw new UserError(`${set.drawingNo} Rev ${set.rev} is ${set.status.toLowerCase()}; issue it to production first.`);
  if (await isOutOfDate(set)) throw new UserError(`The BOM changed after ${set.drawingNo} Rev ${set.rev} was made: make a new Rev; this one cannot be confirmed.`);
  const toConfirm = ((set.snapshot ?? {}) as { toConfirm?: string[] }).toConfirm ?? [];
  const ticked = new Set(Array.isArray(input.items) ? input.items.map(Number).filter((n) => Number.isInteger(n)) : []);
  const items = toConfirm.map((text, i) => ({ text, ok: ticked.has(i) }));
  const remarks = String(input.remarks ?? '').trim().slice(0, 1000);
  const open = items.filter((x) => !x.ok);
  if (open.length && !remarks) throw new UserError(`${open.length} point(s) not ticked: tick them, or write in the remarks how production will handle them.`);
  return prisma.$transaction(async (tx) => {
    await tx.fabDrawingSet.update({ where: { id: setId }, data: { status: 'CONFIRMED', confirmedByName: user.name, confirmedAt: new Date(), confirmRemarks: remarks || null, confirmedItems: items as unknown as Prisma.InputJsonValue } });
    await supersedeOlder(tx, set, user);
    await tx.editLog.create({ data: { tableName: 'fab_drawing_sets', recordId: setId, fieldName: 'status', oldValue: 'ISSUED', newValue: `CONFIRMED by production (${items.length - open.length}/${items.length} points ticked)${remarks ? `: ${remarks}` : ''}`, ...auditUser(user) } });
    return { id: setId, status: 'CONFIRMED' };
  });
}

/** PDF of a stored revision. */
export async function drawingSetPdf(setId: number) {
  const set = await prisma.fabDrawingSet.findUnique({ where: { id: setId }, select: { s3Key: true, drawingNo: true, rev: true } });
  if (!set?.s3Key) throw new UserError('No stored PDF for this revision: generate it again.');
  const { getObject } = await import('@/lib/s3');
  const o = await getObject(set.s3Key);
  if (!o) throw new UserError('The stored PDF was not found.');
  return { fileName: `${set.drawingNo.replace(/\//g, '_')}_Rev${set.rev}.pdf`, base64: Buffer.from(o.body).toString('base64') };
}

// ------------------------------------------------------------------ cutting gate

export interface CuttingGate {
  /** false = no drawing is used for this order (legacy): cutting is not held. */
  applies: boolean;
  ok: boolean;
  reason: string | null;
}

/**
 * Cutting (cropping / shearing) of an order may start only when the fabrication drawings of its
 * docket are confirmed by production and still match the BOM. Orders whose docket has no drawing
 * set yet are not held (drawings started 25-11; older orders run as before).
 */
export async function cuttingGate(orderId: number): Promise<CuttingGate> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { docketId: true } });
  if (!order?.docketId) return { applies: false, ok: true, reason: null };
  const sets = await prisma.fabDrawingSet.findMany({ where: { docketId: order.docketId, status: { not: 'SUPERSEDED' } }, orderBy: [{ drawingNo: 'asc' }, { rev: 'desc' }] });
  if (sets.length === 0) return { applies: false, ok: true, reason: null };
  const latest = new Map<string, (typeof sets)[number]>();
  for (const s of sets) if (!latest.has(s.drawingNo)) latest.set(s.drawingNo, s);
  const problems: string[] = [];
  for (const s of latest.values()) {
    if (s.status !== 'CONFIRMED') problems.push(`${s.drawingNo} Rev ${s.rev} is ${s.status.toLowerCase()}`);
    else if (await isOutOfDate(s)) problems.push(`${s.drawingNo} Rev ${s.rev} is out of date (BOM changed)`);
  }
  return problems.length ? { applies: true, ok: false, reason: `Fabrication drawing not confirmed by production: ${problems.join('; ')}.` } : { applies: true, ok: true, reason: null };
}
