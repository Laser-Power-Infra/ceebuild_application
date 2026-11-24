import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { normalizeDocketNo } from '@/lib/dockets';
import { copyQuotationBomToOrder } from '@/modules/costing/server/orderLink';

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
  return prisma.$transaction((tx) => createOrderInTx(tx, { ...input, poNumber }, user), { timeout: 30_000 });
}

/**
 * The order + quotation snapshot + quotation BOM, inside the caller's transaction. Shared by the
 * typed form (createOrder) and the PO-copy intake (M15), which adds the PO fields afterwards.
 */
export async function createOrderInTx(tx: Prisma.TransactionClient, input: NewOrderInput & { poSource?: string }, user: AuthUser) {
  const poNumber = input.poNumber.trim();
  const client = input.client?.trim().slice(0, 200) || null;
  const remarks = input.remarks?.trim().slice(0, 1000) || null;
  {
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
        poSource: input.poSource ?? 'MANUAL',
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
    // M14: the BOM the quotation was costed on becomes the order's first BOM (draft, re-checked).
    const bom = await copyQuotationBomToOrder(tx, order.id, items.map((i) => i.id), user);
    return { id: order.id, quotationBom: bom };
  }
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

/** Contract value (Rs, incl. tax) and contractual delivery date. Editors; each change audited. */
export async function updateOrderTerms(id: number, input: { contractValue?: unknown; deliveryDue?: unknown }, user: AuthUser) {
  const data: { contractValue?: number | null; deliveryDue?: Date | null } = {};
  if ('contractValue' in input) {
    const raw = String(input.contractValue ?? '').replace(/,/g, '').trim();
    if (raw === '') data.contractValue = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new UserError('Contract value must be a positive amount.');
      data.contractValue = Math.round(n * 100) / 100;
    }
  }
  if ('deliveryDue' in input) {
    const raw = String(input.deliveryDue ?? '').trim();
    if (raw === '') data.deliveryDue = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw new UserError('Delivery due must be a date.');
    else data.deliveryDue = new Date(`${raw}T00:00:00Z`);
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id }, select: { contractValue: true, deliveryDue: true } });
    if (!before) throw new UserError('Order not found.');
    await tx.order.update({ where: { id }, data });
    const fmt = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    const logs = (Object.keys(data) as (keyof typeof data)[])
      .filter((k) => fmt(before[k]) !== fmt(data[k]))
      .map((k) => ({ tableName: 'orders', recordId: id, fieldName: k, oldValue: fmt(before[k]), newValue: fmt(data[k]), ...auditUser(user) }));
    if (logs.length) await tx.editLog.createMany({ data: logs });
    return { id };
  });
}
