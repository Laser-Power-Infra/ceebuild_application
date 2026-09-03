import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { autoDetectOurItemNotAsync } from '@/lib/classifier';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const stateFilter = searchParams.get('state') || '';
    const docketFilter = searchParams.get('docketNoQtnNo') || '';
    const partyFilter = searchParams.get('partyName') || '';
    const itemFilter = searchParams.get('itemFilter') || ''; // Filter dockets by item name
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const skip = (page - 1) * limit;

    const where: any = {};

    // If itemFilter is provided, find all matching docket numbers from itemTable
    if (itemFilter) {
      const matchingItems = await prisma.itemTable.findMany({
        where: {
          OR: [
            { itemNameParty: { contains: itemFilter, mode: 'insensitive' } },
            { ourItemName: { contains: itemFilter, mode: 'insensitive' } },
            { typeOfItem: { contains: itemFilter, mode: 'insensitive' } },
          ],
        },
        select: { docketNoQtnNo: true },
        distinct: ['docketNoQtnNo'],
      });

      const matchingDocketNos = matchingItems.map((i) => i.docketNoQtnNo).filter(Boolean) as string[];
      where.docketNoQtnNo = { in: matchingDocketNos };
    }

    if (search) {
      where.AND = [
        {
          OR: [
            { docketNoQtnNo: { contains: search, mode: 'insensitive' } },
            { partyName: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { state: { contains: search, mode: 'insensitive' } },
            { utility: { contains: search, mode: 'insensitive' } },
            { deliveryLocation: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (docketFilter) {
      where.docketNoQtnNo = { contains: docketFilter, mode: 'insensitive' };
    }
    if (partyFilter) {
      where.partyName = { contains: partyFilter, mode: 'insensitive' };
    }
    if (stateFilter) {
      where.state = { equals: stateFilter, mode: 'insensitive' };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [dockets, totalCount] = await Promise.all([
      prisma.dockerPartyName.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dockerPartyName.count({ where }),
    ]);

    // Fetch first item name for each docket in the current page
    const firstItemMap: { [key: string]: string } = {};
    try {
      const docketNos = dockets.map((d) => d.docketNoQtnNo).filter(Boolean) as string[];
      if (docketNos.length > 0) {
        const firstItems = await prisma.itemTable.findMany({
          where: {
            docketNoQtnNo: { in: docketNos },
          },
          select: {
            docketNoQtnNo: true,
            itemNameParty: true,
            ourItemName: true,
          },
          orderBy: { id: 'asc' },
        });

        for (const item of firstItems) {
          if (item.docketNoQtnNo && !firstItemMap[item.docketNoQtnNo]) {
            firstItemMap[item.docketNoQtnNo] = item.itemNameParty || item.ourItemName || '';
          }
        }
      }
    } catch (itemErr) {
      console.error('Error fetching first items for dockets:', itemErr);
    }

    const docketsWithFirstItem = dockets.map((d) => ({
      ...d,
      firstItemName: d.docketNoQtnNo ? firstItemMap[d.docketNoQtnNo] || '' : '',
    }));

    let stateOptionsList: string[] = [];
    try {
      const states = await prisma.dockerPartyName.findMany({
        select: { state: true },
        distinct: ['state'],
      });
      stateOptionsList = states.map((s) => s.state).filter(Boolean) as string[];
    } catch (stateErr) {
      console.error('Error fetching distinct states:', stateErr);
    }

    return NextResponse.json({
      dockets: docketsWithFirstItem,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
      states: stateOptionsList,
    });
  } catch (error) {
    console.error('Error fetching dockets:', error);
    return NextResponse.json({ error: 'Failed to fetch dockets' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      docketNoQtnNo,
      partyName,
      address,
      state,
      utility,
      deliveryLocation,
      price,
      payment,
      delivery,
      warranty,
      approval,
      inspection,
      items = [],
      userName = 'Admin',
      userId = 'USR-ADMIN-01',
    } = body;

    if (!partyName || !partyName.trim()) {
      return NextResponse.json({ error: 'Party Name is required' }, { status: 400 });
    }

    // Auto-generate docket number if not provided
    let finalDocketNo = docketNoQtnNo ? docketNoQtnNo.trim() : '';
    if (!finalDocketNo) {
      const latest = await prisma.dockerPartyName.findFirst({
        where: { docketNoQtnNo: { startsWith: 'CEE-' } },
        orderBy: { id: 'desc' },
        select: { docketNoQtnNo: true },
      });
      let nextNumber = 518;
      if (latest && latest.docketNoQtnNo) {
        const match = latest.docketNoQtnNo.match(/\d+/);
        if (match) nextNumber = parseInt(match[0], 10) + 1;
      }
      finalDocketNo = `CEE-${String(nextNumber).padStart(6, '0')}`;
    }

    // Create Docket
    const createdDocket = await prisma.dockerPartyName.create({
      data: {
        docketNoQtnNo: finalDocketNo,
        partyName: partyName.trim(),
        address: address ? address.trim() : null,
        state: state ? state.trim() : null,
        utility: utility ? utility.trim() : null,
        deliveryLocation: deliveryLocation ? deliveryLocation.trim() : null,
        price: price || null,
        payment: payment || null,
        delivery: delivery || null,
        warranty: warranty || null,
        approval: approval || null,
        inspection: inspection || null,
      },
    });

    // Create bulk items if passed
    let createdItemsCount = 0;
    if (Array.isArray(items) && items.length > 0) {
      const validItems = items.filter(
        (it) => it && it.itemNameParty && it.itemNameParty.trim() !== ''
      );
      if (validItems.length > 0) {
        const preparedItems = await Promise.all(
          validItems.map(async (it) => {
            const rawName = it.itemNameParty.trim();
            const autoNot =
              it.ourItemNot && it.ourItemNot.trim()
                ? it.ourItemNot.trim()
                : null;
            return {
              docketNoQtnNo: finalDocketNo,
              itemNameParty: rawName,
              uom: it.uom ? it.uom.trim() : null,
              qty: it.qty ? it.qty.trim() : null,
              ourItemNot: autoNot,
              ourItemName: it.ourItemName || null,
              status: it.status || 'Quoted',
            };
          })
        );
        await prisma.itemTable.createMany({
          data: preparedItems,
        });
        createdItemsCount = validItems.length;
      }
    }

    // Record Audit Log with static User Info
    await prisma.editLog.create({
      data: {
        tableName: 'docket-party-name',
        recordId: createdDocket.id,
        fieldName: 'CREATE_DOCKET',
        oldValue: null,
        newValue: `Created Docket ${finalDocketNo} for "${createdDocket.partyName}" with ${createdItemsCount} items by ${userName} (${userId})`,
      },
    });

    return NextResponse.json(
      { docket: createdDocket, createdItemsCount },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating docket:', error);
    return NextResponse.json({ error: 'Failed to create docket' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, userName, userId, ...data } = body;
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const existing = await prisma.dockerPartyName.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const updated = await prisma.dockerPartyName.update({
      where: { id: Number(id) },
      data,
    });

    for (const key of Object.keys(data)) {
      const oldVal = (existing as any)[key] != null ? String((existing as any)[key]) : '';
      const newVal = data[key] != null ? String(data[key]) : '';
      if (oldVal !== newVal) {
        await prisma.editLog.create({
          data: {
            tableName: 'docket-party-name',
            recordId: Number(id),
            fieldName: key,
            oldValue: oldVal,
            newValue: `${newVal} (by ${userName || 'User'} ${userId || ''})`.trim(),
          },
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating docket party:', error);
    return NextResponse.json({ error: 'Failed to update docket party' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const docket = await prisma.dockerPartyName.findUnique({ where: { id } });
    if (!docket) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    if (docket.docketNoQtnNo) {
      await prisma.itemTable.deleteMany({
        where: { docketNoQtnNo: docket.docketNoQtnNo },
      });
    }

    await prisma.dockerPartyName.delete({ where: { id } });

    await prisma.editLog.create({
      data: {
        tableName: 'docket-party-name',
        recordId: id,
        fieldName: 'DELETE_DOCKET',
        oldValue: `Deleted Docket #${id} (${docket.docketNoQtnNo || 'N/A'})`,
        newValue: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting docket:', error);
    return NextResponse.json({ error: 'Failed to delete docket' }, { status: 500 });
  }
}
