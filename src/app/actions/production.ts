'use server';

import { read, write, cleanQuery, toId, UserError } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { isPlanBasis } from '@/modules/production/columns';
import { createMachine, deleteMachine, listMachines, updateMachine } from '@/modules/production/server/machines';
import { listRouting, orderProgress, resetRouting, saveRoutings } from '@/modules/production/server/routing';
import { orderMachinePlan, shopMachinePlan } from '@/modules/production/server/plan';
import { addEntry, deleteEntry, entryOptions, listEntries, listEntriesFacet, searchOrders } from '@/modules/production/server/entries';

const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
const orderOf = (v: unknown) => (v === undefined || v === null || v === '' ? null : toId(v, 'order'));

// Machines (list public; changes Admin-only)
export async function listMachinesAction() {
  return read(() => listMachines());
}
export async function createMachineAction(input: unknown) {
  return write((user) => createMachine(obj(input), user), { roles: ADMIN_ROLES });
}
export async function updateMachineAction(id: unknown, input: unknown) {
  return write((user) => updateMachine(toId(id, 'machine'), obj(input), user), { roles: ADMIN_ROLES });
}
export async function deleteMachineAction(id: unknown) {
  return write((user) => deleteMachine(toId(id, 'machine'), user), { roles: ADMIN_ROLES });
}

// Routing per order (editors)
export async function listRoutingAction(orderId: unknown) {
  return read(() => listRouting(toId(orderId, 'order')));
}
export async function saveRoutingsAction(orderId: unknown, rows: unknown) {
  return write((user) => saveRoutings(toId(orderId, 'order'), rows, user));
}
export async function resetRoutingAction(orderId: unknown, markNo: unknown) {
  return write((user) => resetRouting(toId(orderId, 'order'), markNo, user));
}
export async function orderProgressAction(orderId: unknown) {
  return read(() => orderProgress(toId(orderId, 'order')));
}

// Machine plan
export async function orderMachinePlanAction(orderId: unknown, basis: unknown) {
  return read(async () => {
    if (!isPlanBasis(basis)) throw new UserError('Unknown plan basis.');
    return orderMachinePlan(toId(orderId, 'order'), basis);
  });
}
export async function shopMachinePlanAction() {
  return read(() => shopMachinePlan());
}

// Daily production entries
export async function listEntriesAction(query: unknown) {
  const q = cleanQuery(query);
  return read(() => listEntries(orderOf(q.extra?.orderId), q));
}
export async function listEntriesFacetAction(key: unknown, query: unknown) {
  const q = cleanQuery(query);
  return read(() => listEntriesFacet(orderOf(q.extra?.orderId), String(key), q));
}
export async function entryOptionsAction(orderId: unknown) {
  return read(() => entryOptions(toId(orderId, 'order')));
}
export async function searchProductionOrdersAction(q: unknown) {
  return read(() => searchOrders(String(q ?? '')));
}
export async function addEntryAction(orderId: unknown, input: unknown) {
  return write((user) => addEntry(toId(orderId, 'order'), obj(input), user));
}
export async function deleteEntryAction(id: unknown) {
  return write((user) => deleteEntry(toId(id, 'entry'), user), { roles: ADMIN_ROLES });
}
