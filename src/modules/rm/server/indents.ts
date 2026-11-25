import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import type { AuthUser } from '@/lib/auth/server';
import { fetchFacet, fetchPage, plain, type FieldSql, type TableSpec } from '@/lib/serverTable';
import { planWithComparison, type BarPattern, type IndentPlan, type PlanComparison, type StockUse, type Strategy } from '@/lib/planning/cutting';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import type { IndentDetail, IndentRow, IndentSettingsSnapshot, IndentsMeta } from '../columns';
import { audit, loadPlanningInput, lockOrder, nextIndentNo, type Tx } from './common';

const sql = Prisma.sql;
/** Planning a large BOM can take longer than Prisma's 5 s default. */
const PLAN_TX = { timeout: 60_000, maxWait: 10_000 };

interface StoredPlan {
  patterns: BarPattern[];
  warnings: string[];
  /** Store offcuts / bars deducted (read by the Excel export's OFFCUT USED sheet). */
  stock?: StockUse[];
}

/** Persist a plan as an indent with its lines. */
export async function saveIndent(
  tx: Tx,
  orderId: number,
  plan: IndentPlan,
  opts: { kind: 'PRIMARY' | 'SUPPLEMENTARY'; settings: IndentSettingsSnapshot; comparison: PlanComparison | null; bomUploadId: number | null; remarks?: string | null },
  user: AuthUser,
) {
  const indentNo = await nextIndentNo(tx, orderId);
  const stored: StoredPlan = { patterns: plan.patterns, warnings: plan.warnings, ...(plan.stock ? { stock: plan.stock } : {}) };
  const indent = await tx.rmIndent.create({
    data: {
      orderId,
      indentNo,
      kind: opts.kind,
      strategy: plan.strategy,
      status: 'DRAFT',
      bomUploadId: opts.bomUploadId,
      settings: opts.settings as unknown as Prisma.InputJsonValue,
      comparison: opts.comparison ? (opts.comparison as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      plan: stored as unknown as Prisma.InputJsonValue,
      totalBars: plan.totals.bars + plan.totals.bufferBars,
      totalWtKg: plan.totals.wtKg,
      remarks: opts.remarks ?? null,
      createdById: user.id,
      createdByName: user.name,
      lines: {
        create: plan.lines.map((l) => ({
          sectionKey: l.sectionKey,
          sectionLabel: l.sectionLabel,
          barLengthMm: l.barLengthMm,
          lineType: l.lineType,
          forMark: l.forMark,
          piecesPerBar: l.piecesPerBar,
          bars: l.bars,
          bufferBars: l.bufferBars,
          kgPerM: l.kgPerM,
          wtKg: l.wtKg,
        })),
      },
    },
    select: { id: true, indentNo: true },
  });
  await audit(tx, user, 'rm_indents', indent.id, 'ALL_FIELDS', 'NONE (New Record)', {
    orderId,
    indentNo,
    kind: opts.kind,
    strategy: plan.strategy,
    bars: plan.totals.bars + plan.totals.bufferBars,
    wtKg: plan.totals.wtKg,
  });
  return indent;
}

/** Draft PRIMARY indent from the order's "✓ Correct" BOM. Both strategies are computed for the comparison. */
export async function generateIndent(orderId: number, strategyIn: unknown, remarks: unknown, user: AuthUser) {
  const strategy: Strategy = strategyIn === 'STANDARD' ? 'STANDARD' : strategyIn === 'MIXED' ? 'MIXED' : (() => { throw new UserError('Choose Mixed or 6 m only.'); })();
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const input = await loadPlanningInput(tx, orderId);
    let result;
    try {
      result = planWithComparison(input.pieces, input.sections, input.settings, strategy);
    } catch (e) {
      throw new UserError(`Plan failed: ${(e as Error).message}`);
    }
    const plan = { ...result.plan, warnings: [...input.warnings, ...result.plan.warnings] };
    return saveIndent(
      tx,
      orderId,
      plan,
      {
        kind: 'PRIMARY',
        settings: { ...input.settings, confirmed: input.settingsConfirmed },
        comparison: result.comparison,
        bomUploadId: input.uploadId,
        remarks: String(remarks ?? '').trim().slice(0, 1000) || null,
      },
      user,
    );
  }, PLAN_TX);
}

