'use server';

import { read, write } from '@/lib/actionResult';
import { orderNeedsList, requestOrderMailCheck } from '@/modules/orders/server/mailCheck';

/** What each order still needs (checklist from the PO, the dashboard and the order's mails). */
export async function orderNeedsAction(orderIds?: unknown) {
  const ids = Array.isArray(orderIds) ? orderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined;
  return read(() => orderNeedsList(ids));
}

/** "Check mails now": n8n reads the orders' mails at once. */
export async function requestOrderMailCheckAction(orderIds: unknown) {
  const ids = Array.isArray(orderIds) ? orderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  return write((user) => requestOrderMailCheck(ids, user));
}
