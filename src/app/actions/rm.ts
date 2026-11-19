'use server';

import { read, write, cleanQuery, toId } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { cancelIndent, deleteIndent, generateIndent, issueIndent, listIndents, listIndentsFacet, listOrderIndents } from '@/modules/rm/server/indents';
import {
  addReceipt,
  createSupplementaryIndent,
  deleteReceipt,
  latestCuttingPlan,
  listLots,
  listLotsFacet,
  listOrderReceipts,
  receiptOptions,
  runReplan,
  updateLot,
} from '@/modules/rm/server/receipts';

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// ---- indents
export async function listOrderIndentsAction(orderId: unknown) {
  return read(() => listOrderIndents(toId(orderId, 'order')));
}
export async function generateIndentAction(orderId: unknown, strategy: unknown, remarks: unknown) {
  return write((user) => generateIndent(toId(orderId, 'order'), strategy, remarks, user), { fallback: 'Could not generate the indent' });
}
export async function issueIndentAction(id: unknown) {
  return write((user) => issueIndent(toId(id, 'indent'), user));
}
export async function cancelIndentAction(id: unknown, reason: unknown) {
  return write((user) => cancelIndent(toId(id, 'indent'), reason, user));
}
export async function deleteIndentAction(id: unknown) {
  return write((user) => deleteIndent(toId(id, 'indent'), user), { roles: ADMIN_ROLES });
}
export async function listIndentsAction(query: unknown) {
  return read(() => listIndents(cleanQuery(query)));
}
export async function listIndentsFacetAction(key: unknown, query: unknown) {
  return read(() => listIndentsFacet(String(key), cleanQuery(query)));
}

// ---- receipts + re-plan
export async function listOrderReceiptsAction(orderId: unknown) {
  return read(() => listOrderReceipts(toId(orderId, 'order')));
}
export async function receiptOptionsAction(orderId: unknown) {
  return read(() => receiptOptions(toId(orderId, 'order')));
}
export async function addReceiptAction(orderId: unknown, input: unknown) {
  return write((user) => addReceipt(toId(orderId, 'order'), obj(input), user));
}
export async function updateLotAction(lotId: unknown, input: unknown) {
  return write((user) => updateLot(toId(lotId, 'lot'), obj(input), user));
}
export async function deleteReceiptAction(id: unknown) {
  return write((user) => deleteReceipt(toId(id, 'receipt'), user), { roles: ADMIN_ROLES });
}
export async function latestCuttingPlanAction(orderId: unknown) {
  return read(() => latestCuttingPlan(toId(orderId, 'order')));
}
export async function runReplanAction(orderId: unknown) {
  return write((user) => runReplan(toId(orderId, 'order'), user), { fallback: 'Re-plan failed' });
}
export async function createSupplementaryIndentAction(planId: unknown) {
  return write((user) => createSupplementaryIndent(toId(planId, 'plan'), user));
}
export async function listLotsAction(query: unknown) {
  return read(() => listLots(cleanQuery(query)));
}
export async function listLotsFacetAction(key: unknown, query: unknown) {
  return read(() => listLotsFacet(String(key), cleanQuery(query)));
}
