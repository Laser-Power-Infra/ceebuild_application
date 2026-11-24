import 'server-only';
import { prisma } from '@/lib/prisma';
import { UserError } from '@/lib/actionResult';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { PO_FIELD_BY_KEY, type PoExtraction, type PoFieldKey, type PoLineDraft } from '@/lib/po/fields';
import { normaliseLine } from '@/lib/po/normalise';
import type { DocKind, OrderPoView } from '../types';
import { columnsFromFields, fieldsFromOrder, isPoFieldKey } from './columns';
import { orderChecks, findDuplicate } from './intake';

const num = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());

/** Everything the order's "PO details" tab shows. */
export async function getOrderPo(orderId: number): Promise<OrderPoView> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { poLines: { orderBy: { lineNo: 'asc' } }, documents: { orderBy: { id: 'asc' } } },
  });
  if (!order) throw new UserError('Order not found.');
  const items = await prisma.itemTable.findMany({ where: { id: { in: order.poLines.map((l) => l.quotedItemId).filter((x): x is number => x !== null) } }, select: { id: true, itemNameParty: true, uom: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const fields = fieldsFromOrder(order);
  const lines = order.poLines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    hsn: l.hsn,
    unit: l.unit,
    qty: num(l.qty),
    unitRate: num(l.unitRate),
    lineValue: num(l.lineValue),
    qtyVarPct: num(l.qtyVarPct),
    confidence: 'high' as const,
    quotedRate: num(l.quotedRate),
    quotedItemId: l.quotedItemId,
    quotedItemName: l.quotedItemId ? itemById.get(l.quotedItemId)?.itemNameParty ?? null : null,
    quotedUom: l.quotedItemId ? itemById.get(l.quotedItemId)?.uom?.toUpperCase() ?? null : null,
  }));
  const edits = await prisma.editLog.findMany({
    where: { tableName: 'orders', recordId: orderId },
    orderBy: { id: 'desc' },
    take: 200,
    select: { fieldName: true, oldValue: true, newValue: true, userName: true, createdAt: true },
  });
  return {
    orderId,
    poSource: order.poSource,
    fields,
    extraction: (order.poExtract ?? null) as unknown as PoExtraction | null,
    lines,
    documents: order.documents.map((d) => ({ id: d.id, kind: d.kind as DocKind, fileName: d.fileName, mimeType: d.mimeType, url: d.s3Key ? `/api/attachments/${encodeURIComponent(d.s3Key)}` : null })),
    checks: await orderChecks(orderId, fields, lines),
    hold: { on: order.onHold, reason: order.holdReason, since: order.holdSince?.toISOString() ?? null, by: order.holdByName },
    job: { status: order.jobStatus, note: order.jobNote, at: order.jobAt?.toISOString() ?? null },
    edits: edits.map((e) => ({ fieldName: e.fieldName, oldValue: e.oldValue, newValue: e.newValue, userName: e.userName, at: e.createdAt.toISOString() })),
  };
}

/** One PO field edited on the order (after Confirm). Logged with old and new value. */
export async function updateOrderPoField(orderId: number, key: string, value: unknown, user: AuthUser) {
  if (!isPoFieldKey(key)) throw new UserError('Unknown field.');
  const { data, clean } = columnsFromFields({ [key]: value === null || value === undefined ? null : String(value) } as Partial<Record<PoFieldKey, string | null>>, [key]);
  if (key === 'poNumber' || key === 'customerName') {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { client: true, poNumber: true } });
    if (!order) throw new UserError('Order not found.');
    const dup = await findDuplicate(key === 'customerName' ? (clean.customerName ?? null) : order.client, key === 'poNumber' ? (clean.poNumber ?? null) : order.poNumber, orderId);
    if (dup) throw new UserError(`Duplicate PO: ${dup.poNumber} is already order #${dup.orderId}.`);
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.order.findUnique({ where: { id: orderId } });
    if (!before) throw new UserError('Order not found.');
    const old = fieldsFromOrder(before)[key];
    const next = clean[key] ?? null;
    if ((old ?? '') === (next ?? '')) return { id: orderId, changed: false };
    await tx.order.update({ where: { id: orderId }, data: { ...data, ...(key === 'totalValue' ? { contractValue: (data.totalValue as number | null) ?? null } : {}) } });
    await tx.editLog.create({ data: { tableName: 'orders', recordId: orderId, fieldName: key, oldValue: old, newValue: next, ...auditUser(user) } });
    return { id: orderId, changed: true, label: PO_FIELD_BY_KEY[key].label };
  });
}

const LINE_FIELDS = ['description', 'hsn', 'unit', 'qty', 'unitRate', 'lineValue', 'qtyVarPct'] as const;
type LineField = (typeof LINE_FIELDS)[number];

/** One PO line cell edited (after Confirm). Logged. */
export async function updatePoLine(lineId: number, field: string, value: unknown, user: AuthUser) {
  if (!(LINE_FIELDS as readonly string[]).includes(field)) throw new UserError('Unknown column.');
  const line = await prisma.orderPoLine.findUnique({ where: { id: lineId } });
  if (!line) throw new UserError('PO line not found.');
  const cur: Record<string, unknown> = {
    description: line.description, hsn: line.hsn, unit: line.unit, qty: num(line.qty), unitRate: num(line.unitRate), lineValue: num(line.lineValue), qtyVariation: num(line.qtyVarPct), confidence: 'high',
  };
  cur[field === 'qtyVarPct' ? 'qtyVariation' : field] = value;
  const n = normaliseLine(cur) as PoLineDraft | null;
  if (!n) throw new UserError('Description is required.');
  const map: Record<LineField, unknown> = { description: n.description, hsn: n.hsn, unit: n.unit, qty: n.qty, unitRate: n.unitRate, lineValue: n.lineValue, qtyVarPct: n.qtyVarPct };
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const was: Record<LineField, unknown> = { description: line.description, hsn: line.hsn, unit: line.unit, qty: num(line.qty), unitRate: num(line.unitRate), lineValue: num(line.lineValue), qtyVarPct: num(line.qtyVarPct) };
  const f = field as LineField;
  if (s(was[f]) === s(map[f])) return { id: lineId };
  await prisma.$transaction([
    prisma.orderPoLine.update({ where: { id: lineId }, data: { [f]: map[f] } }),
    prisma.editLog.create({ data: { tableName: 'orders', recordId: line.orderId, fieldName: `po_line ${line.lineNo}.${f}`, oldValue: s(was[f]), newValue: s(map[f]), ...auditUser(user) } }),
  ]);
  return { id: lineId };
}
