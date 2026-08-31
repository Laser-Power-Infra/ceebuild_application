import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const latest = await prisma.dockerPartyName.findFirst({
      where: { docketNoQtnNo: { startsWith: 'CEE-' } },
      orderBy: { id: 'desc' },
      select: { docketNoQtnNo: true },
    });

    let nextNumber = 518;
    if (latest && latest.docketNoQtnNo) {
      const match = latest.docketNoQtnNo.match(/\d+/);
      if (match) {
        nextNumber = parseInt(match[0], 10) + 1;
      }
    }

    const formattedDocketNo = `CEE-${String(nextNumber).padStart(6, '0')}`;
    return NextResponse.json({ nextDocketNo: formattedDocketNo, nextNumber });
  } catch (error) {
    console.error('Error generating next docket number:', error);
    return NextResponse.json({ error: 'Failed to generate next docket number' }, { status: 500 });
  }
}
