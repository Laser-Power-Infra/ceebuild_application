'use server';

import { read, write, toId } from '@/lib/actionResult';
import { listStoreStock, saveStoreStock, setStoreStockActive } from '@/modules/rm/server/storeStock';

// Rev 2 §10 store stock register (offcuts / spare full bars used before ordering new bars).

export async function listStoreStockAction() {
  return read(() => listStoreStock());
}
export async function saveStoreStockAction(input: unknown) {
  return write((user) => saveStoreStock(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}, user));
}
export async function setStoreStockActiveAction(id: unknown, active: unknown) {
  return write((user) => setStoreStockActive(toId(id, 'stock row'), active === true, user));
}
