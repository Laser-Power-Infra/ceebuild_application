import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchFacet, fetchPage, num, plain, type TableSpec } from '@/lib/serverTable';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import type { OrderRow, OrdersMeta } from '../columns';

const sql = Prisma.sql;

const MT_UOMS = sql`('MT','MTS','TON','TONS','TONNE','TONNES')`;
const KG_UOMS = sql`('KG','KGS')`;

/**
 * Per-order figures, one lateral row per order. The order's BOM is its latest upload.
 * Status is derived from what exists, so it can never go stale.
 */
export const ORDER_STATS = sql`LEFT JOIN LATERAL (
  SELECT
    (SELECT u.status FROM bom_uploads u WHERE u.order_id = o.id ORDER BY u.id DESC LIMIT 1) AS bom_status,
    (SELECT sum(p.total_wt_kg) FROM bom_pieces p
       WHERE p.upload_id = (SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = o.id)) AS bom_wt,
    (SELECT sum(CASE WHEN upper(btrim(l.uom)) IN ${MT_UOMS} THEN ${num(sql`l.qty`)}
                     WHEN upper(btrim(l.uom)) IN ${KG_UOMS} THEN ${num(sql`l.qty`)} / 1000 END)
       FROM order_lines l WHERE l.order_id = o.id) AS quoted_mt,
    EXISTS (SELECT 1 FROM rm_indents ri WHERE ri.order_id = o.id AND ri.status = 'ISSUED') AS indent_issued,
    EXISTS (SELECT 1 FROM rm_receipts rr JOIN rm_receipt_lots rl ON rl.receipt_id = rr.id WHERE rr.order_id = o.id) AS rm_received,
    EXISTS (SELECT 1 FROM production_entries pe WHERE pe.order_id = o.id) AS in_production,
    EXISTS (SELECT 1 FROM stage_inspections si WHERE si.order_id = o.id) AS stage_inspected,
    EXISTS (SELECT 1 FROM galv_challans g WHERE g.order_id = o.id AND g.direction = 'OUT') AS galv_out,
    EXISTS (SELECT 1 FROM galv_challans g WHERE g.order_id = o.id AND g.direction = 'IN') AS galv_in,
    EXISTS (SELECT 1 FROM inspections i WHERE i.order_id = o.id) AS inspected,
    EXISTS (SELECT 1 FROM dispatch_instructions x WHERE x.order_id = o.id) AS di_issued,
    (SELECT sum(d.wt_kg) FROM dispatches d WHERE d.order_id = o.id) AS disp_wt,
    (SELECT count(*) FROM dispatches d WHERE d.order_id = o.id) AS disp_count,
    (SELECT count(*) FROM dispatches d WHERE d.order_id = o.id
       AND NOT EXISTS (SELECT 1 FROM invoices iv WHERE iv.dispatch_id = d.id)) AS disp_unbilled,
    (SELECT count(*) FROM invoices iv WHERE iv.order_id = o.id) AS inv_count,
    (SELECT sum(iv.wt_kg) FROM invoices iv WHERE iv.order_id = o.id) AS inv_wt,
    (SELECT sum(iv.total_amount) FROM invoices iv WHERE iv.order_id = o.id) AS inv_total,
    (SELECT sum(c.amount) FROM collections c WHERE c.order_id = o.id) AS coll_total,
    (SELECT sum(c.retention) FROM collections c WHERE c.order_id = o.id) AS ret_held
) s ON TRUE`;

/** Every BOM kg dispatched. */
const FULLY_DISPATCHED = sql`(s.disp_count > 0 AND coalesce(s.bom_wt, 0) > 0 AND s.disp_wt >= s.bom_wt)`;
/** Fully dispatched and every dispatch billed (by invoice weight, or every dispatch linked to an invoice). */
const FULLY_BILLED = sql`(${FULLY_DISPATCHED} AND s.inv_count > 0 AND (coalesce(s.inv_wt, 0) >= s.disp_wt OR s.disp_unbilled = 0))`;

/** Furthest step reached, derived from the data (never typed). See ORDER_STATUSES. */
export const STATUS_SQL = sql`(CASE
  WHEN ${FULLY_BILLED} AND coalesce(s.coll_total, 0) >= s.inv_total THEN 'Closed'
  WHEN ${FULLY_BILLED} THEN 'Billed'
  WHEN ${FULLY_DISPATCHED} THEN 'Dispatched'
  WHEN s.disp_count > 0 THEN 'Part dispatched'
  WHEN s.di_issued THEN 'DI issued'
  WHEN s.inspected THEN 'Inspected'
  WHEN s.galv_in THEN 'Galvanised'
  WHEN s.galv_out THEN 'At galvanising'
  WHEN s.stage_inspected THEN 'Stage inspected'
  WHEN s.in_production THEN 'In production'
  WHEN s.rm_received THEN 'RM received'
  WHEN s.indent_issued THEN 'RM indented'
  WHEN s.bom_status = 'CORRECT' THEN 'BOM correct'
  WHEN s.bom_status IS NOT NULL THEN 'BOM uploaded'
  ELSE 'PO received' END)`;

const mt = (e: Prisma.Sql) => ({ text: sql`round((${e})::numeric, 3)::text`, raw: sql`round((${e})::numeric, 3)::float` });
const rs = (e: Prisma.Sql) => ({ text: sql`round((${e})::numeric, 0)::text`, raw: sql`round((${e})::numeric, 2)::float` });
/** Invoiced minus collected minus retention held (retention is a separate receivable). */
export const OUTSTANDING_SQL = sql`(coalesce(s.inv_total, 0) - coalesce(s.coll_total, 0) - coalesce(s.ret_held, 0))`;

