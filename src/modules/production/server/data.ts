import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { defaultRouting, isCutOp, type Operation, type PlanMachine, type PlanMark, type Routing } from '@/lib/planning/machines';

// Shared loaders of the production module. Marks are compared upper-cased and trimmed everywhere
// (piece_routings.mark_no and production_entries.mark_no are stored that way).

const sql = Prisma.sql;

export const normMark = (v: unknown) => String(v ?? '').trim().toUpperCase();

export interface BomMark {
  markNo: string;
  section: string | null;
  description: string | null;
  qty: number;
  unitWtKg: number | null;
}

export interface OrderBom {
  uploadId: number;
  status: string;
  marks: BomMark[];
}

/** Current BOM (latest upload) of each order, pieces grouped by mark. Orders without a BOM are absent. */
export async function loadBoms(orderIds: number[]): Promise<Map<number, OrderBom>> {
  const out = new Map<number, OrderBom>();
  if (orderIds.length === 0) return out;
  const uploads = await prisma.$queryRaw<{ id: number; orderId: number; status: string }[]>(sql`
    SELECT DISTINCT ON (order_id) id, order_id AS "orderId", status FROM bom_uploads
    WHERE order_id IN (${Prisma.join(orderIds)}) ORDER BY order_id, id DESC`);
  if (uploads.length === 0) return out;
  const rows = await prisma.$queryRaw<(BomMark & { uploadId: number })[]>(sql`
    SELECT upload_id AS "uploadId", upper(btrim(mark_no)) AS "markNo",
      min(section) AS section, min(description) AS description,
      coalesce(sum(total_qty), 0)::float AS qty, max(unit_wt_kg)::float AS "unitWtKg"
    FROM bom_pieces WHERE upload_id IN (${Prisma.join(uploads.map((u) => u.id))}) AND btrim(coalesce(mark_no, '')) <> ''
    GROUP BY upload_id, upper(btrim(mark_no)) ORDER BY 2`);
  for (const u of uploads) out.set(u.orderId, { uploadId: u.id, status: u.status, marks: [] });
  const byUpload = new Map(uploads.map((u) => [u.id, u.orderId]));
  for (const r of rows) {
    const { uploadId, ...mark } = r;
    out.get(byUpload.get(uploadId)!)!.marks.push(mark);
  }
  return out;
}

/** Saved routing overrides per order -> mark. */
export async function loadSavedRoutings(orderIds: number[]): Promise<Map<number, Map<string, Routing>>> {
  const out = new Map<number, Map<string, Routing>>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.pieceRouting.findMany({ where: { orderId: { in: orderIds } } });
  for (const r of rows) {
    if (!out.has(r.orderId)) out.set(r.orderId, new Map());
    out.get(r.orderId)!.set(normMark(r.markNo), {
      cutOp: isCutOp(r.cutOp) ? r.cutOp : 'SHEARING',
      holes: r.holes,
      notches: r.notches,
      bends: r.bends,
      welds: r.welds,
      threads: r.threads,
      numbering: r.numbering,
    });
  }
  return out;
}

/** Pieces produced per order -> mark -> operation. */
export async function loadProduced(orderIds: number[]): Promise<Map<number, Map<string, Partial<Record<Operation, number>>>>> {
  const out = new Map<number, Map<string, Partial<Record<Operation, number>>>>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ orderId: number; markNo: string; operation: Operation; pieces: number }[]>(sql`
    SELECT order_id AS "orderId", upper(btrim(mark_no)) AS "markNo", operation, sum(pieces)::int AS pieces
    FROM production_entries WHERE order_id IN (${Prisma.join(orderIds)}) GROUP BY 1, 2, 3`);
  for (const r of rows) {
    if (!out.has(r.orderId)) out.set(r.orderId, new Map());
    const m = out.get(r.orderId)!;
    m.set(r.markNo, { ...(m.get(r.markNo) ?? {}), [r.operation]: r.pieces });
  }
  return out;
}

export async function loadPlanMachines(): Promise<PlanMachine[]> {
  const rows = await prisma.machine.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  return rows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    operation: m.operation,
    units: m.units,
    ratePerHour: m.ratePerHour.toNumber(),
    shiftsPerDay: m.shiftsPerDay,
    hoursPerShift: m.hoursPerShift.toNumber(),
    utilisationPct: m.utilisationPct.toNumber(),
    active: m.active,
    rateConfirmed: m.rateConfirmed,
  }));
}

/** Effective routing of a mark: saved override, else the section default. */
export function effectiveRouting(mark: BomMark, saved: Map<string, Routing> | undefined): { routing: Routing; saved: boolean } {
  const s = saved?.get(mark.markNo);
  return s ? { routing: s, saved: true } : { routing: defaultRouting(mark.section), saved: false };
}

/** Plan input for one order. `qtyFor` lets the caller cap quantities (cuttable basis). */
export function planMarks(
  bom: OrderBom,
  saved: Map<string, Routing> | undefined,
  produced?: Map<string, Partial<Record<Operation, number>>>,
  qtyFor?: (mark: BomMark) => number,
): PlanMark[] {
  return bom.marks.map((m) => ({
    markNo: m.markNo,
    qty: Math.max(0, Math.floor(qtyFor ? qtyFor(m) : m.qty)),
    routing: effectiveRouting(m, saved).routing,
    produced: produced?.get(m.markNo),
  }));
}
