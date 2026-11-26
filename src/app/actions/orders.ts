'use server';

import { read, write, cleanQuery, toId } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { getOrder, listOrders, listOrdersFacet, searchDockets } from '@/modules/orders/server/query';
import { createOrder, changeOrderDocket, deleteOrder, updateOrderTerms } from '@/modules/orders/server/mutations';

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

/** Admin: put the order on another docket (offer), with the reason; optional customer name fix. */
export async function changeOrderDocketAction(id: unknown, docketId: unknown, reason: unknown, client?: unknown) {
  return write((user) => changeOrderDocket(toId(id, 'order'), toId(docketId, 'docket'), String(reason ?? ''), user, { client: typeof client === 'string' ? client : undefined }), { roles: ADMIN_ROLES });
}

export async function deleteOrderAction(id: unknown) {
  return write((user) => deleteOrder(toId(id, 'order'), user), { roles: ADMIN_ROLES });
}

export async function updateOrderTermsAction(id: unknown, input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  return write((user) =>
    updateOrderTerms(
      toId(id, 'order'),
      { ...('contractValue' in i ? { contractValue: i.contractValue } : {}), ...('deliveryDue' in i ? { deliveryDue: i.deliveryDue } : {}) },
      user,
    ),
  );
}
