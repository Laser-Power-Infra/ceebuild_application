import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { manualPrices } from '@/lib/manualPrice';
import { normalizeDocketNo } from '@/lib/dockets';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const docketId = Number(id);

    if (isNaN(docketId)) {
      return NextResponse.json({ error: 'Invalid docket ID' }, { status: 400 });
    }

    const docket = await prisma.dockerPartyName.findUnique({
      where: { id: docketId },
    });

    if (!docket) {
      return NextResponse.json({ error: 'Docket party record not found' }, { status: 404 });
    }

    // Find items matching this docket number
    let items: any[] = [];
    if (docket.docketNoQtnNo && docket.docketNoQtnNo.trim() !== '') {
      const rawItems = await prisma.itemTable.findMany({
        where: {
          docketNoQtnNo: {
            equals: normalizeDocketNo(docket.docketNoQtnNo),
            mode: 'insensitive',
          },
        },
        orderBy: { id: 'asc' },
      });

      // Filter out items where OUR ITEM/NOT is 'NO' or OUR ITEM NAME is 'NO' (case-insensitive)
      items = rawItems.filter((item) => {
        const notVal = (item.ourItemNot || '').trim().toUpperCase();
        const nameVal = (item.ourItemName || '').trim().toUpperCase();
        return notVal !== 'NO' && nameVal !== 'NO';
      });

      // M14: nuts & bolts and bought-out items in the client's purchase scope are quoted as their own
      // lines (from the applied BOM costing), right after the structure item they belong to.
      const costings = await prisma.itemCosting.findMany({
        where: { itemId: { in: items.map((i) => i.id) }, applied: true },
        orderBy: { id: 'desc' },
      });
      const manual = await manualPrices(items);
      const withExtras: any[] = [];
      for (const item of items) {
        withExtras.push(manual[item.id] ? { ...item, manualPrice: manual[item.id] } : item);
        const c = costings.find((x) => x.itemId === item.id);
        if (!c) continue;
        const sets = c.sets.toNumber();
        const setsShown = Math.ceil(sets - 1e-9);
        const extra = (key: string, label: string, total: number) => {
          if (!(total > 0) || !(setsShown > 0)) return;
          withExtras.push({
            id: `${item.id}-${key}`,
            itemNameParty: `${label} for ${item.itemNameParty || item.ourItemName || 'above item'}`,
            ourItemName: label,
            qty: String(setsShown),
            uom: 'SET',
            price: (Math.round((total / setsShown) * 100) / 100).toFixed(2),
            uomOfQtn: 'SET',
            unitWtOfMemberKg: 'SET',
            separateLine: true,
          });
        };
        extra('nb', 'Nuts & Bolts (separate item)', c.nbSellTotal.toNumber());
        extra('bo', 'Bought-out items', c.boSellTotal.toNumber());
      }
      items = withExtras;
    }

    return NextResponse.json({ docket, items });
  } catch (error) {
    console.error('Error fetching quotation data:', error);
    return NextResponse.json({ error: 'Failed to fetch quotation data' }, { status: 500 });
  }
}
