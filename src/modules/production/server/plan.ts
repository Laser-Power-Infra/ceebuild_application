import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeMachinePlan, type PlanMark } from '@/lib/planning/machines';
import { getPlanSettings } from '@/modules/settings/server';
import { cuttableByMark } from '@/modules/rm/server/cuttable';
import type { OrderMachinePlan, PlanBasis, ShopPlan, ShopPlanOrder } from '../columns';
import { loadBoms, loadPlanMachines, loadProduced, loadSavedRoutings, planMarks } from './data';

const sql = Prisma.sql;

/** Machine load, days and bottleneck for one order on the chosen basis. */
export async function orderMachinePlan(orderId: number, basis: PlanBasis): Promise<OrderMachinePlan> {
  const [boms, saved, machines, settings] = await Promise.all([
    loadBoms([orderId]),
    loadSavedRoutings([orderId]),
    loadPlanMachines(),
    getPlanSettings(),
  ]);
  const bom = boms.get(orderId);
  const base = { basis, workDaysPerWeek: settings.workDaysPerWeek };
  if (!bom || bom.marks.length === 0) {
    return { ...base, hasBom: false, bomStatus: bom?.status ?? null, note: 'Upload the BOM first: the plan is built from its marks.', plan: computeMachinePlan([], machines) };
  }
  let note: string | null = bom.status === 'CORRECT' ? null : 'BOM is not marked correct yet; the plan may change.';
  let marks: PlanMark[];
  if (basis === 'CUTTABLE') {
    const cuttable = await cuttableByMark(orderId);
    if (!cuttable) {
      return {
        ...base,
        hasBom: true,
        bomStatus: bom.status,
        note: 'No cutting plan yet: record the RM received and run the re-plan (RM Receipt & Re-plan tab) to plan on cuttable pieces.',
        plan: computeMachinePlan([], machines, settings.workDaysPerWeek),
      };
    }
    marks = planMarks(bom, saved.get(orderId), undefined, (m) => Math.min(m.qty, cuttable.get(m.markNo) ?? 0));
  } else if (basis === 'REMAINING') {
    const produced = await loadProduced([orderId]);
    marks = planMarks(bom, saved.get(orderId), produced.get(orderId));
  } else {
    marks = planMarks(bom, saved.get(orderId));
  }
  const plan = computeMachinePlan(marks, machines, settings.workDaysPerWeek);
  if (plan.operations.length === 0 && !note) note = basis === 'REMAINING' ? 'Nothing left to produce.' : 'No operations: every mark has an empty routing.';
  return { ...base, hasBom: true, bomStatus: bom.status, note, plan };
}

/** Orders with a BOM that are not fully dispatched (dispatched weight below BOM weight). */
export async function openOrderIds(): Promise<{ id: number; poNumber: string; client: string | null }[]> {
  return prisma.$queryRaw(sql`
    SELECT o.id, o.po_number AS "poNumber", coalesce(nullif(o.client, ''), d.party_name) AS client
    FROM orders o JOIN "docket-party-name" d ON d.id = o.docket_id
    LEFT JOIN LATERAL (SELECT sum(p.total_wt_kg) AS wt FROM bom_pieces p
      WHERE p.upload_id = (SELECT max(u.id) FROM bom_uploads u WHERE u.order_id = o.id)) b ON TRUE
    LEFT JOIN LATERAL (SELECT sum(x.wt_kg) AS wt FROM dispatches x WHERE x.order_id = o.id) x ON TRUE
    WHERE coalesce(b.wt, 0) > 0 AND coalesce(x.wt, 0) < b.wt
    ORDER BY o.po_date ASC, o.id ASC`);
}

/** Remaining-work plan per order (same machines for each, as if the order had the shop to itself). */
async function remainingPlans(orderIds: number[]) {
  const [boms, saved, produced, machines, settings] = await Promise.all([
    loadBoms(orderIds),
    loadSavedRoutings(orderIds),
    loadProduced(orderIds),
    loadPlanMachines(),
    getPlanSettings(),
  ]);
  const perOrder = new Map<number, PlanMark[]>();
  for (const id of orderIds) {
    const bom = boms.get(id);
    if (bom && bom.marks.length) perOrder.set(id, planMarks(bom, saved.get(id), produced.get(id)));
  }
  return { perOrder, machines, workDaysPerWeek: settings.workDaysPerWeek };
}

/** Shop load across all open orders (remaining work) plus each order's own bottleneck. */
export async function shopMachinePlan(): Promise<ShopPlan> {
  const open = await openOrderIds();
  const { perOrder, machines, workDaysPerWeek } = await remainingPlans(open.map((o) => o.id));
  const orders: ShopPlanOrder[] = [];
  const all: PlanMark[] = [];
  for (const o of open) {
    const marks = perOrder.get(o.id);
    if (!marks) continue;
    const p = computeMachinePlan(marks, machines, workDaysPerWeek);
    const remaining = p.operations.reduce((max, op) => Math.max(max, op.pieces), 0);
    orders.push({ orderId: o.id, poNumber: o.poNumber, client: o.client, remainingPieces: remaining, bottleneck: p.bottleneck?.operation ?? null, days: p.totalDays });
    // Prefix marks with the PO so the shop-level per-mark breakdown stays unambiguous.
    all.push(...marks.map((m) => ({ ...m, markNo: `${o.poNumber} / ${m.markNo}` })));
  }
  return { workDaysPerWeek, plan: computeMachinePlan(all, machines, workDaysPerWeek), orders };
}

export { remainingPlans };
