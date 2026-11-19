import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import type { AuthUser } from '@/lib/auth/server';
import { sectionKey as toSectionKey } from '@/lib/bom/parse';
import { fetchFacet, fetchPage, plain, type FieldSql, type TableSpec } from '@/lib/serverTable';
import { replan, type CutSettings, type ReplanResult } from '@/lib/planning/cutting';
import { getPlanSettings } from '@/modules/settings/server';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { LOT_DECISIONS, type CuttingPlanView, type LotDecision, type LotRow, type LotsMeta, type ReceiptOptions, type ReceiptView } from '../columns';
import { audit, loadPlanningInput, lockOrder, type Tx } from './common';
import { saveIndent } from './indents';

const sql = Prisma.sql;
/** Planning a large BOM can take longer than Prisma's 5 s default. */
const PLAN_TX = { timeout: 60_000, maxWait: 10_000 };
type Input = Record<string, unknown>;

const str = (v: unknown, max = 200) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const int = (v: unknown, label: string, min: number, max: number) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  const n = Number(s);
  if (!s || !Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const optKg = (v: unknown, label: string) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${label} must be a positive number.`);
  return Math.round(n * 1000) / 1000;
};
const reqDate = (v: unknown, label: string) => {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new UserError(`${label} is required.`);
  return new Date(`${s}T00:00:00Z`);
};

/** OK / SHORT (below ordered: no negative tolerance) / OVER_TOL (above ordered + plus tolerance). */
export function lengthStatusOf(ordered: number, measured: number, tolPlusMm: number): 'OK' | 'SHORT' | 'OVER_TOL' {
  if (measured < ordered) return 'SHORT';
  if (measured > ordered + tolPlusMm) return 'OVER_TOL';
  return 'OK';
}

/** Sections the order's current BOM uses (key -> label), GTP label first. */
async function bomSections(tx: Tx | typeof prisma, orderId: number) {
  const rows = await tx.$queryRaw<{ key: string; label: string }[]>(sql`SELECT p.section_key AS key,
      coalesce(max(s.label), max(p.section), p.section_key) AS label
    FROM bom_pieces p LEFT JOIN section_master s ON s.section_key = p.section_key
    WHERE p.upload_id = (SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = ${orderId}) AND p.section_key IS NOT NULL
    GROUP BY p.section_key ORDER BY 2`);
  return new Map(rows.map((r) => [r.key, r.label]));
}

export async function receiptOptions(orderId: number): Promise<ReceiptOptions> {
  const [sections, indents, settings] = await Promise.all([
    bomSections(prisma, orderId),
    prisma.rmIndent.findMany({ where: { orderId, status: { not: 'CANCELLED' } }, orderBy: { id: 'desc' }, select: { id: true, indentNo: true, kind: true, status: true, lines: { select: { sectionKey: true, barLengthMm: true } } } }),
    getPlanSettings(),
  ]);
  const lengths = new Map<string, { sectionKey: string; barLengthMm: number }>();
  for (const i of indents) for (const l of i.lines) lengths.set(`${l.sectionKey}|${l.barLengthMm}`, l);
  return {
    sections: [...sections].map(([sectionKey, label]) => ({ sectionKey, label })),
    indents: indents.map((i) => ({ id: i.id, indentNo: i.indentNo, kind: i.kind, status: i.status })),
    orderedLengths: [...lengths.values()].sort((a, b) => a.sectionKey.localeCompare(b.sectionKey) || b.barLengthMm - a.barLengthMm),
    tolPlusMm: settings.tolPlusMm,
  };
}

/** GRN with its lots. Length status is computed here; a SHORT lot defaults to REJECTED. */
export async function addReceipt(orderId: number, i: Input, user: AuthUser) {
  const settings = await getPlanSettings();
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const receiptNo = str(i.receiptNo, 100)?.toUpperCase();
    if (!receiptNo) throw new UserError('Receipt / GRN no is required.');
    if (await tx.rmReceipt.findUnique({ where: { orderId_receiptNo: { orderId, receiptNo } }, select: { id: true } })) {
      throw new UserError(`Receipt ${receiptNo} is already entered on this order.`);
    }
    let indentId: number | null = null;
    if (i.indentId !== null && i.indentId !== undefined && i.indentId !== '') {
      const ind = await tx.rmIndent.findUnique({ where: { id: Number(i.indentId) || 0 }, select: { id: true, orderId: true, status: true } });
      if (!ind || ind.orderId !== orderId) throw new UserError('That indent is not on this order.');
      if (ind.status === 'CANCELLED') throw new UserError('That indent is cancelled.');
      indentId = ind.id;
    }
    const sections = await bomSections(tx, orderId);
    const rawLots = (Array.isArray(i.lots) ? i.lots : []) as Input[];
    const lots = rawLots
      .filter((l) => l && (String(l.section ?? '').trim() || String(l.measuredLengthMm ?? '').trim() || String(l.nos ?? '').trim()))
      .map((l, n) => {
        const label = `Lot ${n + 1}`;
        const rawSection = String(l.section ?? '').trim();
        const key = sections.has(rawSection) ? rawSection : toSectionKey(rawSection);
        if (!key) throw new UserError(`${label}: section is required.`);
        if (!sections.has(key)) throw new UserError(`${label}: section ${l.section} is not in this order's BOM.`);
        const ordered = int(l.orderedLengthMm, `${label}: ordered length (mm)`, 100, 20000);
        const measured = int(l.measuredLengthMm, `${label}: measured length (mm)`, 100, 20000);
        const nos = int(l.nos, `${label}: nos`, 1, 1_000_000);
        const status = lengthStatusOf(ordered, measured, settings.tolPlusMm);
        const wanted = String(l.decision ?? '').toUpperCase();
        const decision: LotDecision = (LOT_DECISIONS as readonly string[]).includes(wanted) ? (wanted as LotDecision) : status === 'SHORT' ? 'REJECTED' : 'ACCEPTED';
        return {
          sectionKey: key,
          sectionLabel: sections.get(key) ?? key,
          orderedLengthMm: ordered,
          measuredLengthMm: measured,
          nos,
          wtKg: optKg(l.wtKg, `${label}: wt`),
          heatNo: str(l.heatNo, 50),
          lengthStatus: status,
          decision,
          debitNoteNo: decision === 'DEBIT_NOTE' ? str(l.debitNoteNo, 100) : null,
          remarks: str(l.remarks, 500),
        };
      });
    if (lots.length === 0) throw new UserError('Add at least one lot (section, lengths, nos).');

    const receipt = await tx.rmReceipt.create({
      data: {
        orderId,
        indentId,
        receiptNo,
        receiptDate: reqDate(i.date, 'Receipt date'),
        supplier: str(i.supplier),
        invoiceNo: str(i.invoiceNo, 100),
        remarks: str(i.remarks, 1000),
        createdById: user.id,
        createdByName: user.name,
        lots: { create: lots },
      },
      select: { id: true },
    });
    await audit(tx, user, 'rm_receipts', receipt.id, 'ALL_FIELDS', 'NONE (New Record)', { orderId, receiptNo, indentId, lots });

    const notes: string[] = [];
    const short = lots.filter((l) => l.lengthStatus === 'SHORT');
    const over = lots.filter((l) => l.lengthStatus === 'OVER_TOL');
    if (short.length) notes.push(`${short.length} lot(s) below the ordered length (${short.map((l) => `${l.sectionLabel} ${l.measuredLengthMm}/${l.orderedLengthMm} mm`).join(', ')}): reject or raise a debit note.`);
    if (over.length) notes.push(`${over.length} lot(s) longer than ordered + ${settings.tolPlusMm} mm: accepted, check the supplier's invoice weight.`);
    return { id: receipt.id, warning: notes.length ? notes.join(' ') : null };
  });
}

