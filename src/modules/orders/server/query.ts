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
    EXISTS (SELECT 1 FROM galv_challans g WHERE g.order_id = o.id AND g.direction = 'OUT') AS galv_out,
    EXISTS (SELECT 1 FROM galv_challans g WHERE g.order_id = o.id AND g.direction = 'IN') AS galv_in,
    EXISTS (SELECT 1 FROM inspections i WHERE i.order_id = o.id) AS inspected,
    EXISTS (SELECT 1 FROM dispatch_instructions x WHERE x.order_id = o.id) AS di_issued,
    (SELECT sum(d.wt_kg) FROM dispatches d WHERE d.order_id = o.id) AS disp_wt,
    (SELECT count(*) FROM dispatches d WHERE d.order_id = o.id) AS disp_count
) s ON TRUE`;

export const STATUS_SQL = sql`(CASE
  WHEN s.disp_count > 0 AND coalesce(s.bom_wt, 0) > 0 AND s.disp_wt >= s.bom_wt THEN 'Dispatched'
  WHEN s.disp_count > 0 THEN 'Part dispatched'
  WHEN s.di_issued THEN 'DI issued'
  WHEN s.inspected THEN 'Inspected'
  WHEN s.galv_in THEN 'Galvanised'
  WHEN s.galv_out THEN 'At galvanising'
  WHEN s.bom_status = 'CORRECT' THEN 'BOM correct'
  WHEN s.bom_status IS NOT NULL THEN 'BOM uploaded'
  ELSE 'PO received' END)`;

const mt = (e: Prisma.Sql) => ({ text: sql`round((${e})::numeric, 3)::text`, raw: sql`round((${e})::numeric, 3)::float` });

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
    status: { text: STATUS_SQL, kind: 'text' },
  },
};

const AGG = sql`count(*)::int AS total,
  coalesce(sum(s.quoted_mt), 0)::float AS "quotedMt",
  coalesce(sum(s.bom_wt), 0)::float / 1000 AS "bomMt",
  coalesce(sum(s.disp_wt), 0)::float / 1000 AS "dispatchedMt"`;

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
