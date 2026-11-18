import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchFacet, fetchPage, plain, type FieldSql, type TableSpec } from '@/lib/serverTable';
import type { TablePage, TableQuery } from '@/components/data-table/types';
import { REGISTER_KEYS, type RegisterKey, type RegisterRow } from '../columns';

const sql = Prisma.sql;

const txt = (e: Prisma.Sql): FieldSql => ({ text: e, kind: 'text' });
const date = (col: string): FieldSql => ({ text: sql`to_char(${Prisma.raw(col)}, 'YYYY-MM-DD')`, raw: Prisma.raw(col), kind: 'date', searchable: false });
const numf = (e: Prisma.Sql): FieldSql => ({ text: sql`round((${e})::numeric, 3)::text`, raw: sql`round((${e})::numeric, 3)::float`, kind: 'number', searchable: false });

const ORDER_JOIN = sql`JOIN orders o ON o.id = r.order_id JOIN "docket-party-name" d ON d.id = o.docket_id`;
const ORDER_FIELDS: Record<string, FieldSql> = {
  orderId: { text: sql`r.order_id::text`, raw: sql`r.order_id`, kind: 'number', searchable: false },
  poNumber: txt(sql`o.po_number`),
  client: txt(sql`coalesce(nullif(o.client, ''), d.party_name)`),
};

const GALV_LINES = sql`LEFT JOIN LATERAL (SELECT sum(l.pieces)::int AS pieces,
    string_agg(l.mark_no || ': ' || l.pieces, ', ' ORDER BY l.mark_no) AS marks
  FROM galv_challan_lines l WHERE l.challan_id = r.id) gl ON TRUE`;

interface RegisterDef {
  from: Prisma.Sql;
  fields: Record<string, FieldSql>;
  order: Prisma.Sql;
  agg: Prisma.Sql;
}

const DEFS: Record<RegisterKey, RegisterDef> = {
  galv: {
    from: sql`galv_challans r ${ORDER_JOIN} ${GALV_LINES}`,
    order: sql`r.challan_date DESC, r.id DESC`,
    fields: {
      challanNo: txt(sql`r.challan_no`),
      direction: txt(sql`r.direction`),
      challanDate: date('r.challan_date'),
      jobWorker: txt(sql`r.job_worker`),
      pieces: numf(sql`gl.pieces`),
      blackWtKg: numf(sql`r.black_wt_kg`),
      galvWtKg: numf(sql`r.galv_wt_kg`),
      zincPct: numf(sql`(CASE WHEN r.black_wt_kg > 0 AND r.galv_wt_kg IS NOT NULL THEN (r.galv_wt_kg - r.black_wt_kg) / r.black_wt_kg * 100 END)`),
      marks: txt(sql`gl.marks`),
      remarks: txt(sql`r.remarks`),
    },
    agg: sql`count(*)::int AS total,
      coalesce(sum(gl.pieces) FILTER (WHERE r.direction = 'OUT'), 0)::float AS "outPieces",
      coalesce(sum(gl.pieces) FILTER (WHERE r.direction = 'IN'), 0)::float AS "inPieces",
      (coalesce(sum(gl.pieces) FILTER (WHERE r.direction = 'OUT'), 0) - coalesce(sum(gl.pieces) FILTER (WHERE r.direction = 'IN'), 0))::float AS "pendingPieces",
      coalesce(sum(r.black_wt_kg) FILTER (WHERE r.direction = 'OUT'), 0)::float AS "blackWtKg",
      coalesce(sum(r.galv_wt_kg) FILTER (WHERE r.direction = 'IN'), 0)::float AS "galvWtKg"`,
  },
  inspection: {
    from: sql`inspections r ${ORDER_JOIN}`,
    order: sql`r.inspection_date DESC, r.id DESC`,
    fields: {
      inspectionNo: txt(sql`r.inspection_no`),
      mcNo: txt(sql`r.mc_no`),
      inspectionDate: date('r.inspection_date'),
      piecesCleared: numf(sql`r.pieces_cleared`),
      wtClearedKg: numf(sql`r.wt_cleared_kg`),
      remarks: txt(sql`r.remarks`),
    },
    agg: sql`count(*)::int AS total, coalesce(sum(r.pieces_cleared), 0)::float AS "piecesCleared",
      coalesce(sum(r.wt_cleared_kg), 0)::float AS "wtClearedKg"`,
  },
  di: {
    from: sql`dispatch_instructions r ${ORDER_JOIN}
      LEFT JOIN LATERAL (SELECT sum(x.wt_kg) AS wt FROM dispatches x WHERE x.di_id = r.id) dx ON TRUE`,
    order: sql`r.di_date DESC, r.id DESC`,
    fields: {
      diNo: txt(sql`r.di_no`),
      diDate: date('r.di_date'),
      pieces: numf(sql`r.pieces`),
      wtKg: numf(sql`r.wt_kg`),
      dispatchedKg: numf(sql`dx.wt`),
      remarks: txt(sql`r.remarks`),
    },
    agg: sql`count(*)::int AS total, coalesce(sum(r.wt_kg), 0)::float AS "wtKg", coalesce(sum(dx.wt), 0)::float AS "dispatchedKg"`,
  },
  dispatch: {
    from: sql`dispatches r ${ORDER_JOIN} LEFT JOIN dispatch_instructions di ON di.id = r.di_id`,
    order: sql`r.dispatch_date DESC, r.id DESC`,
    fields: {
      dispatchDate: date('r.dispatch_date'),
      diNo: txt(sql`di.di_no`),
      invoiceNo: txt(sql`r.invoice_no`),
      lrNo: txt(sql`r.lr_no`),
      vehicleNo: txt(sql`r.vehicle_no`),
      pieces: numf(sql`r.pieces`),
      wtKg: numf(sql`r.wt_kg`),
      remarks: txt(sql`r.remarks`),
    },
    agg: sql`count(*)::int AS total, coalesce(sum(r.pieces), 0)::float AS pieces, coalesce(sum(r.wt_kg), 0)::float AS "wtKg"`,
  },
};