/** Change a lot's decision (and debit note no). Short lots can never be marked plain "Accepted". */
export async function updateLot(lotId: number, i: Input, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const lot = await tx.rmReceiptLot.findUnique({ where: { id: lotId }, include: { receipt: { select: { id: true, orderId: true } } } });
    if (!lot) throw new UserError('Lot not found.');
    await lockOrder(tx, lot.receipt.orderId);
    const wanted = String(i.decision ?? '').toUpperCase();
    if (!(LOT_DECISIONS as readonly string[]).includes(wanted)) throw new UserError('Choose Accepted, Rejected or Accepted on debit note.');
    const decision = wanted as LotDecision;
    if (lot.lengthStatus === 'SHORT' && decision === 'ACCEPTED') {
      throw new UserError('A short lot cannot be accepted as is (no negative tolerance). Reject it or accept it on a debit note.');
    }
    const debitNoteNo = decision === 'DEBIT_NOTE' ? str(i.debitNoteNo, 100) : null;
    await tx.rmReceiptLot.update({ where: { id: lotId }, data: { decision, debitNoteNo } });
    await tx.rmReceipt.update({ where: { id: lot.receipt.id }, data: { updatedAt: new Date() } });
    await audit(tx, user, 'rm_receipt_lots', lotId, 'decision', `${lot.decision}${lot.debitNoteNo ? ` (${lot.debitNoteNo})` : ''}`, `${decision}${debitNoteNo ? ` (${debitNoteNo})` : ''}`);
    return { id: lotId };
  });
}