async function lockIndent(tx: Tx, id: number) {
  const ind = await tx.rmIndent.findUnique({ where: { id }, select: { id: true, orderId: true, status: true, kind: true, indentNo: true } });
  if (!ind) throw new UserError('Indent not found.');
  await lockOrder(tx, ind.orderId);
  const fresh = await tx.rmIndent.findUnique({ where: { id }, select: { id: true, orderId: true, status: true, kind: true, indentNo: true } });
  if (!fresh) throw new UserError('Indent not found.');
  return fresh;
}

/**
 * Issue (lock) a draft. Only one ISSUED primary indent per order: cancel the old one to re-issue.
 * A primary indent made from an older BOM upload cannot be issued.
 */
export async function issueIndent(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const ind = await lockIndent(tx, id);
    if (ind.status !== 'DRAFT') throw new UserError(`Indent ${ind.indentNo} is ${ind.status.toLowerCase()}; only drafts can be issued.`);
    if (ind.kind === 'PRIMARY') {
      const other = await tx.rmIndent.findFirst({ where: { orderId: ind.orderId, kind: 'PRIMARY', status: 'ISSUED' }, select: { indentNo: true } });
      if (other) throw new UserError(`Indent ${other.indentNo} is already issued for this order. Cancel it first to issue a new one.`);
      const full = await tx.rmIndent.findUnique({ where: { id }, select: { bomUploadId: true } });
      const latest = await tx.bomUpload.findFirst({ where: { orderId: ind.orderId }, orderBy: { id: 'desc' }, select: { id: true, status: true } });
      if (!latest || latest.id !== full?.bomUploadId || latest.status !== 'CORRECT') {
        throw new UserError('The BOM changed after this draft was made. Generate a new indent from the current BOM.');
      }
    }
    await tx.rmIndent.update({ where: { id }, data: { status: 'ISSUED', issuedByName: user.name, issuedAt: new Date() } });
    await audit(tx, user, 'rm_indents', id, 'status', 'DRAFT', 'ISSUED');
    return { id };
  });
}

export async function cancelIndent(id: number, reason: unknown, user: AuthUser) {
  const why = String(reason ?? '').trim().slice(0, 500);
  if (!why) throw new UserError('Give a reason for cancelling.');
  return prisma.$transaction(async (tx) => {
    const ind = await lockIndent(tx, id);
    if (ind.status === 'CANCELLED') throw new UserError('Already cancelled.');
    await tx.rmIndent.update({ where: { id }, data: { status: 'CANCELLED', remarks: why } });
    await audit(tx, user, 'rm_indents', id, 'status', ind.status, `CANCELLED: ${why}`);
    return { id };
  });
}

/** Admin: delete a draft (issued/cancelled indents are kept as record). */
export async function deleteIndent(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const ind = await lockIndent(tx, id);
    if (ind.status !== 'DRAFT') throw new UserError('Only draft indents can be deleted; cancel an issued one instead.');
    const full = await tx.rmIndent.findUnique({ where: { id }, include: { lines: true } });
    await tx.cuttingPlan.updateMany({ where: { supplementaryIndentId: id }, data: { supplementaryIndentId: null } });
    await tx.rmIndent.delete({ where: { id } });
    await audit(tx, user, 'rm_indents', id, 'DELETED', { ...full, settings: undefined, comparison: undefined, plan: undefined }, null);
    return { id };
  });
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

