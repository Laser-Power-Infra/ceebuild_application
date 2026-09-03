import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { autoDetectOurItemNot, autoDetectOurItemNotAsync, extractKeyPhrases } from '@/lib/classifier';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const docketFilter = searchParams.get('docketNoQtnNo') || '';
    const itemFilter = searchParams.get('itemNameParty') || '';
    const ourItemNotFilter = searchParams.get('ourItemNot') || '';
    const ourItemNameFilter = searchParams.get('ourItemName') || '';
    const statusFilter = searchParams.get('status') || '';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { docketNoQtnNo: { contains: search, mode: 'insensitive' } },
        { itemNameParty: { contains: search, mode: 'insensitive' } },
        { ourItemName: { contains: search, mode: 'insensitive' } },
        { typeOfItem: { contains: search, mode: 'insensitive' } },
        { size: { contains: search, mode: 'insensitive' } },
        { status: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (docketFilter) {
      where.docketNoQtnNo = { contains: docketFilter, mode: 'insensitive' };
    }
    if (itemFilter) {
      where.itemNameParty = { contains: itemFilter, mode: 'insensitive' };
    }
    if (ourItemNotFilter) {
      where.ourItemNot = { equals: ourItemNotFilter, mode: 'insensitive' };
    }
    if (ourItemNameFilter) {
      const names = ourItemNameFilter.split(',').map((s) => s.trim()).filter(Boolean);
      if (names.length > 0) {
        where.ourItemName = { in: names };
      }
    }
    if (statusFilter) {
      where.status = { equals: statusFilter, mode: 'insensitive' };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, totalCount] = await Promise.all([
      prisma.itemTable.findMany({
        where,
        orderBy: { id: 'asc' },
        skip,
        take: limit,
      }),
      prisma.itemTable.count({ where }),
    ]);

    const uniqueOurItemNames = [
      'Fabricated Structures',
      'GI Wires',
      'Anti-Climbing Device',
      'Stay Set - 33KV',
      'Stay Set - 11KV',
      'Name Plate',
      'Phase Plate',
      'Circuit Plate',
      'Danger Plate',
      'Pipe Earthing',
      'Rod Earthing',
      'Coil Earthing',
      'Conterpoise Earthing',
      'Bird Guard',
      'OTHERS',
      'GI Pipe',
    ];

    return NextResponse.json({
      items,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      dropdowns: {
        ourItemNotOptions: ['MANUFACTURING', 'NO', 'TRADING'],
        ourItemNameOptions: uniqueOurItemNames,
        statusOptions: ['Quoted', 'NOT Required'],
      },
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      docketNoQtnNo,
      itemNameParty,
      uom,
      qty,
      ourItemNot,
      typeOfItem,
      ourItemName,
      size,
      sectionMm,
      sectionalWtKgMtr,
      lengthInMtr,
      unitWtOfMemberKg,
      weightPerPiece,
      price,
      uomOfQtn,
      status,
    } = body;

    if (!itemNameParty || !itemNameParty.trim()) {
      return NextResponse.json({ error: 'Item Name is required' }, { status: 400 });
    }

    // OUR ITEM/NOT automatic fill function is OFF (disabled per user request)
    const finalOurItemNot = (ourItemNot && ourItemNot.trim()) ? ourItemNot.trim() : null;

    const created = await prisma.itemTable.create({
      data: {
        docketNoQtnNo: docketNoQtnNo ? docketNoQtnNo.trim() : null,
        itemNameParty: itemNameParty.trim(),
        uom: uom ? uom.trim() : null,
        qty: qty ? qty.trim() : null,
        ourItemNot: finalOurItemNot,
        typeOfItem: typeOfItem ? typeOfItem.trim() : null,
        ourItemName: ourItemName || null,
        size: size ? size.trim() : null,
        sectionMm: sectionMm ? sectionMm.trim() : null,
        sectionalWtKgMtr: sectionalWtKgMtr ? sectionalWtKgMtr.trim() : null,
        lengthInMtr: lengthInMtr ? lengthInMtr.trim() : null,
        unitWtOfMemberKg: unitWtOfMemberKg ? unitWtOfMemberKg.trim() : null,
        weightPerPiece: weightPerPiece ? weightPerPiece.trim() : null,
        price: price ? price.trim() : null,
        uomOfQtn: uomOfQtn ? uomOfQtn.trim() : null,
        status: status || 'Quoted',
      },
    });

    await prisma.editLog.create({
      data: {
        tableName: 'iteam-table',
        recordId: created.id,
        fieldName: 'CREATE_ITEM',
        oldValue: null,
        newValue: `Created Item: "${created.itemNameParty}" under Docket: ${created.docketNoQtnNo || 'N/A'}`,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const existing = await prisma.itemTable.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const updated = await prisma.itemTable.update({
      where: { id: Number(id) },
      data,
    });

    for (const key of Object.keys(data)) {
      const oldVal = (existing as any)[key] != null ? String((existing as any)[key]) : '';
      const newVal = data[key] != null ? String(data[key]) : '';
      if (oldVal !== newVal) {
        await prisma.editLog.create({
          data: {
            tableName: 'iteam-table',
            recordId: Number(id),
            fieldName: key,
            oldValue: oldVal,
            newValue: newVal,
          },
        });

        // If user manually updated ourItemNot, extract candidate phrases, save rule to master-values, and update all matching items!
        if (key === 'ourItemNot' && newVal && existing.itemNameParty) {
          const newCat = newVal.toUpperCase();
          const phrases = extractKeyPhrases(existing.itemNameParty);
          const topPhrase = phrases[0] || '';

          if (topPhrase) {
            await prisma.masterValue.create({
              data: {
                type: 'KEYWORD_CLASSIFICATION_RULE',
                value: JSON.stringify({
                  keyword: topPhrase,
                  category: newCat,
                  sourceItem: existing.itemNameParty,
                }),
                isActive: true,
              },
            }).catch(console.error);
          }

          // Propagate change to all items sharing identical or similar description
          try {
            await prisma.itemTable.updateMany({
              where: {
                itemNameParty: { contains: existing.itemNameParty.trim(), mode: 'insensitive' },
              },
              data: {
                ourItemNot: newCat,
              },
            });
          } catch (batchErr) {
            console.error('Error updating matching items batch:', batchErr);
          }
        }
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const item = await prisma.itemTable.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    await prisma.itemTable.delete({ where: { id } });

    await prisma.editLog.create({
      data: {
        tableName: 'iteam-table',
        recordId: id,
        fieldName: 'DELETE_ITEM',
        oldValue: `Deleted Item #${id} ("${item.itemNameParty}")`,
        newValue: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