/** Admin: delete a receipt with its lots. */
export async function deleteReceipt(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.rmReceipt.findUnique({ where: { id }, include: { lots: true } });
    if (!r) throw new UserError('Receipt not found.');
    await lockOrder(tx, r.orderId);
    await tx.rmReceipt.delete({ where: { id } });
    await audit(tx, user, 'rm_receipts', id, 'DELETED', r, null);
    return { id };
  });
}

const n = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function listOrderReceipts(orderId: number): Promise<ReceiptView[]> {
  const rows = await prisma.rmReceipt.findMany({
    where: { orderId },
    orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }],
    include: { lots: { orderBy: { id: 'asc' } }, indent: { select: { indentNo: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    receiptDate: day(r.receiptDate),
    supplier: r.supplier,
    invoiceNo: r.invoiceNo,
    indentNo: r.indent?.indentNo ?? null,
    remarks: r.remarks,
    createdByName: r.createdByName,
    lots: r.lots.map((l) => ({
      id: l.id,
      sectionKey: l.sectionKey,
      sectionLabel: l.sectionLabel,
      orderedLengthMm: l.orderedLengthMm,
      measuredLengthMm: l.measuredLengthMm,
      nos: l.nos,
      wtKg: n(l.wtKg),
      heatNo: l.heatNo,
      lengthStatus: l.lengthStatus as 'OK' | 'SHORT' | 'OVER_TOL',
      decision: l.decision as LotDecision,
      debitNoteNo: l.debitNoteNo,
      remarks: l.remarks,
    })),
  }));
}

// ------------------------------------------------------------- re-plan

interface StoredPlanSettings extends CutSettings {
  bomUploadId: number;
  /** Usable lots at plan time; a different signature now means the plan is stale. */
  lotsSignature: string;
}

/** Usable lots: ACCEPTED, or accepted on a DEBIT_NOTE (bars are in the yard, paid less). REJECTED lots go back. */
async function usableLots(tx: Tx | typeof prisma, orderId: number) {
  const lots = await tx.rmReceiptLot.findMany({
    where: { receipt: { orderId }, decision: { in: ['ACCEPTED', 'DEBIT_NOTE'] } },
    select: { sectionKey: true, measuredLengthMm: true, nos: true },
    orderBy: [{ sectionKey: 'asc' }, { measuredLengthMm: 'asc' }, { id: 'asc' }],
  });
  const signature = lots.map((l) => `${l.sectionKey}:${l.measuredLengthMm}:${l.nos}`).join(',');
  return { lots: lots.map((l) => ({ sectionKey: l.sectionKey, lengthMm: l.measuredLengthMm, nos: l.nos })), signature };
}

