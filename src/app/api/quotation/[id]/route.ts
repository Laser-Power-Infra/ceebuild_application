import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
            equals: docket.docketNoQtnNo.trim(),
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
    }

    return NextResponse.json({ docket, items });
  } catch (error) {
    console.error('Error fetching quotation data:', error);
    return NextResponse.json({ error: 'Failed to fetch quotation data' }, { status: 500 });
  }
}
