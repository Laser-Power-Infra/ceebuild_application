import 'server-only';
import { computeMachinePlan } from '@/lib/planning/machines';
import { remainingPlans } from './plan';

export interface OrderBottleneck {
  /** Operation with the most days of load, e.g. "PUNCHING". */
  operation: string;
  /** Working days that operation needs for the order's remaining (not yet produced) work. */
  days: number;
  /** Working days for the whole order = the bottleneck's days (operations run in parallel). */
  totalDays: number;
}

/**
 * Bottleneck per order for the given orders (basis: remaining work). Missing = no BOM, nothing left
 * to produce, or an operation with no active machine (days cannot be computed).
 */
export async function orderBottlenecks(orderIds: number[]): Promise<Map<number, OrderBottleneck>> {
  const out = new Map<number, OrderBottleneck>();
  const ids = [...new Set(orderIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return out;
  const { perOrder, machines, workDaysPerWeek } = await remainingPlans(ids);
  for (const [id, marks] of perOrder) {
    const p = computeMachinePlan(marks, machines, workDaysPerWeek);
    if (!p.bottleneck || p.bottleneck.days === null || p.totalDays === null) continue;
    out.set(id, { operation: p.bottleneck.operation, days: p.bottleneck.days, totalDays: p.totalDays });
  }
  return out;
}
