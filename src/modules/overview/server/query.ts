import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchFacet, fetchPage, plain, type TableSpec } from '@/lib/serverTable';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { getPlanSettings } from '@/modules/settings/server';
import { ORDER_STATS, OUTSTANDING_SQL, STATUS_SQL } from '@/modules/orders/server/query';
import { CLOSED_STATUSES, ORDER_STATUSES } from '@/modules/orders/columns';
import { orderBottlenecks } from '@/modules/production/server/bottleneck';
import { AGEING_SQL, INVOICE_OUTSTANDING } from '@/modules/registers/server/query';
import { flagCountsSql, listFlags } from './flags';
import type { AgeingBucket, OrderSummary, OverviewMeta, OverviewRow, OverviewStats, Pipeline } from '../types';

const sql = Prisma.sql;

const LATEST_UPLOAD = sql`(SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = o.id)`;
/** BOM unit weight (kg/piece) of a mark in the order's current BOM. */
const unitWt = (mark: Prisma.Sql) => sql`(SELECT sum(p.total_wt_kg) / nullif(sum(p.total_qty), 0) FROM bom_pieces p
  WHERE p.upload_id = ${LATEST_UPLOAD} AND upper(p.mark_no) = upper(${mark}))`;

/**
 * Weight pipeline per order, as lateral `m` (needs ORDER_STATS `s` before it):
 *  ordered = current BOM weight, or quoted MT when there is no BOM yet;
 *  cut = cutting entries (CROPPING / SHEARING) x the mark's BOM unit weight;
 *  galvanised = galvanised weight of IN challans (pieces x unit weight where the weight is blank);
 *  inspected = weight cleared at client inspection/MC; dispatched = dispatch weight.
 */
export const ORDER_METRICS = sql`LEFT JOIN LATERAL (
  SELECT
    coalesce(nullif(s.bom_wt, 0), s.quoted_mt * 1000) AS ordered_kg,
    (SELECT sum(pe.pieces * ${unitWt(sql`pe.mark_no`)}) FROM production_entries pe
       WHERE pe.order_id = o.id AND pe.operation IN ('CROPPING', 'SHEARING')) AS cut_kg,
    (SELECT sum(coalesce(g.galv_wt_kg,
        (SELECT sum(l.pieces * ${unitWt(sql`l.mark_no`)}) FROM galv_challan_lines l WHERE l.challan_id = g.id)))
       FROM galv_challans g WHERE g.order_id = o.id AND g.direction = 'IN') AS galv_kg,
    (SELECT sum(i.wt_cleared_kg) FROM inspections i WHERE i.order_id = o.id) AS insp_kg
) m ON TRUE`;

const r3 = (e: Prisma.Sql) => ({ text: sql`round((${e})::numeric, 3)::text`, raw: sql`round((${e})::numeric, 3)::float`, kind: 'number' as const, searchable: false });
const r0 = (e: Prisma.Sql) => ({ text: sql`round((${e})::numeric, 0)::text`, raw: sql`round((${e})::numeric, 2)::float`, kind: 'number' as const, searchable: false });