/** Plan the BOM on the RM actually received (accepted lots) and save it as the order's current cutting plan. */
export async function runReplan(orderId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const input = await loadPlanningInput(tx, orderId);
    const { lots, signature } = await usableLots(tx, orderId);
    if (lots.length === 0) throw new UserError('No accepted RM lots yet. Enter the RM receipt first.');
    let result: ReplanResult;
    try {
      result = replan(lots, input.pieces, input.sections, input.settings);
    } catch (e) {
      throw new UserError(`Re-plan failed: ${(e as Error).message}`);
    }
    result = { ...result, warnings: [...input.warnings, ...result.warnings] };
    const settings: StoredPlanSettings = { ...input.settings, bomUploadId: input.uploadId, lotsSignature: signature };
    const plan = await tx.cuttingPlan.create({
      data: {
        orderId,
        settings: settings as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        piecesPlanned: result.piecesPlanned,
        piecesShort: result.piecesShort,
        offcuts: result.offcuts.reduce((a, o) => a + o.count, 0),
        createdByName: user.name,
      },
      select: { id: true },
    });
    await audit(tx, user, 'cutting_plans', plan.id, 'ALL_FIELDS', 'NONE (New Record)', {
      orderId,
      piecesPlanned: result.piecesPlanned,
      piecesShort: result.piecesShort,
      lots: lots.length,
    });
    return { id: plan.id, piecesPlanned: result.piecesPlanned, piecesShort: result.piecesShort };
  }, PLAN_TX);
}

export async function latestCuttingPlan(orderId: number): Promise<CuttingPlanView | null> {
  const p = await prisma.cuttingPlan.findFirst({ where: { orderId }, orderBy: { id: 'desc' } });
  if (!p) return null;
  const settings = p.settings as unknown as StoredPlanSettings;
  const [{ signature }, upload, sup] = await Promise.all([
    usableLots(prisma, orderId),
    prisma.bomUpload.findFirst({ where: { orderId }, orderBy: { id: 'desc' }, select: { id: true } }),
    p.supplementaryIndentId ? prisma.rmIndent.findUnique({ where: { id: p.supplementaryIndentId }, select: { indentNo: true } }) : null,
  ]);
  return {
    id: p.id,
    createdAt: p.createdAt.toISOString(),
    createdByName: p.createdByName,
    settings,
    result: p.result as unknown as ReplanResult,
    supplementaryIndentId: p.supplementaryIndentId,
    supplementaryIndentNo: sup?.indentNo ?? null,
    stale: signature !== settings.lotsSignature || upload?.id !== settings.bomUploadId,
  };
}

/** Draft SUPPLEMENTARY indent from the shortfall of the order's current (latest, not stale) cutting plan. */
export async function createSupplementaryIndent(planId: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.cuttingPlan.findUnique({ where: { id: planId }, select: { id: true, orderId: true } });
    if (!p) throw new UserError('Cutting plan not found.');
    await lockOrder(tx, p.orderId);
    const latest = await tx.cuttingPlan.findFirst({ where: { orderId: p.orderId }, orderBy: { id: 'desc' } });
    if (!latest || latest.id !== planId) throw new UserError('A newer cutting plan exists. Use the latest one.');
    if (latest.supplementaryIndentId) throw new UserError('A supplementary indent was already made from this plan.');
    const settings = latest.settings as unknown as StoredPlanSettings;
    const { signature } = await usableLots(tx, p.orderId);
    if (signature !== settings.lotsSignature) throw new UserError('RM receipts changed after this plan. Re-plan first.');
    const result = latest.result as unknown as ReplanResult;
    if (!result.supplementary || result.piecesShort === 0) throw new UserError('Nothing is short: no supplementary indent needed.');
    const confirmed = (await getPlanSettings()).confirmed;
    const indent = await saveIndent(
      tx,
      p.orderId,
      result.supplementary,
      {
        kind: 'SUPPLEMENTARY',
        settings: { ...settings, confirmed },
        comparison: null,
        bomUploadId: settings.bomUploadId,
        remarks: `Shortfall of cutting plan #${planId}: ${result.piecesShort} pieces`,
      },
      user,
    );
    await tx.cuttingPlan.update({ where: { id: planId }, data: { supplementaryIndentId: indent.id } });
    return indent;
  }, PLAN_TX);
}

