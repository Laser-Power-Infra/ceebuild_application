import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, auditUser, pickFields, EDITOR_ROLES, ADMIN_ROLES } from '@/lib/auth/server';
import { DOCKET_TYPES, isDocketType, normalizeDocketNo } from '@/lib/dockets';
import { createdAtRange } from '@/lib/dateRange';
import { AUTO_DOCKET_NO, nextDocketNumber, isUniqueViolation } from '@/lib/docketNumber';

/** Exact (trimmed, case-insensitive) docket-number match for any of `nos`. */
const docketNoIn = (nos: string[]) => ({
  OR: nos.map((dn) => ({ docketNoQtnNo: { equals: normalizeDocketNo(dn), mode: 'insensitive' as const } })),
});

// Fields a client may change through PUT /api/dockets (id, timestamps etc. are never writable).
const EDITABLE_DOCKET_FIELDS = [
  'docketNoQtnNo',
  'partyName',
  'address',
  'state',
  'utility',
  'deliveryLocation',
  'type',
  'price',
  'payment',
  'delivery',
  'warranty',
  'approval',
  'inspection',
  'attachments',
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
    const stateFilters = getFilterList(searchParams, 'state');
    const utilityFilters = getFilterList(searchParams, 'utility');
    const typeFilters = getFilterList(searchParams, 'type');
    const attachmentsFilter = searchParams.get('attachments') || '';
    const priceFilters = getFilterList(searchParams, 'price');
    const paymentFilters = getFilterList(searchParams, 'payment');
    const deliveryFilters = getFilterList(searchParams, 'delivery');
    const warrantyFilters = getFilterList(searchParams, 'warranty');
    const approvalFilters = getFilterList(searchParams, 'approval');
    const inspectionFilters = getFilterList(searchParams, 'inspection');
    const docketFilters = getFilterList(searchParams, 'docketNoQtnNo');
    const partyFilters = getFilterList(searchParams, 'partyName');
    const itemFilter = searchParams.get('itemFilter') || ''; // Filter dockets by item name
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '100') || 100), 1000);
    const skip = (page - 1) * limit;

    const where: any = {};
    // Every condition goes into AND so filters combine instead of overwriting each other
    // (the item filter used to be silently replaced when a docket filter was also set).
    const and: any[] = [];

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
      // No matching items => no dockets (an empty OR would match nothing as well, but be explicit).
      and.push(matchingDocketNos.length ? docketNoIn(matchingDocketNos) : { id: -1 });
    }

    if (search) {
      and.push(
        {
          OR: [
            { docketNoQtnNo: { contains: search, mode: 'insensitive' } },
            { partyName: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { state: { contains: search, mode: 'insensitive' } },
            { utility: { contains: search, mode: 'insensitive' } },
            { deliveryLocation: { contains: search, mode: 'insensitive' } },
            { type: { contains: search, mode: 'insensitive' } },
          ],
        },
      );
    }

    if (docketFilters.length > 0) {
      and.push(docketNoIn(docketFilters));
    }

    if (partyFilters.length === 1) {
      where.partyName = { contains: partyFilters[0], mode: 'insensitive' };
    } else if (partyFilters.length > 1) {
      where.partyName = { in: partyFilters };
    }

    if (stateFilters.length === 1) {
      where.state = { equals: stateFilters[0], mode: 'insensitive' };
    } else if (stateFilters.length > 1) {
      where.state = { in: stateFilters };
    }

    if (utilityFilters.length === 1) {
      where.utility = { contains: utilityFilters[0], mode: 'insensitive' };
    } else if (utilityFilters.length > 1) {
      where.utility = { in: utilityFilters };
    }

    if (typeFilters.length === 1) {
      where.type = { equals: typeFilters[0], mode: 'insensitive' };
    } else if (typeFilters.length > 1) {
      where.type = { in: typeFilters };
    }

    if (attachmentsFilter === 'has') {
      and.push({ attachments: { not: null } });
      and.push({ NOT: { attachments: { in: ['', '[]'] } } });
    } else if (attachmentsFilter === 'empty') {
      and.push({
        OR: [
          { attachments: null },
          { attachments: '' },
          { attachments: '[]' },
        ],
      });
    }

    if (priceFilters.length === 1) {
      where.price = { contains: priceFilters[0].trim(), mode: 'insensitive' };
    } else if (priceFilters.length > 1) {
      where.price = { in: priceFilters };
    }

    if (paymentFilters.length === 1) {
      where.payment = { contains: paymentFilters[0].trim(), mode: 'insensitive' };
    } else if (paymentFilters.length > 1) {
      where.payment = { in: paymentFilters };
    }

    if (deliveryFilters.length === 1) {
      where.delivery = { contains: deliveryFilters[0].trim(), mode: 'insensitive' };
    } else if (deliveryFilters.length > 1) {
      where.delivery = { in: deliveryFilters };
    }

    if (warrantyFilters.length === 1) {
      where.warranty = { contains: warrantyFilters[0].trim(), mode: 'insensitive' };
    } else if (warrantyFilters.length > 1) {
      where.warranty = { in: warrantyFilters };
    }

    if (approvalFilters.length === 1) {
      where.approval = { contains: approvalFilters[0].trim(), mode: 'insensitive' };
    } else if (approvalFilters.length > 1) {
      where.approval = { in: approvalFilters };
    }

    if (inspectionFilters.length === 1) {
      where.inspection = { contains: inspectionFilters[0].trim(), mode: 'insensitive' };
    } else if (inspectionFilters.length > 1) {
      where.inspection = { in: inspectionFilters };
    }

    const createdAt = createdAtRange(startDate, endDate);
    if (createdAt) where.createdAt = createdAt;
    if (and.length) where.AND = and;

    const [dockets, totalCount] = await Promise.all([
      prisma.dockerPartyName.findMany({
        where,
        orderBy: { id: 'desc' },
        skip,
        take: limit,
      }),
      prisma.dockerPartyName.count({ where }),
    ]);

    // Fetch first item name for each docket in the current page, matched by the one shared rule
    // (trimmed, case-insensitive, exact) - "contains" would mix in revisions like CEE-000518-R1.
    const firstItemMap: { [key: string]: string } = {};
    try {
      const docketNos = Array.from(
        new Set(dockets.map((d) => (d.docketNoQtnNo || '').trim()).filter(Boolean))
      );
      if (docketNos.length > 0) {
        const firstItems = await prisma.itemTable.findMany({
          where: docketNoIn(docketNos),
          select: {
            docketNoQtnNo: true,
            itemNameParty: true,
            ourItemName: true,
          },
          orderBy: { id: 'asc' },
        });

        for (const item of firstItems) {
          const key = normalizeDocketNo(item.docketNoQtnNo);
          if (key && !firstItemMap[key]) {
            firstItemMap[key] = item.itemNameParty || item.ourItemName || '';
          }
        }
      }
    } catch (itemErr) {
      console.error('Error fetching first items for dockets:', itemErr);
    }

    const docketsWithFirstItem = dockets.map((d) => ({
      ...d,
      firstItemName: d.docketNoQtnNo ? firstItemMap[normalizeDocketNo(d.docketNoQtnNo)] || '' : '',
    }));

    let stateOptionsList: string[] = [];
    let docketOptionsList: string[] = [];
    let partyOptionsList: string[] = [];
    let utilityOptionsList: string[] = [];
    try {
      const [states, docketsList, parties, utilities] = await Promise.all([
        prisma.dockerPartyName.findMany({
          select: { state: true },
          distinct: ['state'],
          orderBy: { state: 'asc' },
        }),
        prisma.dockerPartyName.findMany({
          select: { docketNoQtnNo: true },
          distinct: ['docketNoQtnNo'],
          orderBy: { docketNoQtnNo: 'asc' },
        }),
        prisma.dockerPartyName.findMany({
          select: { partyName: true },
          distinct: ['partyName'],
          orderBy: { partyName: 'asc' },
        }),
        prisma.dockerPartyName.findMany({
          select: { utility: true },
          distinct: ['utility'],
          orderBy: { utility: 'asc' },
        }),
      ]);
      stateOptionsList = states.map((s) => s.state).filter(Boolean) as string[];
      docketOptionsList = docketsList.map((d) => d.docketNoQtnNo).filter(Boolean) as string[];
      partyOptionsList = parties.map((p) => p.partyName).filter(Boolean) as string[];
      utilityOptionsList = utilities.map((u) => u.utility).filter(Boolean) as string[];
    } catch (stateErr) {
      console.error('Error fetching distinct options:', stateErr);
    }

    return NextResponse.json({
      dockets: docketsWithFirstItem,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
      states: stateOptionsList,
      docketsList: docketOptionsList,
      parties: partyOptionsList,
      utilities: utilityOptionsList,
    });
  } catch (error) {
    console.error('Error fetching dockets:', error);
    return NextResponse.json({ error: 'Failed to fetch dockets' }, { status: 500 });
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
      partyName,
      address,
      state,
      utility,
      deliveryLocation,
      type,
      price,
      payment,
      delivery,
      warranty,
      approval,
      inspection,
      attachments,
      items = [],
    } = body;

    if (!partyName || !partyName.trim()) {
      return NextResponse.json({ error: 'Party Name is required' }, { status: 400 });
    }

    const trimmedType = typeof type === 'string' ? type.trim() : '';
    if (!isDocketType(trimmedType)) {
      return NextResponse.json(
        { error: `Type is required and must be one of: ${DOCKET_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const requestedDocketNo = normalizeDocketNo(typeof docketNoQtnNo === 'string' ? docketNoQtnNo : '');

    // Prepare attachments JSON string
    const attachmentsJson = attachments
      ? typeof attachments === 'string'
        ? attachments
        : JSON.stringify(attachments)
      : null;

    const validItems = (Array.isArray(items) ? items : []).filter(
      (it: any) => it && typeof it.itemNameParty === 'string' && it.itemNameParty.trim() !== ''
    );
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    // Docket + items + audit log are written in ONE transaction: a failure leaves nothing half-saved.
    // The docket number is unique in the database. If an auto-style number (CEE-NNNNNN, usually the
    // suggestion shown in the form) was taken by someone saving at the same time, the next free number
    // is used instead; a hand-typed number that is taken is rejected.
    const create = (finalDocketNo: string) =>
      prisma.$transaction(async (tx) => {
        const createdDocket = await tx.dockerPartyName.create({
          data: {
            docketNoQtnNo: finalDocketNo,
            partyName: partyName.trim(),
            address: str(address),
            state: str(state),
            utility: str(utility),
            deliveryLocation: str(deliveryLocation),
            type: trimmedType,
            price: price || null,
            payment: payment || null,
            delivery: delivery || null,
            warranty: warranty || null,
            approval: approval || null,
            inspection: inspection || null,
            attachments: attachmentsJson,
          },
        });

        if (validItems.length > 0) {
          await tx.itemTable.createMany({
            data: validItems.map((it: any) => ({
              docketNoQtnNo: finalDocketNo,
              itemNameParty: it.itemNameParty.trim(),
              uom: str(it.uom),
              qty: str(it.qty),
              ourItemNot: str(it.ourItemNot),
              typeOfItem: str(it.typeOfItem),
              ourItemName: str(it.ourItemName),
              size: str(it.size),
              weightPerPiece: str(it.weightPerPiece),
              unitWtOfMemberKg: str(it.unitWtOfMemberKg),
              price: str(it.price),
              sectionMm: str(it.sectionMm),
              sectionalWtKgMtr: str(it.sectionalWtKgMtr),
              lengthInMtr: str(it.lengthInMtr),
              uomOfQtn: str(it.uomOfQtn) || str(it.unitWtOfMemberKg) || str(it.uom),
              status: str(it.status),
            })),
          });
        }

        await tx.editLog.create({
          data: {
            tableName: 'docket-party-name',
            recordId: createdDocket.id,
            fieldName: 'CREATE_DOCKET',
            oldValue: null,
            newValue: `Created Docket ${finalDocketNo} for "${createdDocket.partyName}" with ${validItems.length} items by ${user.name} (${user.username})`,
            ...auditUser(user),
          },
        });
        return createdDocket;
      });

    let createdDocket: Awaited<ReturnType<typeof create>> | null = null;
    let finalDocketNo = requestedDocketNo || (await nextDocketNumber()).nextDocketNo;
    const autoNumbered = !requestedDocketNo || AUTO_DOCKET_NO.test(requestedDocketNo);
    for (let attempt = 0; attempt < 5 && !createdDocket; attempt++) {
      try {
        createdDocket = await create(finalDocketNo);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (!autoNumbered) {
          return NextResponse.json({ error: `Docket number ${finalDocketNo} already exists` }, { status: 409 });
        }
        finalDocketNo = (await nextDocketNumber()).nextDocketNo;
      }
    }
    if (!createdDocket) {
      return NextResponse.json({ error: 'Could not reserve a docket number, please try again' }, { status: 409 });
    }
    const createdItemsCount = validItems.length;
    const renumbered = !!requestedDocketNo && finalDocketNo !== requestedDocketNo;

    return NextResponse.json(
      { docket: createdDocket, createdItemsCount, renumbered, requestedDocketNo: requestedDocketNo || null },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating docket:', error);
    return NextResponse.json({ error: 'Failed to create docket' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireUser(EDITOR_ROLES);
  if (auth.error) return auth.error;
  const user = auth.user;

  try {
    const body = await req.json();
    const id = Number(body?.id);
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const data = pickFields(body, EDITABLE_DOCKET_FIELDS) as Record<string, string | null>;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
    }

    // Type is mandatory: it can be changed, but never cleared or set to an unknown value.
    if ('type' in data) {
      const t = typeof data.type === 'string' ? data.type.trim() : '';
      if (!isDocketType(t)) {
        return NextResponse.json(
          { error: `Type is required and must be one of: ${DOCKET_TYPES.join(', ')}` },
          { status: 400 }
        );
      }
      data.type = t;
    }

    if ('docketNoQtnNo' in data) {
      if (user.role !== 'Admin') {
        return NextResponse.json({ error: 'Forbidden: only Admin can change a docket number' }, { status: 403 });
      }
      const dn = normalizeDocketNo(typeof data.docketNoQtnNo === 'string' ? data.docketNoQtnNo : '');
      if (!dn) return NextResponse.json({ error: 'Docket No cannot be empty' }, { status: 400 });
      data.docketNoQtnNo = dn;
    }

    const existing = await prisma.dockerPartyName.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // Items are linked to dockets by docket number (no FK), so a rename must move the items too,
    // otherwise they are orphaned and the docket shows "No items listed".
    const oldDocketNo = existing.docketNoQtnNo;
    const newDocketNo = 'docketNoQtnNo' in data ? (data.docketNoQtnNo as string) : oldDocketNo;
    const renamed = Boolean(oldDocketNo && newDocketNo && normalizeDocketNo(oldDocketNo) !== newDocketNo);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.dockerPartyName.update({ where: { id }, data });
      if (renamed) {
        const moved = await tx.itemTable.updateMany({
          where: { docketNoQtnNo: { equals: normalizeDocketNo(oldDocketNo), mode: 'insensitive' } },
          data: { docketNoQtnNo: newDocketNo },
        });
        await tx.editLog.create({
          data: {
            tableName: 'iteam-table',
            recordId: id,
            fieldName: 'RENAME_DOCKET_ITEMS',
            oldValue: oldDocketNo,
            newValue: `${newDocketNo} (${moved.count} items moved with docket #${id})`,
            ...auditUser(user),
          },
        });
      }

      for (const key of Object.keys(data)) {
        const oldVal = (existing as any)[key] != null ? String((existing as any)[key]) : '';
        const newVal = data[key] != null ? String(data[key]) : '';
        if (oldVal !== newVal) {
          await tx.editLog.create({
            data: {
              tableName: 'docket-party-name',
              recordId: id,
              fieldName: key,
              oldValue: oldVal,
              newValue: newVal,
              ...auditUser(user),
            },
          });
        }
      }
      return row;
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'That docket number is already used by another docket' }, { status: 409 });
    }
    console.error('Error updating docket party:', error);
    return NextResponse.json({ error: 'Failed to update docket party' }, { status: 500 });
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

    const docket = await prisma.dockerPartyName.findUnique({ where: { id } });
    if (!docket) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // An order (PO) is linked to this docket; the foreign key would block the delete anyway.
    const orders = await prisma.order.count({ where: { docketId: id } });
    if (orders > 0) {
      return NextResponse.json(
        { error: `This docket has ${orders} order(s) (PO). Delete the order(s) on the Orders page first.` },
        { status: 409 },
      );
    }

    // Delete + audit in one transaction: if the audit entry cannot be written, nothing is deleted.
    // The audit row keeps a JSON snapshot of the docket and its items so it can be restored by hand.
    const deletedItemCount = await prisma.$transaction(async (tx) => {
      const docketNo = normalizeDocketNo(docket.docketNoQtnNo);
      const itemWhere = { docketNoQtnNo: { equals: docketNo, mode: 'insensitive' as const } };
      const items = docketNo ? await tx.itemTable.findMany({ where: itemWhere }) : [];
      if (docketNo) {
        await tx.itemTable.deleteMany({ where: itemWhere });
      }
      await tx.dockerPartyName.delete({ where: { id } });
      await tx.editLog.create({
        data: {
          tableName: 'docket-party-name',
          recordId: id,
          fieldName: 'DELETE_DOCKET',
          oldValue: JSON.stringify({ docket, items }),
          newValue: `Deleted Docket #${id} (${docket.docketNoQtnNo || 'N/A'}, "${docket.partyName || ''}") and ${items.length} items by ${user.name} (${user.username})`,
          ...auditUser(user),
        },
      });
      return items.length;
    });

    return NextResponse.json({ success: true, deletedItemCount });
  } catch (error) {
    console.error('Error deleting docket:', error);
    return NextResponse.json({ error: 'Failed to delete docket' }, { status: 500 });
  }
}