async function overviewSpec(): Promise<TableSpec> {
  const cfg = await getPlanSettings();
  return {
    from: sql`orders o JOIN "docket-party-name" d ON d.id = o.docket_id ${ORDER_STATS} ${ORDER_METRICS}
      LEFT JOIN ${flagCountsSql(cfg)} fc ON fc.order_id = o.id`,
    fallbackOrder: sql`coalesce(fc.high, 0) DESC, coalesce(fc.n, 0) DESC, o.po_date ASC, o.id ASC`,
    fields: {
      id: { text: sql`o.id::text`, raw: sql`o.id`, kind: 'number', searchable: false },
      poNumber: { text: sql`o.po_number`, kind: 'text' },
      poDate: { text: sql`to_char(o.po_date, 'YYYY-MM-DD')`, raw: sql`o.po_date`, kind: 'date', searchable: false },
      client: { text: sql`coalesce(nullif(o.client, ''), d.party_name)`, kind: 'text' },
      docketNo: { text: sql`coalesce(d.docket_no_qtn_no, o.docket_no)`, kind: 'text' },
      status: { text: STATUS_SQL, kind: 'text' },
      daysSincePo: { text: sql`(CURRENT_DATE - o.po_date)::text`, raw: sql`(CURRENT_DATE - o.po_date)`, kind: 'number', searchable: false },
      deliveryDue: { text: sql`to_char(o.delivery_due, 'YYYY-MM-DD')`, raw: sql`o.delivery_due`, kind: 'date', searchable: false },
      daysLate: {
        text: sql`(CASE WHEN o.delivery_due < CURRENT_DATE AND ${STATUS_SQL} NOT IN ('Dispatched', 'Billed', 'Closed', 'Cancelled', 'Superseded') THEN CURRENT_DATE - o.delivery_due END)::text`,
        raw: sql`(CASE WHEN o.delivery_due < CURRENT_DATE AND ${STATUS_SQL} NOT IN ('Dispatched', 'Billed', 'Closed', 'Cancelled', 'Superseded') THEN CURRENT_DATE - o.delivery_due END)`,
        kind: 'number',
        searchable: false,
      },
      orderedMt: r3(sql`m.ordered_kg / 1000`),
      cutMt: r3(sql`m.cut_kg / 1000`),
      galvanisedMt: r3(sql`m.galv_kg / 1000`),
      inspectedMt: r3(sql`m.insp_kg / 1000`),
      dispatchedMt: r3(sql`s.disp_wt / 1000`),
      billedRs: r0(sql`s.inv_total`),
      collectedRs: r0(sql`s.coll_total`),
      outstandingRs: r0(OUTSTANDING_SQL),
      flags: { text: sql`coalesce(fc.n, 0)::text`, raw: sql`coalesce(fc.n, 0)`, kind: 'number', searchable: false },
      highFlags: { text: sql`coalesce(fc.high, 0)::text`, raw: sql`coalesce(fc.high, 0)`, kind: 'number', searchable: false },
    },
  };
}

/** Open orders only unless extra.closed = "1"; extra.flagged = "1" keeps orders with flags. */
function overviewExtra(query: TableQuery): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  if (String(query.extra?.closed ?? '') !== '1') out.push(sql`${STATUS_SQL} NOT IN ('Closed', 'Cancelled', 'Superseded')`);
  if (String(query.extra?.flagged ?? '') === '1') out.push(sql`coalesce(fc.n, 0) > 0`);
  return out;
}

export async function listOverview(query: TableQuery): Promise<TablePage<OverviewRow, OverviewMeta>> {
  const spec = await overviewSpec();
  const { rows, agg } = await fetchPage<OverviewRow, OverviewMeta & { total: number }>(
    spec,
    query,
    sql`count(*)::int AS total, coalesce(sum(m.ordered_kg), 0)::float / 1000 AS "orderedMt",
      coalesce(sum(s.disp_wt), 0)::float / 1000 AS "dispatchedMt", coalesce(sum(${OUTSTANDING_SQL}), 0)::float AS "outstandingRs"`,
    overviewExtra(query),
  );
  const page = plain(rows);
  const bn = page.length ? await orderBottlenecks(page.map((r) => r.id)).catch(() => new Map()) : new Map();
  const { total, ...meta } = agg;
  return {
    rows: page.map((r) => {
      const b = bn.get(r.id);
      return { ...r, bottleneck: b?.operation ?? null, bottleneckDays: b ? Math.round(b.days * 10) / 10 : null };
    }),
    total,
    meta,
  };
}

export async function listOverviewFacet(key: string, query: TableQuery) {
  return fetchFacet(await overviewSpec(), key, query, overviewExtra(query));
}

