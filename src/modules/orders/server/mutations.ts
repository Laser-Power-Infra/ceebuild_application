import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { normalizeDocketNo } from '@/lib/dockets';
import { copyQuotationBomToOrder } from '@/modules/costing/server/orderLink';
import { matchQuotedItems } from '@/lib/po/checks';

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

/**
 * Admin only (checked by the action). Puts the order on another docket (offer): the quotation
 * snapshot is taken again from the new docket, the PO lines get the new offer's quoted rates, and
 * a draft "Quotation BOM" copied from the old docket is replaced by the new docket's (if it has a
 * confirmed costing BOM). BOMs confirmed by a person are kept. Audited.
 */
export async function changeOrderDocket(orderId: number, docketId: number, reason: string, user: AuthUser, opts: { client?: string } = {}) {
  const why = reason.trim().slice(0, 500);
  if (!why) throw new UserError('Say why the docket is changed.');
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { poLines: { orderBy: { lineNo: 'asc' } }, bomUploads: { select: { id: true, fileName: true, status: true } } } });
      if (!order) throw new UserError('Order not found.');
      const docket = await tx.dockerPartyName.findUnique({ where: { id: docketId } });
      if (!docket) throw new UserError('Docket not found.');
      if (docket.id === order.docketId && !opts.client) throw new UserError(`The order is already on ${docket.docketNoQtnNo}.`);
      const items = docket.docketNoQtnNo
        ? await tx.itemTable.findMany({ where: { docketNoQtnNo: { equals: normalizeDocketNo(docket.docketNoQtnNo), mode: 'insensitive' } }, orderBy: { id: 'asc' } })
        : [];

      await tx.orderLine.deleteMany({ where: { orderId } });
      await tx.orderLine.createMany({
        data: items.map((i) => ({ orderId, sourceItemId: i.id, itemName: i.itemNameParty, ourItemName: i.ourItemName, uom: i.uom, qty: i.qty, price: i.price, weightPerPiece: i.weightPerPiece })),
      });

      // Quoted rate per PO line from the new offer.
      const priced = matchQuotedItems(
        order.poLines.map((l) => ({ description: l.description, hsn: l.hsn, unit: l.unit, qty: l.qty?.toNumber() ?? null, unitRate: l.unitRate?.toNumber() ?? null, lineValue: l.lineValue?.toNumber() ?? null, qtyVarPct: l.qtyVarPct?.toNumber() ?? null, confidence: 'high' as const })),
        items.map((i) => ({ id: i.id, name: i.itemNameParty, uom: i.uom, qty: i.qty, price: i.price, qtnUom: i.uomOfQtn, wt: i.weightPerPiece || i.unitWtOfMemberKg })),
      );
      for (let k = 0; k < order.poLines.length; k++)
        await tx.orderPoLine.update({ where: { id: order.poLines[k].id }, data: { quotedRate: priced[k]?.quotedRate ?? null, quotedItemId: priced[k]?.quotedItemId ?? null } });

      const stale = order.bomUploads.filter((b) => b.status === 'DRAFT' && b.fileName.startsWith('Quotation BOM ('));
      if (stale.length) await tx.bomUpload.deleteMany({ where: { id: { in: stale.map((b) => b.id) } } });

      const client = opts.client?.trim().slice(0, 200);
      await tx.order.update({ where: { id: orderId }, data: { docketId: docket.id, docketNo: docket.docketNoQtnNo, ...(client ? { client } : {}) } });
      await tx.editLog.create({
        data: {
          tableName: 'orders',
          recordId: orderId,
          fieldName: 'docket',
          oldValue: JSON.stringify({ docketNo: order.docketNo, client: order.client }),
          newValue: JSON.stringify({ docketNo: docket.docketNoQtnNo, client: client ?? order.client, reason: why, quotationLines: items.length, removedDraftBoms: stale.map((b) => b.fileName) }).slice(0, 5000),
          ...auditUser(user),
        },
      });
      const bom = await copyQuotationBomToOrder(tx, orderId, items.map((i) => i.id), user);
      return { orderId, docketNo: docket.docketNoQtnNo, quotationLines: items.length, removedDraftBoms: stale.length, quotationBom: !!bom };
    },
    { timeout: 60_000 },
  );
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

export const CANCEL_REASONS = { CLIENT_CANCELLED: 'Cancelled by client', SUPERSEDED: 'Superseded by new PO', DUPLICATE: 'Duplicate entry' } as const;

export interface CancelOrderInput {
  reason: string;
  replacedByPo?: string | null;
  cancelDate: string;
  note?: string | null;
  file?: { name: string; type: string; buffer: Buffer } | null;
}

/**
 * Admin only (checked by the action). Cancelled, or Superseded when a replacing PO is named.
 * Draft indents are voided; issued indents and cut material are flagged for transfer, never
 * deleted. Every step is in the audit log.
 */
