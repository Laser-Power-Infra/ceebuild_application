import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { sectionKey } from '@/lib/bom/parse';
import type { StockLot, StockUse } from '@/lib/planning/cutting';

// Rev 2 §10 "offcut / stock first": the store's usable offcuts and spare full bars. The indent plan
// takes active stock of the order's sections before ordering new bars (Excel sheet OFFCUT USED).
// Reservation rule: a draft or preview never touches the register; stock is deducted only when the
// indent is ISSUED (then it is committed to that order), so two drafts cannot both "use" one bar
// for good. A cancelled issued indent does not put stock back automatically (the store recounts).

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const TAG = /store#(\d+)/;

export interface StoreStockRow {
  id: number;
  sectionKey: string;
  section: string;
  lengthMm: number;
  qty: number;
  kind: string;
  forPieceLengthMm: number | null;
  location: string | null;
  note: string | null;
  active: boolean;
  reservedIndentNo: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export async function listStoreStock(): Promise<StoreStockRow[]> {
  const rows = await prisma.rmStoreStock.findMany({ orderBy: [{ active: 'desc' }, { sectionKey: 'asc' }, { lengthMm: 'desc' }] });
  return rows.map((r) => ({
    id: r.id,
    sectionKey: r.sectionKey,
    section: r.section,
    lengthMm: r.lengthMm,
    qty: r.qty,
    kind: r.kind,
    forPieceLengthMm: r.forPieceLengthMm,
    location: r.location,
    note: r.note,
    active: r.active,
    reservedIndentNo: r.reservedIndentNo,
    updatedByName: r.updatedByName,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

const int = (v: unknown, label: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};

/** Add a lot, or edit one (id given). */
export async function saveStoreStock(input: Record<string, unknown>, user: AuthUser) {
  const section = String(input.section ?? '').trim().slice(0, 100);
  const key = sectionKey(section);
  if (!key) throw new UserError('Give the section (e.g. FLAT 50X8, ISA 50X50X6).');
  const data = {
    section,
    sectionKey: key,
    lengthMm: int(input.lengthMm, 'Length (mm)', 100, 20000),
    qty: int(input.qty, 'Nos', 1, 100000),
    kind: input.kind === 'FULL' ? 'FULL' : 'OFFCUT',
    forPieceLengthMm: input.forPieceLengthMm === '' || input.forPieceLengthMm === null || input.forPieceLengthMm === undefined ? null : int(input.forPieceLengthMm, 'For piece length (mm)', 50, 20000),
    location: String(input.location ?? '').trim().slice(0, 100) || null,
    note: String(input.note ?? '').trim().slice(0, 300) || null,
    updatedByName: user.name,
  };
  if (data.forPieceLengthMm && data.forPieceLengthMm > data.lengthMm) throw new UserError('The piece length cannot be longer than the stock length.');
  const id = input.id ? Number(input.id) : null;
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.rmStoreStock.findUnique({ where: { id } }) : null;
    if (id && !before) throw new UserError('Stock row not found.');
    const row = id ? await tx.rmStoreStock.update({ where: { id }, data }) : await tx.rmStoreStock.create({ data: { ...data, createdByName: user.name } });
    await tx.editLog.create({
      data: { tableName: 'rm_store_stock', recordId: row.id, fieldName: id ? 'UPDATE' : 'ALL_FIELDS', oldValue: before ? JSON.stringify({ ...before, createdAt: undefined, updatedAt: undefined }) : 'NONE (New Record)', newValue: JSON.stringify(data), ...auditUser(user) },
    });
    return { id: row.id };
  });
}

export async function setStoreStockActive(id: number, active: boolean, user: AuthUser) {
  const r = await prisma.rmStoreStock.findUnique({ where: { id } });
  if (!r) throw new UserError('Stock row not found.');
  await prisma.rmStoreStock.update({ where: { id }, data: { active, updatedByName: user.name } });
  await prisma.editLog.create({ data: { tableName: 'rm_store_stock', recordId: id, fieldName: 'active', oldValue: String(r.active), newValue: String(active), ...auditUser(user) } });
  return { id };
}

/** Active, unreserved stock of these sections, as planner lots (the note carries store#id for the deduction on issue). */
export async function stockLotsFor(tx: Tx, sectionKeys: string[]): Promise<StockLot[]> {
  if (!sectionKeys.length) return [];
  const rows = await tx.rmStoreStock.findMany({ where: { active: true, sectionKey: { in: sectionKeys }, qty: { gt: 0 } }, orderBy: [{ lengthMm: 'desc' }] });
  return rows.map((r) => ({
    sectionKey: r.sectionKey,
    lengthMm: r.lengthMm,
    nos: r.qty,
    forLengthMm: r.forPieceLengthMm,
    note: `store#${r.id}${r.location ? ` ${r.location}` : ''}${r.kind === 'FULL' ? ' (full bars)' : ' (offcuts)'}`,
  }));
}

/** On issue: take the bars the plan used out of the register (reserved for this indent). */
export async function reserveStockForIndent(tx: Tx, uses: StockUse[] | undefined, indentNo: string, user: AuthUser) {
  for (const u of uses ?? []) {
    const id = Number(String(u.note ?? '').match(TAG)?.[1]);
    if (!id || !(u.barsUsed > 0)) continue;
    const r = await tx.rmStoreStock.findUnique({ where: { id } });
    if (!r) continue;
    const left = Math.max(0, r.qty - u.barsUsed);
    await tx.rmStoreStock.update({ where: { id }, data: { qty: left, active: left > 0 ? r.active : false, reservedIndentNo: indentNo, updatedByName: user.name } });
    await tx.editLog.create({ data: { tableName: 'rm_store_stock', recordId: id, fieldName: 'qty', oldValue: String(r.qty), newValue: `${left} (${u.barsUsed} used by indent ${indentNo})`, ...auditUser(user) } });
  }
}
