'use server';

import { read, write, cleanQuery, toId, UserError } from '@/lib/actionResult';
import { ADMIN_ROLES } from '@/lib/auth/server';
import { isRegisterKey, listRegister, listRegisterFacet, registerOptions } from '@/modules/registers/server/query';
import { addRegisterEntry, deleteRegisterEntry, updateSecurityStatus } from '@/modules/registers/server/mutations';

function keyOf(v: unknown) {
  if (!isRegisterKey(v)) throw new UserError('Unknown register.');
  return v;
}
const orderOf = (v: unknown) => (v === undefined || v === null || v === '' ? null : toId(v, 'order'));

export async function listRegisterAction(query: unknown) {
  const q = cleanQuery(query);
  return read(async () => listRegister(keyOf(q.extra?.register), orderOf(q.extra?.orderId), q));
}

export async function listRegisterFacetAction(field: unknown, query: unknown) {
  const q = cleanQuery(query);
  return read(async () => listRegisterFacet(keyOf(q.extra?.register), orderOf(q.extra?.orderId), String(field), q));
}

export async function registerOptionsAction(orderId: unknown) {
  return read(() => registerOptions(toId(orderId, 'order')));
}

export async function addRegisterEntryAction(register: unknown, orderId: unknown, input: unknown) {
  return write((user) =>
    addRegisterEntry(keyOf(register), toId(orderId, 'order'), (input && typeof input === 'object' ? input : {}) as Record<string, unknown>, user),
  );
}

export async function deleteRegisterEntryAction(register: unknown, id: unknown) {
  return write((user) => deleteRegisterEntry(keyOf(register), toId(id, 'entry'), user), { roles: ADMIN_ROLES });
}

/** Inline status change of a PBG / LC / retention entry (Editors). */
export async function updateSecurityStatusAction(id: unknown, status: unknown) {
  return write((user) => updateSecurityStatus(toId(id, 'entry'), status, user));
}