export async function cancelOrder(id: number, input: CancelOrderInput, user: AuthUser) {
  const reason = String(input.reason ?? '').trim();
  if (!(reason in CANCEL_REASONS)) throw new UserError('Choose a reason: cancelled by client, superseded by a new PO or duplicate entry.');
  const date = String(input.cancelDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new UserError('Cancellation date is required.');
  const replPo = String(input.replacedByPo ?? '').trim();
  const repl = replPo ? await prisma.order.findFirst({ where: { poNumber: { equals: replPo, mode: 'insensitive' } }, select: { id: true, poNumber: true } }) : null;
  if (replPo && !repl) throw new UserError(`Replacing PO "${replPo}" is not in the orders list.`);
  if (repl?.id === id) throw new UserError('An order cannot replace itself.');
  if (reason === 'SUPERSEDED' && !repl) throw new UserError('Superseded needs the replacing PO.');
  const note = String(input.note ?? '').trim().slice(0, 1000) || null;
  let s3Key: string | null = null;
  if (input.file?.buffer.length) {
    const { archiveFile } = await import('@/lib/s3');
    s3Key = await archiveFile('order-cancel', input.file.name, input.file.buffer, input.file.type || 'application/octet-stream');
  }
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id }, select: { poNumber: true, cancelStatus: true } });
    if (!o) throw new UserError('Order not found.');
    if (o.cancelStatus) throw new UserError(`Order is already ${o.cancelStatus.toLowerCase()}.`);
    const status = repl ? 'SUPERSEDED' : 'CANCELLED';
    await tx.order.update({
      where: { id },
      data: { cancelStatus: status, cancelReason: reason, cancelNote: note, cancelDate: new Date(`${date}T00:00:00Z`), replacedByOrderId: repl?.id ?? null, cancelledByName: user.name },
    });
    if (input.file?.buffer.length)
      await tx.orderDocument.create({
        data: { orderId: id, kind: 'CANCELLATION', fileName: input.file.name.slice(0, 255), s3Key, mimeType: input.file.type || null, sizeBytes: input.file.buffer.length, source: 'UPLOAD', uploadedByName: user.name },
      });
    // A cancelled order holds no indent or store stock: drafts are voided; issued ones are flagged.
    const indents = await tx.rmIndent.findMany({ where: { orderId: id, status: { in: ['DRAFT', 'ISSUED'] } }, select: { id: true, indentNo: true, status: true, remarks: true } });
    const voided: string[] = [];
    const flagged: string[] = [];
    for (const ind of indents) {
      if (ind.status === 'DRAFT') {
        await tx.rmIndent.update({ where: { id: ind.id }, data: { status: 'CANCELLED', remarks: `Order PO ${o.poNumber} ${status.toLowerCase()} ${date}` } });
        voided.push(ind.indentNo);
      } else {
        await tx.rmIndent.update({ where: { id: ind.id }, data: { remarks: `${ind.remarks ? `${ind.remarks} | ` : ''}TRANSFER: order ${status.toLowerCase()} ${date} – move the material to another order` } });
        flagged.push(ind.indentNo);
      }
    }
    const detail = [
      `${status}: ${CANCEL_REASONS[reason as keyof typeof CANCEL_REASONS]}`,
      repl ? `replaced by PO ${repl.poNumber}` : null,
      `date ${date}`,
      note,
      voided.length ? `draft indents voided: ${voided.join(', ')}` : null,
      flagged.length ? `issued indents flagged for transfer: ${flagged.join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    await tx.editLog.create({ data: { tableName: 'orders', recordId: id, fieldName: 'cancel_status', oldValue: null, newValue: detail, ...auditUser(user) } });
    return { id, status, voided, flagged };
  });
}

/** Admin only: reopen a cancelled / superseded order (voided indents stay voided). */
export async function reopenOrder(id: number, why: string, user: AuthUser) {
  const reason = String(why ?? '').trim();
  if (!reason) throw new UserError('Give the reason for reopening.');
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id }, select: { cancelStatus: true } });
    if (!o) throw new UserError('Order not found.');
    if (!o.cancelStatus) throw new UserError('Order is not cancelled.');
    await tx.order.update({ where: { id }, data: { cancelStatus: null, cancelReason: null, cancelNote: null, cancelDate: null, replacedByOrderId: null, cancelledByName: null } });
    await tx.editLog.create({ data: { tableName: 'orders', recordId: id, fieldName: 'cancel_status', oldValue: o.cancelStatus, newValue: `REOPENED: ${reason}`, ...auditUser(user) } });
    return { id };
  });
}

/** Admin only: partial cancellation. MT taken off the order (0 clears it); the balance stays open. */
export async function setCancelledMt(id: number, mtRaw: unknown, why: string, user: AuthUser) {
  const reason = String(why ?? '').trim();
  if (!reason) throw new UserError('Give the reason for the quantity change.');
  const s = String(mtRaw ?? '').replace(/,/g, '').trim();
  const mt = s === '' ? 0 : Number(s);
  if (!Number.isFinite(mt) || mt < 0 || mt > 100000) throw new UserError('Cancelled MT must be a positive number.');
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id }, select: { cancelledMt: true } });
    if (!o) throw new UserError('Order not found.');
    const val = mt > 0 ? Math.round(mt * 1000) / 1000 : null;
    await tx.order.update({ where: { id }, data: { cancelledMt: val } });
    await tx.editLog.create({ data: { tableName: 'orders', recordId: id, fieldName: 'cancelled_mt', oldValue: o.cancelledMt?.toString() ?? null, newValue: `${val ?? 0} MT: ${reason}`, ...auditUser(user) } });
    return { id };
  });
}
