import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  BLANK,
  DOCKET_LIST_FILTERS,
  ITEM_LIST_FILTERS,
  buildDocketWhere,
  buildItemWhere,
  docketNoIn,
} from '@/lib/docketWhere';

/**
 * Options for one Dockets filter dropdown: the values that exist under all the OTHER active
 * filters, each with a count (dockets for docket fields, items for item fields).
 * GET /api/dockets/facets?field=partyName&<the same filter params as /api/dockets>
 */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const field = sp.get('field') || '';
    let groups: Array<Record<string, any>>;
    let column: string;

    if (field in DOCKET_LIST_FILTERS) {
      column = DOCKET_LIST_FILTERS[field as keyof typeof DOCKET_LIST_FILTERS];
      groups = await (prisma.dockerPartyName.groupBy as any)({
        by: [column],
        where: await buildDocketWhere(sp, field),
        _count: { _all: true },
      });
    } else if (field in ITEM_LIST_FILTERS) {
      column = ITEM_LIST_FILTERS[field as keyof typeof ITEM_LIST_FILTERS];
      const docketWhere = await buildDocketWhere(sp, field);
      const scope: any[] = [buildItemWhere(sp, field) ?? {}];
      if (Object.keys(docketWhere).length) {
        const rows = await prisma.dockerPartyName.findMany({ where: docketWhere, select: { docketNoQtnNo: true } });
        const nos = rows.map((r) => r.docketNoQtnNo).filter(Boolean) as string[];
        scope.push(nos.length ? docketNoIn(nos) : { id: -1 });
      }
      groups = await (prisma.itemTable.groupBy as any)({
        by: [column],
        where: { AND: scope },
        _count: { _all: true },
      });
    } else {
      return NextResponse.json({ error: 'Unknown filter field' }, { status: 400 });
    }

    // null and '' are the same "blank" to the user.
    const counts = new Map<string, number>();
    for (const g of groups) {
      const value = g[column] ? String(g[column]) : BLANK;
      counts.set(value, (counts.get(value) ?? 0) + g._count._all);
    }
    const options = Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) =>
      a.value.localeCompare(b.value, 'en', { numeric: true })
    );
    return NextResponse.json({ options });
  } catch (error) {
    console.error('Error fetching docket filter options:', error);
    return NextResponse.json({ error: 'Failed to fetch filter options' }, { status: 500 });
  }
}
