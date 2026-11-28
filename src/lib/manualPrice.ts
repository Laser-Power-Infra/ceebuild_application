import 'server-only';
import { prisma } from '@/lib/prisma';

export interface ManualPrice {
  /** Admin who approved the typed price, or null while it waits for approval. */
  approvedBy: string | null;
}

/**
 * C6 (Puja 28-11): a price typed on the item (not from an applied BOM costing) is "manual – not
 * system costed" and needs an Admin's approval. Older rows without a source count as manual when no
 * applied costing exists.
 */
export async function manualPrices(items: { id: number; price: string | null; priceSource?: string | null; priceApprovedBy?: string | null }[]) {
  const priced = items.filter((i) => String(i.price ?? '').trim() !== '');
  if (!priced.length) return {} as Record<number, ManualPrice>;
  const applied = new Set(
    (await prisma.itemCosting.findMany({ where: { itemId: { in: priced.map((i) => i.id) }, applied: true }, select: { itemId: true } })).map((c) => c.itemId),
  );
  const out: Record<number, ManualPrice> = {};
  for (const i of priced) {
    const manual = i.priceSource === 'MANUAL' || (i.priceSource !== 'COSTING' && !applied.has(i.id));
    if (manual) out[i.id] = { approvedBy: i.priceApprovedBy ?? null };
  }
  return out;
}