export function isRegisterKey(k: unknown): k is RegisterKey {
  // Own keys only: `k in DEFS` would also accept inherited names like 'constructor'.
  return typeof k === 'string' && (REGISTER_KEYS as readonly string[]).includes(k);
}

/** Spec of one register; scoped to one order when `orderId` is given (order page), else all orders (/execution). */
function spec(key: RegisterKey, orderId: number | null): TableSpec {
  const d = DEFS[key];
  return {
    from: d.from,
    fallbackOrder: d.order,
    scope: orderId ? sql`r.order_id = ${orderId}` : undefined,
    fields: { id: { text: sql`r.id::text`, raw: sql`r.id`, kind: 'number', searchable: false }, ...ORDER_FIELDS, ...d.fields },
  };
}

export async function listRegister(key: RegisterKey, orderId: number | null, query: TableQuery): Promise<TablePage<RegisterRow, Record<string, number>>> {
  const { rows, agg } = await fetchPage<RegisterRow, { total: number } & Record<string, number>>(spec(key, orderId), query, DEFS[key].agg);
  const { total, ...meta } = agg;
  return { rows: plain(rows), total, meta };
}

export const listRegisterFacet = (key: RegisterKey, orderId: number | null, field: string, query: TableQuery) =>
  fetchFacet(spec(key, orderId), field, query);

/** Pick-lists for the entry forms: the order's BOM marks and its DIs. */
export async function registerOptions(orderId: number) {
  const latest = await prisma.bomUpload.findFirst({ where: { orderId }, orderBy: { id: 'desc' }, select: { id: true } });
  const [marks, dis] = await Promise.all([
    latest
      ? prisma.$queryRaw<{ mark: string; qty: number }[]>(sql`SELECT mark_no AS mark, coalesce(sum(total_qty), 0)::float AS qty
          FROM bom_pieces WHERE upload_id = ${latest.id} AND coalesce(mark_no, '') <> '' GROUP BY mark_no ORDER BY mark_no LIMIT 2000`)
      : Promise.resolve([]),
    prisma.dispatchInstruction.findMany({ where: { orderId }, orderBy: { diDate: 'desc' }, select: { id: true, diNo: true } }),
  ]);
  return { marks, dis };
}
