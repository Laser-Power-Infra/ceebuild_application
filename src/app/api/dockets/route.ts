import { autoPriceDocket, draftPrices } from '@/modules/enquiry/server/autoCost';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, auditUser, pickFields, EDITOR_ROLES, ADMIN_ROLES } from '@/lib/auth/server';
import { DOCKET_TYPES, isDocketType, normalizeDocketNo } from '@/lib/dockets';
import { buildDocketWhere, buildItemWhere, docketNoIn } from '@/lib/docketWhere';
import { AUTO_DOCKET_NO, nextDocketNumber, isUniqueViolation } from '@/lib/docketNumber';

// Fields a client may change through PUT /api/dockets (id, timestamps etc. are never writable).
const EDITABLE_DOCKET_FIELDS = [
  'docketNoQtnNo',
  'partyName',
  'address',
  'state',
  'utility',
  'deliveryLocation',
  'deliveryState',
  'type',
  'price',
  'payment',
  'delivery',
  'warranty',
  'approval',
  'inspection',
  'attachments',
] as const;

// Columns the Dockets table may sort by (anything else falls back to newest first).
const SORTABLE = ['docketNoQtnNo', 'createdAt', 'partyName', 'state', 'type'] as const;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '100') || 100), 1000);
    const skip = (page - 1) * limit;

    // Filters are built in src/lib/docketWhere.ts, shared with the filter-options route.
    const where = await buildDocketWhere(searchParams);
    const itemWhere = buildItemWhere(searchParams);

    const sortKey = SORTABLE.find((k) => k === searchParams.get('sort'));
    const dir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
    const orderBy: any[] = sortKey ? [{ [sortKey]: dir }, { id: 'desc' }] : [{ id: 'desc' }];

    const [dockets, totalCount] = await Promise.all([
      prisma.dockerPartyName.findMany({ where, orderBy, skip, take: limit }),
      prisma.dockerPartyName.count({ where }),
    ]);

    // Every item of each docket on this page, matched by the one shared rule (trimmed,
    // case-insensitive, exact) - "contains" would mix in revisions like CEE-000518-R1.
    // With item filters on, only the matching items are sent.
    const itemsByNo = new Map<string, any[]>();
    let totalItems = 0;
    try {
      const docketNos = Array.from(new Set(dockets.map((d) => (d.docketNoQtnNo || '').trim()).filter(Boolean)));
      if (docketNos.length > 0) {
        const rows = await prisma.itemTable.findMany({
          where: { AND: [docketNoIn(docketNos), itemWhere ?? {}] },
          orderBy: { id: 'asc' },
        });
        for (const row of rows) {
          const key = normalizeDocketNo(row.docketNoQtnNo);
          const list = itemsByNo.get(key);
          if (list) list.push(row);
          else itemsByNo.set(key, [row]);
        }
      }

      // Item total for the whole filtered set (not just this page).
      // shortcut: unfiltered = every item row, including any whose docket no longer exists; join on docket number if that matters.
      if (Object.keys(where).length === 0) {
        totalItems = await prisma.itemTable.count();
      } else {
        const all = await prisma.dockerPartyName.findMany({ where, select: { docketNoQtnNo: true } });
        const nos = all.map((d) => d.docketNoQtnNo).filter(Boolean) as string[];
        totalItems = nos.length
          ? await prisma.itemTable.count({ where: { AND: [docketNoIn(nos), itemWhere ?? {}] } })
          : 0;
      }
    } catch (itemErr) {
      console.error('Error fetching items for dockets:', itemErr);
    }

    const docketsWithItems = dockets.map((d) => {
      const items = (d.docketNoQtnNo && itemsByNo.get(normalizeDocketNo(d.docketNoQtnNo))) || [];
      return { ...d, items, itemCount: items.length };
    });
    // Grey draft price for items without one (Puja's rule: shown, applied only after approval).
    try {
      const drafts = await draftPrices(docketsWithItems.flatMap((d) => d.items), docketsWithItems.map((d) => d.id));
      for (const d of docketsWithItems) d.items = d.items.map((i) => (drafts[i.id] ? { ...i, draftPrice: drafts[i.id] } : i)) as typeof d.items;
    } catch (e) {
      console.error('[dockets] draft prices', e);
    }

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
      dockets: docketsWithItems,
      totalCount,
      totalItems,
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
      deliveryState,
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
            deliveryState: str(deliveryState),
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
    // Items get their price right away (BOM costing or last quoted price); never blocks the docket.
    if (createdItemsCount) await autoPriceDocket(finalDocketNo).catch((e) => console.error('[auto price] docket', finalDocketNo, e));

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
