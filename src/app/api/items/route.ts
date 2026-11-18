import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { autoDetectOurItemNot, autoDetectOurItemNotAsync, extractKeyPhrases } from '@/lib/classifier';
import { requireUser, auditUser, pickFields, EDITOR_ROLES, ADMIN_ROLES } from '@/lib/auth/server';
import { normalizeDocketNo } from '@/lib/dockets';
import { createdAtRange } from '@/lib/dateRange';

// Fields a client may change through PUT /api/items.
const EDITABLE_ITEM_FIELDS = [
  'uniqueNo',
  'docketNoQtnNo',
  'itemNameParty',
  'uom',
  'qty',
  'ourItemNot',
  'typeOfItem',
  'ourItemName',
  'size',
  'sectionMm',
  'sectionalWtKgMtr',
  'lengthInMtr',
  'unitWtOfMemberKg',
  'weightPerPiece',
  'price',
  'uomOfQtn',
  'a',
  'freightPerKg',
  'status',
] as const;

function getFilterList(searchParams: URLSearchParams, key: string): string[] {
  const all = searchParams.getAll(key);
  if (all.length === 0) return [];
  const results: string[] = [];
  for (const item of all) {
    if (!item) continue;
    if (item.startsWith('[') && item.endsWith(']')) {
      try {
        const parsed = JSON.parse(item);
        if (Array.isArray(parsed)) {
          results.push(...parsed.filter(Boolean));
          continue;
        }
      } catch (e) {}
    }
    if (item.includes(',')) {
      results.push(...item.split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      results.push(item.trim());
    }
  }
  return Array.from(new Set(results));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const docketFilters = getFilterList(searchParams, 'docketNoQtnNo');
    const itemFilters = getFilterList(searchParams, 'itemNameParty');
    const uomFilters = getFilterList(searchParams, 'uom');
    const qtyFilters = getFilterList(searchParams, 'qty');
    const ourItemNotFilters = getFilterList(searchParams, 'ourItemNot');
    const typeOfItemFilters = getFilterList(searchParams, 'typeOfItem');
    const ourItemNameFilters = getFilterList(searchParams, 'ourItemName');
    const sizeFilters = getFilterList(searchParams, 'size');
    const sectionMmFilters = getFilterList(searchParams, 'sectionMm');
    const sectionalWtKgMtrFilters = getFilterList(searchParams, 'sectionalWtKgMtr');
    const lengthInMtrFilters = getFilterList(searchParams, 'lengthInMtr');
    const weightPerPieceFilters = getFilterList(searchParams, 'weightPerPiece');
    const unitWtOfMemberKgFilters = getFilterList(searchParams, 'unitWtOfMemberKg');
    const priceFilters = getFilterList(searchParams, 'price');
    const statusFilters = getFilterList(searchParams, 'status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '100') || 100), 1000);
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

    // Items belong to a docket by exact number (trimmed, case-insensitive) - never "contains",
    // otherwise CEE-000518 would also pull in CEE-000518-R1.
    const and: any[] = [];
    if (docketFilters.length > 0) {
      and.push({
        OR: docketFilters.map((d) => ({ docketNoQtnNo: { equals: normalizeDocketNo(d), mode: 'insensitive' } })),
      });
    }

    if (itemFilters.length === 1) {
      where.itemNameParty = { contains: itemFilters[0], mode: 'insensitive' };
    } else if (itemFilters.length > 1) {
      where.itemNameParty = { in: itemFilters };
    }

    if (uomFilters.length === 1) {
      where.uom = { contains: uomFilters[0], mode: 'insensitive' };
    } else if (uomFilters.length > 1) {
      where.uom = { in: uomFilters };
    }

    if (qtyFilters.length === 1) {
      where.qty = { contains: qtyFilters[0], mode: 'insensitive' };
    } else if (qtyFilters.length > 1) {
      where.qty = { in: qtyFilters };
    }

    if (ourItemNotFilters.length === 1) {
      where.ourItemNot = { equals: ourItemNotFilters[0], mode: 'insensitive' };
    } else if (ourItemNotFilters.length > 1) {
      where.ourItemNot = { in: ourItemNotFilters };
    }

    if (typeOfItemFilters.length === 1) {
      where.typeOfItem = { contains: typeOfItemFilters[0], mode: 'insensitive' };
    } else if (typeOfItemFilters.length > 1) {
      where.typeOfItem = { in: typeOfItemFilters };
    }

    if (ourItemNameFilters.length === 1) {
      where.ourItemName = { contains: ourItemNameFilters[0], mode: 'insensitive' };
    } else if (ourItemNameFilters.length > 1) {
      where.ourItemName = { in: ourItemNameFilters };
    }

    if (sizeFilters.length === 1) {
      where.size = { contains: sizeFilters[0], mode: 'insensitive' };
    } else if (sizeFilters.length > 1) {
      where.size = { in: sizeFilters };
    }

    if (sectionMmFilters.length === 1) {
      where.sectionMm = { contains: sectionMmFilters[0], mode: 'insensitive' };
    } else if (sectionMmFilters.length > 1) {
      where.sectionMm = { in: sectionMmFilters };
    }

    if (sectionalWtKgMtrFilters.length === 1) {
      where.sectionalWtKgMtr = { contains: sectionalWtKgMtrFilters[0], mode: 'insensitive' };
    } else if (sectionalWtKgMtrFilters.length > 1) {
      where.sectionalWtKgMtr = { in: sectionalWtKgMtrFilters };
    }

    if (lengthInMtrFilters.length === 1) {
      where.lengthInMtr = { contains: lengthInMtrFilters[0], mode: 'insensitive' };
    } else if (lengthInMtrFilters.length > 1) {
      where.lengthInMtr = { in: lengthInMtrFilters };
    }

    if (weightPerPieceFilters.length === 1) {
      where.weightPerPiece = { contains: weightPerPieceFilters[0], mode: 'insensitive' };
    } else if (weightPerPieceFilters.length > 1) {
      where.weightPerPiece = { in: weightPerPieceFilters };
    }

    if (unitWtOfMemberKgFilters.length === 1) {
      where.unitWtOfMemberKg = { contains: unitWtOfMemberKgFilters[0], mode: 'insensitive' };
    } else if (unitWtOfMemberKgFilters.length > 1) {
      where.unitWtOfMemberKg = { in: unitWtOfMemberKgFilters };
    }

    if (priceFilters.length === 1) {
      where.price = { contains: priceFilters[0], mode: 'insensitive' };
    } else if (priceFilters.length > 1) {
      where.price = { in: priceFilters };
    }

    if (statusFilters.length === 1) {
      where.status = { equals: statusFilters[0], mode: 'insensitive' };
    } else if (statusFilters.length > 1) {
      where.status = { in: statusFilters };
    }

    const createdAt = createdAtRange(startDate, endDate);
    if (createdAt) where.createdAt = createdAt;
    if (and.length) where.AND = and;

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

    let uomOptionsList: string[] = [];
    try {
      const uoms = await prisma.itemTable.findMany({
        select: { uom: true },
        distinct: ['uom'],
        orderBy: { uom: 'asc' },
      });
      uomOptionsList = uoms.map((u) => u.uom).filter(Boolean) as string[];
    } catch (e) {}

    return NextResponse.json({
      items,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      dropdowns: {
        ourItemNotOptions: ['MANUFACTURING', 'NO', 'TRADING'],
        ourItemNameOptions: uniqueOurItemNames,
        statusOptions: ['Quoted', 'NOT Required'],
        uomOptions: uomOptionsList,
      },
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(EDITOR_ROLES);
  if (auth.error) return auth.error;
  const user = auth.user;

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

    const created = await prisma.$transaction(async (tx) => {
     const item = await tx.itemTable.create({
      data: {
        docketNoQtnNo: docketNoQtnNo ? normalizeDocketNo(docketNoQtnNo) : null,
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
        uomOfQtn: (uomOfQtn && uomOfQtn.trim()) ? uomOfQtn.trim() : (unitWtOfMemberKg && unitWtOfMemberKg.trim() ? unitWtOfMemberKg.trim() : null),
        status: (status && status.trim()) ? status.trim() : null,
      },
     });
     await tx.editLog.create({
      data: {
        tableName: 'iteam-table',
        recordId: item.id,
        fieldName: 'CREATE_ITEM',
        oldValue: null,
        newValue: `Created Item: "${item.itemNameParty}" under Docket: ${item.docketNoQtnNo || 'N/A'}`,
        ...auditUser(user),
      },
     });
     return item;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating item:', error);
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireUser(EDITOR_ROLES);
  if (auth.error) return auth.error;
  const user = auth.user;

  try {
    const body = await req.json();
    const id = body?.id;
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    const data = pickFields(body, EDITABLE_ITEM_FIELDS) as Record<string, any>;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
    }

    if (typeof data.docketNoQtnNo === 'string') data.docketNoQtnNo = normalizeDocketNo(data.docketNoQtnNo) || null;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.itemTable.findUnique({ where: { id: Number(id) } });
      if (!existing) return null;

      const updated = await tx.itemTable.update({
        where: { id: Number(id) },
        data,
      });

      for (const key of Object.keys(data)) {
        const oldVal = (existing as any)[key] != null ? String((existing as any)[key]) : '';
        const newVal = data[key] != null ? String(data[key]) : '';
        if (oldVal === newVal) continue;

        await tx.editLog.create({
          data: {
            tableName: 'iteam-table',
            recordId: Number(id),
            fieldName: key,
            oldValue: oldVal,
            newValue: newVal,
            ...auditUser(user),
          },
        });

        // A manual "Our item/Not" choice is remembered as a keyword rule (once per keyword+category)
        // and copied ONLY to items with exactly the same party item name, each change logged.
        if (key === 'ourItemNot' && newVal && existing.itemNameParty?.trim()) {
          const newCat = newVal.trim().toUpperCase();
          const topPhrase = extractKeyPhrases(existing.itemNameParty)[0] || '';

          if (topPhrase) {
            const ruleValue = JSON.stringify({ keyword: topPhrase, category: newCat, sourceItem: existing.itemNameParty });
            const sameRule = await tx.masterValue.findFirst({
              where: { type: 'KEYWORD_CLASSIFICATION_RULE', value: { contains: JSON.stringify(topPhrase) } },
            });
            if (!sameRule) {
              await tx.masterValue.create({ data: { type: 'KEYWORD_CLASSIFICATION_RULE', value: ruleValue, isActive: true } });
            } else if (sameRule.value !== ruleValue || !sameRule.isActive) {
              await tx.masterValue.update({ where: { id: sameRule.id }, data: { value: ruleValue, isActive: true } });
            }
          }

          const twins = await tx.itemTable.findMany({
            where: {
              id: { not: existing.id },
              itemNameParty: { equals: existing.itemNameParty.trim(), mode: 'insensitive' },
            },
            select: { id: true, ourItemNot: true },
          });
          for (const twin of twins) {
            if ((twin.ourItemNot || '').trim().toUpperCase() === newCat) continue;
            await tx.itemTable.update({ where: { id: twin.id }, data: { ourItemNot: newCat } });
            await tx.editLog.create({
              data: {
                tableName: 'iteam-table',
                recordId: twin.id,
                fieldName: 'ourItemNot',
                oldValue: twin.ourItemNot || '',
                newValue: `${newCat} (copied from item #${existing.id} with the same name)`,
                ...auditUser(user),
              },
            });
          }
        }
      }
      return updated;
    });

    if (!result) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    const updated = result;

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating item:', error);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(ADMIN_ROLES);
  if (auth.error) return auth.error;
  const user = auth.user;

  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const item = await prisma.itemTable.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // Delete + audit atomically; the audit row keeps a JSON snapshot of the deleted item.
    await prisma.$transaction([
      prisma.itemTable.delete({ where: { id } }),
      prisma.editLog.create({
        data: {
          tableName: 'iteam-table',
          recordId: id,
          fieldName: 'DELETE_ITEM',
          oldValue: JSON.stringify(item),
          newValue: `Deleted Item #${id} ("${item.itemNameParty || ''}") from Docket ${item.docketNoQtnNo || 'N/A'} by ${user.name} (${user.username})`,
          ...auditUser(user),
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
