'use server';

import { read, write, cleanQuery, toId, UserError } from '@/lib/actionResult';
import { prisma } from '@/lib/prisma';
import { normalizeDocketNo } from '@/lib/dockets';
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

/** Admin, from the PO tab: the docket is given by its number (e.g. CEE-000527). */
export async function changeOrderDocketByNoAction(id: unknown, docketNo: unknown, reason: unknown, client?: unknown) {
  return write(async (user) => {
    const no = normalizeDocketNo(String(docketNo ?? ''));
    const d = no ? await prisma.dockerPartyName.findFirst({ where: { docketNoQtnNo: { equals: no, mode: 'insensitive' } }, select: { id: true } }) : null;
    if (!d) throw new UserError(`Docket ${String(docketNo ?? '').trim() || '(blank)'} not found.`);
    return changeOrderDocket(toId(id, 'order'), d.id, String(reason ?? ''), user, { client: typeof client === 'string' && client.trim() ? client : undefined });
  }, { roles: ADMIN_ROLES });
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