/** Headline numbers and the stage funnel for the Control Tower. */
export async function overviewStats(): Promise<OverviewStats> {
  const [byStatus, money, month, flags] = await Promise.all([
    prisma.$queryRaw<{ status: string; orders: number; mt: number }[]>(sql`SELECT ${STATUS_SQL} AS status, count(*)::int AS orders,
        coalesce(sum(coalesce(nullif(s.bom_wt, 0), s.quoted_mt * 1000) - coalesce(s.disp_wt, 0)), 0)::float / 1000 AS mt
      FROM orders o ${ORDER_STATS} GROUP BY 1`),
    prisma.$queryRaw<{ billed: number; collected: number; outstanding: number; overdue: number }[]>(sql`SELECT
        coalesce(sum(r.total_amount), 0)::float AS billed, coalesce(sum(ic.amt), 0)::float AS collected,
        coalesce(sum(${INVOICE_OUTSTANDING}), 0)::float AS outstanding,
        coalesce(sum(${INVOICE_OUTSTANDING}) FILTER (WHERE r.due_date < CURRENT_DATE), 0)::float AS overdue
      FROM invoices r LEFT JOIN LATERAL (SELECT coalesce(sum(c.amount), 0) AS amt, coalesce(sum(c.retention), 0) AS ret
        FROM collections c WHERE c.invoice_id = r.id) ic ON TRUE`),
    prisma.$queryRaw<{ mt: number }[]>(sql`SELECT coalesce(sum(wt_kg), 0)::float / 1000 AS mt FROM dispatches
      WHERE dispatch_date >= date_trunc('month', CURRENT_DATE) AND dispatch_date < date_trunc('month', CURRENT_DATE) + interval '1 month'`),
    listFlags(),
  ]);
  // Advance / on-account receipts are not on an invoice; add them to collected.
  const [onAccount] = await prisma.$queryRaw<{ amt: number }[]>(sql`SELECT coalesce(sum(amount), 0)::float AS amt FROM collections WHERE invoice_id IS NULL`);
  const map = new Map(byStatus.map((r) => [r.status, r]));
  const open = byStatus.filter((r) => !CLOSED_STATUSES.includes(r.status));
  return {
    openOrders: open.reduce((a, r) => a + r.orders, 0),
    pipelineMt: open.reduce((a, r) => a + Math.max(0, r.mt), 0),
    dispatchedThisMonthMt: month[0]?.mt ?? 0,
    billedRs: money[0]?.billed ?? 0,
    collectedRs: (money[0]?.collected ?? 0) + (onAccount?.amt ?? 0),
    outstandingRs: money[0]?.outstanding ?? 0,
    overdueRs: money[0]?.overdue ?? 0,
    flags: flags.length,
    highFlags: flags.filter((f) => f.severity === 'high').length,
    funnel: ORDER_STATUSES.map((st) => ({ status: st, orders: map.get(st)?.orders ?? 0, mt: Math.max(0, map.get(st)?.mt ?? 0) })),
  };
}

/** Pipeline, flags and bottleneck of one order (order page Summary tab). */
export async function orderSummary(orderId: number): Promise<OrderSummary> {
  const [rows, flags, bn] = await Promise.all([
    prisma.$queryRaw<Pipeline[]>(sql`SELECT coalesce(m.ordered_kg, 0)::float AS "orderedKg", coalesce(m.cut_kg, 0)::float AS "cutKg",
        coalesce(m.galv_kg, 0)::float AS "galvanisedKg", coalesce(m.insp_kg, 0)::float AS "inspectedKg",
        coalesce(s.disp_wt, 0)::float AS "dispatchedKg", o.contract_value::float AS "contractValue",
        coalesce(s.inv_total, 0)::float AS "billedRs", coalesce(s.coll_total, 0)::float AS "collectedRs",
        coalesce(s.ret_held, 0)::float AS "retentionRs", ${OUTSTANDING_SQL}::float AS "outstandingRs"
      FROM orders o ${ORDER_STATS} ${ORDER_METRICS} WHERE o.id = ${orderId}`),
    listFlags([orderId]),
    orderBottlenecks([orderId]).catch(() => new Map()),
  ]);
  const b = bn.get(orderId);
  return {
    pipeline: rows[0] ?? {
      orderedKg: 0, cutKg: 0, galvanisedKg: 0, inspectedKg: 0, dispatchedKg: 0, contractValue: null,
      billedRs: 0, collectedRs: 0, retentionRs: 0, outstandingRs: 0,
    },
    flags,
    bottleneck: b ? { operation: b.operation, days: b.days, totalDays: b.totalDays } : null,
  };
}

const AGEING_ORDER = ['Not due', '1-30 days', '31-60 days', '61-90 days', '>90 days'];

/** Outstanding invoices by days past due (retention excluded). Optional one order. */
export async function billingAgeing(orderId?: number): Promise<AgeingBucket[]> {
  const scope = orderId ? sql`AND r.order_id = ${orderId}` : sql``;
  const rows = await prisma.$queryRaw<AgeingBucket[]>(sql`SELECT ${AGEING_SQL} AS bucket, count(*)::int AS invoices,
      coalesce(sum(${INVOICE_OUTSTANDING}), 0)::float AS amount
    FROM invoices r LEFT JOIN LATERAL (SELECT coalesce(sum(c.amount), 0) AS amt, coalesce(sum(c.retention), 0) AS ret
      FROM collections c WHERE c.invoice_id = r.id) ic ON TRUE
    WHERE ${INVOICE_OUTSTANDING} > 0 ${scope} GROUP BY 1`);
  const map = new Map(rows.map((r) => [r.bucket, r]));
  return AGEING_ORDER.map((b) => map.get(b) ?? { bucket: b, invoices: 0, amount: 0 });
}