const SPEC: TableSpec = {
  from: sql`orders o JOIN "docket-party-name" d ON d.id = o.docket_id ${ORDER_STATS}`,
  fallbackOrder: sql`o.po_date DESC, o.id DESC`,
  fields: {
    id: { text: sql`o.id::text`, raw: sql`o.id`, kind: 'number', searchable: false },
    poNumber: { text: sql`o.po_number`, kind: 'text' },
    poDate: { text: sql`to_char(o.po_date, 'YYYY-MM-DD')`, raw: sql`o.po_date`, kind: 'date', searchable: false },
    docketNo: { text: sql`coalesce(d.docket_no_qtn_no, o.docket_no)`, kind: 'text' },
    client: { text: sql`coalesce(nullif(o.client, ''), d.party_name)`, kind: 'text' },
    utility: { text: sql`d.utility`, kind: 'text' },
    quotedMt: { ...mt(sql`s.quoted_mt`), kind: 'number', searchable: false },
    bomMt: { ...mt(sql`s.bom_wt / 1000`), kind: 'number', searchable: false },
    dispatchedMt: { ...mt(sql`s.disp_wt / 1000`), kind: 'number', searchable: false },
    deliveryDue: { text: sql`to_char(o.delivery_due, 'YYYY-MM-DD')`, raw: sql`o.delivery_due`, kind: 'date', searchable: false },
    billedRs: { ...rs(sql`s.inv_total`), kind: 'number', searchable: false },
    collectedRs: { ...rs(sql`s.coll_total`), kind: 'number', searchable: false },
    outstandingRs: { ...rs(OUTSTANDING_SQL), kind: 'number', searchable: false },
    status: { text: STATUS_SQL, kind: 'text' },
  },
};

const AGG = sql`count(*)::int AS total,
  coalesce(sum(s.quoted_mt), 0)::float AS "quotedMt",
  coalesce(sum(s.bom_wt), 0)::float / 1000 AS "bomMt",
  coalesce(sum(s.disp_wt), 0)::float / 1000 AS "dispatchedMt",
  coalesce(sum(s.inv_total), 0)::float AS "billedRs",
  coalesce(sum(s.coll_total), 0)::float AS "collectedRs",
  coalesce(sum(${OUTSTANDING_SQL}), 0)::float AS "outstandingRs"`;

export async function listOrders(query: TableQuery): Promise<TablePage<OrderRow, OrdersMeta>> {
  const { rows, agg } = await fetchPage<OrderRow, OrdersMeta & { total: number }>(SPEC, query, AGG);
  const { total, ...meta } = agg;
  return { rows: plain(rows), total, meta };
}

export const listOrdersFacet = (key: string, query: TableQuery) => fetchFacet(SPEC, key, query);

export interface OrderDetail {
  id: number;
  docketId: number;
  docketNo: string | null;
  poNumber: string;
  poDate: string;
  client: string | null;
  utility: string | null;
  remarks: string | null;
  status: string;
  quotedMt: number | null;
  bomMt: number | null;
  dispatchedMt: number | null;
  bomStatus: string | null;
  contractValue: number | null;
  deliveryDue: string | null;
  createdByName: string | null;
  createdAt: string;
  lines: { id: number; itemName: string | null; ourItemName: string | null; uom: string | null; qty: string | null; price: string | null; weightPerPiece: string | null }[];
}

export async function getOrder(id: number): Promise<OrderDetail | null> {
  const rows = await prisma.$queryRaw<Omit<OrderDetail, 'lines'>[]>(sql`SELECT o.id, o.docket_id AS "docketId",
      coalesce(d.docket_no_qtn_no, o.docket_no) AS "docketNo", o.po_number AS "poNumber",
      to_char(o.po_date, 'YYYY-MM-DD') AS "poDate", coalesce(nullif(o.client, ''), d.party_name) AS client,
      d.utility, o.remarks, ${STATUS_SQL} AS status,
      round(s.quoted_mt::numeric, 3)::float AS "quotedMt", round((s.bom_wt / 1000)::numeric, 3)::float AS "bomMt",
      round((s.disp_wt / 1000)::numeric, 3)::float AS "dispatchedMt", s.bom_status AS "bomStatus",
      o.contract_value::float AS "contractValue", to_char(o.delivery_due, 'YYYY-MM-DD') AS "deliveryDue",
      o.created_by_name AS "createdByName", o.created_at AS "createdAt"
    FROM orders o JOIN "docket-party-name" d ON d.id = o.docket_id ${ORDER_STATS}
    WHERE o.id = ${id}`);
  if (!rows[0]) return null;
  const lines = await prisma.orderLine.findMany({
    where: { orderId: id },
    orderBy: { id: 'asc' },
    select: { id: true, itemName: true, ourItemName: true, uom: true, qty: true, price: true, weightPerPiece: true },
  });
  return { ...plain(rows)[0], lines };
}

/** Dockets for the "New order" picker: number or party contains `q`. */
export async function searchDockets(q: string) {
  const term = q.trim();
  const rows = await prisma.dockerPartyName.findMany({
    where: term
      ? {
          OR: [
            { docketNoQtnNo: { contains: term, mode: 'insensitive' } },
            { partyName: { contains: term, mode: 'insensitive' } },
            { utility: { contains: term, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { id: 'desc' },
    take: 20,
    select: { id: true, docketNoQtnNo: true, partyName: true, utility: true, _count: { select: { orders: true } } },
  });
  return rows.map((r) => ({ id: r.id, docketNo: r.docketNoQtnNo, party: r.partyName, utility: r.utility, orders: r._count.orders }));
}