// ------------------------------------------------------------- cross-order lot list

const txt = (e: Prisma.Sql): FieldSql => ({ text: e, kind: 'text' });
const intf = (e: Prisma.Sql): FieldSql => ({ text: sql`(${e})::text`, raw: e, kind: 'number', searchable: false });
const LOT_SPEC: TableSpec = {
  from: sql`rm_receipt_lots l JOIN rm_receipts r ON r.id = l.receipt_id JOIN orders o ON o.id = r.order_id JOIN "docket-party-name" d ON d.id = o.docket_id`,
  fallbackOrder: sql`r.receipt_date DESC, r.id DESC, l.id ASC`,
  fields: {
    id: { text: sql`l.id::text`, raw: sql`l.id`, kind: 'number', searchable: false },
    orderId: { text: sql`r.order_id::text`, raw: sql`r.order_id`, kind: 'number', searchable: false },
    poNumber: txt(sql`o.po_number`),
    client: txt(sql`coalesce(nullif(o.client, ''), d.party_name)`),
    receiptNo: txt(sql`r.receipt_no`),
    receiptDate: { text: sql`to_char(r.receipt_date, 'YYYY-MM-DD')`, raw: sql`r.receipt_date`, kind: 'date', searchable: false },
    supplier: txt(sql`r.supplier`),
    section: txt(sql`coalesce(l.section_label, l.section_key)`),
    orderedLengthMm: intf(sql`l.ordered_length_mm`),
    measuredLengthMm: intf(sql`l.measured_length_mm`),
    diffMm: intf(sql`(l.measured_length_mm - l.ordered_length_mm)`),
    nos: intf(sql`l.nos`),
    wtKg: { text: sql`l.wt_kg::text`, raw: sql`l.wt_kg::float`, kind: 'number', searchable: false },
    heatNo: txt(sql`l.heat_no`),
    lengthStatus: txt(sql`(CASE l.length_status WHEN 'SHORT' THEN 'Short' WHEN 'OVER_TOL' THEN 'Over tolerance' ELSE 'OK' END)`),
    decision: txt(sql`(CASE l.decision WHEN 'REJECTED' THEN 'Rejected' WHEN 'DEBIT_NOTE' THEN 'Accepted on debit note' ELSE 'Accepted' END)`),
    debitNoteNo: txt(sql`l.debit_note_no`),
  },
};

const LOT_AGG = sql`count(*)::int AS total, coalesce(sum(l.nos), 0)::int AS nos,
  coalesce(sum(l.wt_kg) FILTER (WHERE l.decision <> 'REJECTED'), 0)::float / 1000 AS "wtMt",
  count(*) FILTER (WHERE l.length_status = 'SHORT')::int AS "shortLots",
  coalesce(sum(l.nos) FILTER (WHERE l.decision = 'REJECTED'), 0)::int AS "rejectedNos"`;

/** "short" quick filter from the KPI tile. */
const lotExtra = (q: TableQuery) => (q.extra?.short === '1' ? [sql`l.length_status = 'SHORT'`] : []);

export async function listLots(query: TableQuery): Promise<TablePage<LotRow, LotsMeta>> {
  const { rows, agg } = await fetchPage<LotRow, LotsMeta & { total: number }>(LOT_SPEC, query, LOT_AGG, lotExtra(query));
  const { total, ...meta } = agg;
  return { rows: plain(rows), total, meta };
}
export const listLotsFacet = (key: string, query: TableQuery) => fetchFacet(LOT_SPEC, key, query, lotExtra(query));
