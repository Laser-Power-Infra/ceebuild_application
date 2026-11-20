import { prisma } from '@/lib/prisma';
import { normalizeDocketNo } from '@/lib/dockets';
import { createdAtRange } from '@/lib/dateRange';

/**
 * One place that turns the Dockets screen's URL filters into Prisma `where` clauses.
 * Used by GET /api/dockets (rows, totals) and GET /api/dockets/facets (dropdown options),
 * so a dropdown can never offer a value the table would not return.
 */

/** Filter value standing for an empty cell (same token as components/ui/multi-select-filter). */
export const BLANK = '__blank__';

/** Multi-select filters on the docket itself: URL param -> column. */
export const DOCKET_LIST_FILTERS = {
  docketNoQtnNo: 'docketNoQtnNo',
  partyName: 'partyName',
  state: 'state',
  utility: 'utility',
  type: 'type',
  price: 'price',
  payment: 'payment',
  delivery: 'delivery',
  warranty: 'warranty',
  approval: 'approval',
  inspection: 'inspection',
} as const;

/** Multi-select filters on a docket's items: URL param -> item column. */
export const ITEM_LIST_FILTERS = {
  item: 'ourItemName',
  uom: 'uom',
  ourItemNot: 'ourItemNot',
  size: 'size',
} as const;

/** Exact (trimmed, case-insensitive) docket-number match for any of `nos`. */
export const docketNoIn = (nos: string[]) => ({
  OR: nos.map((dn) => ({ docketNoQtnNo: { equals: normalizeDocketNo(dn), mode: 'insensitive' as const } })),
});

// Values arrive as repeated params and are never split on commas: condition texts contain commas.
const values = (sp: URLSearchParams, key: string) => Array.from(new Set(sp.getAll(key).filter(Boolean)));

/** "Any of these values" (case-insensitive, exact); BLANK also matches null and empty text. */
function listFilter(field: string, picked: string[]) {
  const or: any[] = picked
    .filter((v) => v !== BLANK)
    .map((v) => ({ [field]: { equals: v, mode: 'insensitive' as const } }));
  if (picked.includes(BLANK)) or.push({ [field]: null }, { [field]: '' });
  return or.length === 1 ? or[0] : { OR: or };
}

/** Item-level filters, or null when none is set. `omit` leaves one filter out (for its own dropdown). */
export function buildItemWhere(sp: URLSearchParams, omit?: string): any | null {
  const and: any[] = [];
  for (const [param, field] of Object.entries(ITEM_LIST_FILTERS)) {
    if (param === omit) continue;
    const picked = values(sp, param);
    if (picked.length) and.push(listFilter(field, picked));
  }
  return and.length ? { AND: and } : null;
}

/** Dockets owning at least one item that matches `itemWhere` (items link by docket number, not FK). */
async function docketsWithItems(itemWhere: any) {
  const rows = await prisma.itemTable.findMany({
    where: itemWhere,
    select: { docketNoQtnNo: true },
    distinct: ['docketNoQtnNo'],
  });
  const nos = rows.map((r) => r.docketNoQtnNo).filter(Boolean) as string[];
  return nos.length ? docketNoIn(nos) : { id: -1 };
}

/** Docket `where` for the current filters; `{}` when nothing is filtered. */
export async function buildDocketWhere(sp: URLSearchParams, omit?: string): Promise<any> {
  const and: any[] = [];

  const itemWhere = buildItemWhere(sp, omit);
  if (itemWhere) and.push(await docketsWithItems(itemWhere));

  // Search covers the docket's own fields and the names of its items.
  const search = (sp.get('search') || '').trim();
  if (search) {
    const c = { contains: search, mode: 'insensitive' as const };
    and.push({
      OR: [
        { docketNoQtnNo: c },
        { partyName: c },
        { address: c },
        { state: c },
        { utility: c },
        { deliveryLocation: c },
        { type: c },
        await docketsWithItems({ OR: [{ itemNameParty: c }, { ourItemName: c }, { typeOfItem: c }] }),
      ],
    });
  }

  for (const [param, field] of Object.entries(DOCKET_LIST_FILTERS)) {
    if (param === omit) continue;
    const picked = values(sp, param);
    if (!picked.length) continue;
    if (field === 'docketNoQtnNo') and.push(docketNoIn(picked));
    else and.push(listFilter(field, picked));
  }

  const attachments = sp.get('attachments') || '';
  if (attachments === 'has') {
    and.push({ attachments: { not: null } }, { NOT: { attachments: { in: ['', '[]'] } } });
  } else if (attachments === 'empty') {
    and.push({ OR: [{ attachments: null }, { attachments: '' }, { attachments: '[]' }] });
  }

  const createdAt = createdAtRange(sp.get('startDate'), sp.get('endDate'));
  if (createdAt) and.push({ createdAt });

  return and.length ? { AND: and } : {};
}
