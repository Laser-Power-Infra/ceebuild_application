import 'server-only';
import { prisma } from '@/lib/prisma';
import type { ReplanResult } from '@/lib/planning/cutting';

/**
 * Pieces per mark (upper-cased mark no -> pieces) that the order's latest cutting plan (re-plan on
 * RM actually received) can cut. null when the order has no cutting plan yet.
 */
export async function cuttableByMark(orderId: number): Promise<Map<string, number> | null> {
  const plan = await prisma.cuttingPlan.findFirst({ where: { orderId }, orderBy: { id: 'desc' }, select: { result: true } });
  if (!plan) return null;
  const result = plan.result as unknown as ReplanResult;
  const out = new Map<string, number>();
  for (const m of result.marks ?? []) {
    const key = m.markNo.toUpperCase();
    out.set(key, (out.get(key) ?? 0) + m.planned);
  }
  return out;
}
