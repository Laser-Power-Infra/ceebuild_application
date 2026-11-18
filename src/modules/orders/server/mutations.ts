import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { normalizeDocketNo } from '@/lib/dockets';

export interface NewOrderInput {
  docketId: number;
  poNumber: string;
  poDate: string; // yyyy-mm-dd
  client?: string;
  remarks?: string;
}

/** Order from a docket's PO: the order plus a snapshot of the docket's quotation lines, audited. */
export async function createOrder(input: NewOrderInput, user: AuthUser) {
  const poNumber = input.poNumber.trim();
  if (!poNumber || poNumber.length > 100) throw new UserError('PO number is required (max 100 characters).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.poDate) || Number.isNaN(Date.parse(input.poDate))) throw new UserError('PO date is required.');
  const client = input.client?.trim().slice(0, 200) || null;
  const remarks = input.remarks?.trim().slice(0, 1000) || null;

  return prisma.$transaction(async (tx) => {
    const docket = await tx.dockerPartyName.findUnique({ where: { id: input.docketId } });
    if (!docket) throw new UserError('Docket not found.');
    if (await tx.order.findUnique({ where: { poNumber } })) throw new UserError(`PO ${poNumber} already has an order.`);

    const items = docket.docketNoQtnNo
      ? await tx.itemTable.findMany({ where: { docketNoQtnNo: { equals: normalizeDocketNo(docket.docketNoQtnNo), mode: 'insensitive' } }, orderBy: { id: 'asc' } })
      : [];

    const order = await tx.order.create({
      data: {
        docketId: docket.id,
        docketNo: docket.docketNoQtnNo,
        poNumber,
        poDate: new Date(`${input.poDate}T00:00:00Z`),
        client: client ?? docket.partyName,
        remarks,
        createdById: user.id,
        createdByName: user.name,
        lines: {
          create: items.map((i) => ({
            sourceItemId: i.id,
            itemName: i.itemNameParty,
            ourItemName: i.ourItemName,
            uom: i.uom,
            qty: i.qty,
            price: i.price,
            weightPerPiece: i.weightPerPiece,
          })),
        },
      },
    });

    await tx.editLog.create({
      data: {
        tableName: 'orders',
        recordId: order.id,
        fieldName: 'ALL_FIELDS',
        oldValue: 'NONE (New Record)',
        newValue: JSON.stringify({ docketId: docket.id, docketNo: docket.docketNoQtnNo, poNumber, poDate: input.poDate, client: order.client, lines: items.length }),
        ...auditUser(user),
      },
    });
    return { id: order.id };
  });
}

/** Admin only (checked by the action). Deletes the order and everything under it; the audit row keeps a snapshot. */
export async function deleteOrder(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { _count: { select: { bomUploads: true, bomPieces: true, galvChallans: true, inspections: true, dispatchInstructions: true, dispatches: true } } },
    });
    if (!order) throw new UserError('Order not found.');
    await tx.order.delete({ where: { id } });
    await tx.editLog.create({
      data: {
        tableName: 'orders',
        recordId: id,
        fieldName: 'DELETED',
        oldValue: JSON.stringify(order),
        newValue: null,
        ...auditUser(user),
      },
    });
    return { id };
  });
}
