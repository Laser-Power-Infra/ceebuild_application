'use server';

import { read, write, cleanQuery, toId } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { getOrder, listOrders, listOrdersFacet, searchDockets } from '@/modules/orders/server/query';
import { createOrder, deleteOrder } from '@/modules/orders/server/mutations';

export async function listOrdersAction(query: unknown) {
  return read(() => listOrders(cleanQuery(query)));
}

export async function listOrdersFacetAction(key: unknown, query: unknown) {
  return read(() => listOrdersFacet(String(key), cleanQuery(query)));
}

export async function getOrderAction(id: unknown) {
  return read(() => getOrder(toId(id, 'order')));
}

export async function searchDocketsAction(q: unknown) {
  return read(() => searchDockets(String(q ?? '').slice(0, 100)));
}

export async function createOrderAction(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  return write((user) =>
    createOrder(
      {
        docketId: toId(i.docketId, 'docket'),
        poNumber: String(i.poNumber ?? ''),
        poDate: String(i.poDate ?? ''),
        client: i.client ? String(i.client) : undefined,
        remarks: i.remarks ? String(i.remarks) : undefined,
      },
      user,
    ),
  );
}

export async function deleteOrderAction(id: unknown) {
  return write((user) => deleteOrder(toId(id, 'order'), user), { roles: ADMIN_ROLES });
}