export async function listOrderIndents(orderId: number): Promise<IndentDetail[]> {
  const rows = await prisma.rmIndent.findMany({ where: { orderId }, orderBy: { id: 'desc' }, include: { lines: { orderBy: { id: 'asc' } } } });
  return rows.map((r) => {
    const stored = (r.plan ?? { patterns: [], warnings: [] }) as unknown as StoredPlan;
    return {
      id: r.id,
      orderId: r.orderId,
      indentNo: r.indentNo,
      kind: r.kind === 'SUPPLEMENTARY' ? 'SUPPLEMENTARY' : 'PRIMARY',
      strategy: r.strategy === 'STANDARD' ? 'STANDARD' : 'MIXED',
      status: (['DRAFT', 'ISSUED', 'CANCELLED'].includes(r.status) ? r.status : 'DRAFT') as IndentDetail['status'],
      settings: r.settings as unknown as IndentSettingsSnapshot,
      comparison: (r.comparison ?? null) as unknown as PlanComparison | null,
      patterns: stored.patterns ?? [],
      warnings: stored.warnings ?? [],
      lines: r.lines.map((l) => ({
        id: l.id,
        sectionKey: l.sectionKey,
        sectionLabel: l.sectionLabel ?? l.sectionKey,
        barLengthMm: l.barLengthMm,
        lineType: l.lineType as IndentDetail['lines'][number]['lineType'],
        forMark: l.forMark,
        piecesPerBar: l.piecesPerBar,
        bars: l.bars,
        bufferBars: l.bufferBars,
        kgPerM: num(l.kgPerM) ?? 0,
        wtKg: num(l.wtKg) ?? 0,
      })),
      totalBars: r.totalBars,
      totalWtKg: r.totalWtKg.toNumber(),
      remarks: r.remarks,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      issuedByName: r.issuedByName,
      issuedAt: r.issuedAt?.toISOString() ?? null,
    };
  });
}

// ------------------------------------------------------------- cross-order list

const txt = (e: Prisma.Sql): FieldSql => ({ text: e, kind: 'text' });
const SPEC: TableSpec = {
  from: sql`rm_indents r JOIN orders o ON o.id = r.order_id JOIN "docket-party-name" d ON d.id = o.docket_id`,
  fallbackOrder: sql`r.created_at DESC, r.id DESC`,
  fields: {
    id: { text: sql`r.id::text`, raw: sql`r.id`, kind: 'number', searchable: false },
    orderId: { text: sql`r.order_id::text`, raw: sql`r.order_id`, kind: 'number', searchable: false },
    indentNo: txt(sql`r.indent_no`),
    poNumber: txt(sql`o.po_number`),
    client: txt(sql`coalesce(nullif(o.client, ''), d.party_name)`),
    kind: txt(sql`(CASE r.kind WHEN 'SUPPLEMENTARY' THEN 'Supplementary' ELSE 'Primary' END)`),
    strategy: txt(sql`(CASE r.strategy WHEN 'STANDARD' THEN '6 m only' ELSE 'Mixed' END)`),
    status: txt(sql`initcap(r.status)`),
    totalBars: { text: sql`r.total_bars::text`, raw: sql`r.total_bars`, kind: 'number', searchable: false },
    totalMt: { text: sql`round(r.total_wt_kg / 1000, 3)::text`, raw: sql`round(r.total_wt_kg / 1000, 3)::float`, kind: 'number', searchable: false },
    createdAt: { text: sql`to_char(r.created_at, 'YYYY-MM-DD')`, raw: sql`r.created_at`, kind: 'date', searchable: false },
    createdByName: txt(sql`r.created_by_name`),
  },
};

const AGG = sql`count(*)::int AS total,
  coalesce(sum(r.total_wt_kg) FILTER (WHERE r.status <> 'CANCELLED'), 0)::float / 1000 AS "totalMt",
  coalesce(sum(r.total_wt_kg) FILTER (WHERE r.status = 'ISSUED'), 0)::float / 1000 AS "issuedMt",
  count(*) FILTER (WHERE r.status = 'DRAFT')::int AS drafts`;

export async function listIndents(query: TableQuery): Promise<TablePage<IndentRow, IndentsMeta>> {
  const { rows, agg } = await fetchPage<IndentRow, IndentsMeta & { total: number }>(SPEC, query, AGG);
  const { total, ...meta } = agg;
  return { rows: plain(rows), total, meta };
}
export const listIndentsFacet = (key: string, query: TableQuery) => fetchFacet(SPEC, key, query);
