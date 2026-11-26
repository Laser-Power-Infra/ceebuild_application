import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { isOperation, machineCapacityPerDay, OP_UNIT } from '@/lib/planning/machines';
import { RATE_UNITS, type MachineRow } from '../columns';
import { applyDueVersions, recordMasterChanges } from '@/modules/masterVersions/server';

// Ceebuild List of Machinery: list for everyone, edits Admin-only (enforced by the action).
// Ranges mirror the CHECK constraint machines_chk in the migration.

export async function listMachines(): Promise<MachineRow[]> {
  await applyDueVersions(); // Rev 2 §6: future-dated values whose date has come
  const rows = await prisma.machine.findMany({
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { productionEntries: true } } },
  });
  return rows.map((m) => {
    const plain = {
      id: m.id,
      code: m.code,
      name: m.name,
      operation: isOperation(m.operation) ? m.operation : 'SHEARING',
      units: m.units,
      ratePerHour: m.ratePerHour.toNumber(),
      rateUnit: m.rateUnit,
      shiftsPerDay: m.shiftsPerDay,
      hoursPerShift: m.hoursPerShift.toNumber(),
      utilisationPct: m.utilisationPct.toNumber(),
      rateConfirmed: m.rateConfirmed,
      active: m.active,
      sortOrder: m.sortOrder,
      remarks: m.remarks,
      entries: m._count.productionEntries,
    };
    return { ...plain, capacityPerDay: Math.round(machineCapacityPerDay(plain) * 100) / 100 } as MachineRow;
  });
}

type Input = Record<string, unknown>;

function num(v: unknown, label: string, min: number, max: number, { int = false, exclusiveMin = false } = {}) {
  const n = Number(String(v ?? '').trim());
  const ok = String(v ?? '').trim() !== '' && Number.isFinite(n) && (exclusiveMin ? n > min : n >= min) && n <= max && (!int || Number.isInteger(n));
  if (!ok) throw new UserError(`${label} must be ${int ? 'a whole number' : 'a number'} ${exclusiveMin ? 'above' : 'from'} ${min}${exclusiveMin ? ' and up to' : ' to'} ${max}.`);
  return n;
}
const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/** Validated machine fields present in `i` (all of them when `full`). */
function parse(i: Input, full: boolean) {
  const out: Prisma.MachineUpdateInput & Record<string, unknown> = {};
  const has = (k: string) => full || k in i;
  if (has('name')) {
    const name = text(i.name, 120);
    if (!name) throw new UserError('Name is required.');
    out.name = name;
  }
  if (has('operation')) {
    if (!isOperation(i.operation)) throw new UserError('Choose a valid operation.');
    out.operation = i.operation;
  }
  if (has('units')) out.units = num(i.units, 'Units', 1, 50, { int: true });
  if (has('ratePerHour')) out.ratePerHour = num(i.ratePerHour, 'Rate per hour', 0, 100000, { exclusiveMin: true });
  if (has('rateUnit')) {
    const u = String(i.rateUnit ?? (isOperation(i.operation) ? OP_UNIT[i.operation] : ''));
    if (!(RATE_UNITS as readonly string[]).includes(u)) throw new UserError(`Rate unit must be one of ${RATE_UNITS.join(', ')}.`);
    out.rateUnit = u;
  }
  if (has('shiftsPerDay')) out.shiftsPerDay = num(i.shiftsPerDay, 'Shifts per day', 0, 3, { int: true });
  if (has('hoursPerShift')) out.hoursPerShift = num(i.hoursPerShift, 'Hours per shift', 0, 12, { exclusiveMin: true });
  if (has('utilisationPct')) out.utilisationPct = num(i.utilisationPct, 'Utilisation %', 0, 100, { exclusiveMin: true });
  if (has('sortOrder')) out.sortOrder = num(i.sortOrder ?? 0, 'Sort order', 0, 10000, { int: true });
  if ('rateConfirmed' in i) out.rateConfirmed = i.rateConfirmed === true;
  if ('active' in i) out.active = i.active !== false;
  if ('remarks' in i) out.remarks = text(i.remarks, 500);
  return out;
}

const audit = (tx: Prisma.TransactionClient, user: AuthUser, recordId: number, fieldName: string, oldValue: unknown, newValue: unknown) =>
  tx.editLog.create({
    data: {
      tableName: 'machines',
      recordId,
      fieldName,
      oldValue: oldValue === null || oldValue === undefined ? null : String(oldValue),
      newValue: newValue === null || newValue === undefined ? null : String(newValue),
      ...auditUser(user),
    },
  });

export async function createMachine(i: Input, user: AuthUser) {
  const code = String(i.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(code)) throw new UserError('Code must be 1-20 letters, digits or dashes (e.g. PP15).');
  const data = parse({ shiftsPerDay: 1, hoursPerShift: 8, utilisationPct: 75, units: 1, sortOrder: 0, ...i }, true);
  const shifts = Number(data.shiftsPerDay);
  if (shifts * Number(data.hoursPerShift) > 24) throw new UserError('Shifts x hours per shift cannot exceed 24 hours.');
  return prisma.$transaction(async (tx) => {
    if (await tx.machine.findUnique({ where: { code } })) throw new UserError(`Machine ${code} already exists.`);
    const m = await tx.machine.create({ data: { ...(data as Prisma.MachineCreateInput), code } });
    await recordMasterChanges(tx, 'machines', code, null, data, user);
    await audit(tx, user, m.id, 'CREATED', null, JSON.stringify({ code, ...data }));
    return { id: m.id };
  });
}

export async function updateMachine(id: number, i: Input, user: AuthUser) {
  const data = parse(i, false);
  if (Object.keys(data).length === 0) throw new UserError('Nothing to change.');
  return prisma.$transaction(async (tx) => {
    const before = await tx.machine.findUnique({ where: { id } });
    if (!before) throw new UserError('Machine not found.');
    if ('operation' in data && data.operation !== before.operation) {
      const used = await tx.productionEntry.count({ where: { machineId: id } });
      if (used) throw new UserError(`Machine ${before.code} has ${used} production entries; its operation cannot change. Add a new machine instead.`);
    }
    const shifts = Number(data.shiftsPerDay ?? before.shiftsPerDay);
    const hours = Number(data.hoursPerShift ?? before.hoursPerShift.toNumber());
    if (shifts * hours > 24) throw new UserError('Shifts x hours per shift cannot exceed 24 hours.');
    await tx.machine.update({ where: { id }, data });
    await recordMasterChanges(tx, 'machines', before.code, before, data, user);
    for (const [k, v] of Object.entries(data)) {
      const old = (before as Record<string, unknown>)[k];
      const oldStr = old instanceof Prisma.Decimal ? old.toNumber() : old;
      if (String(oldStr ?? '') !== String(v ?? '')) await audit(tx, user, id, k, oldStr, v);
    }
    return { id };
  });
}

/** Delete only a machine with no production entries; otherwise it must be deactivated. */
export async function deleteMachine(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id } });
    if (!m) throw new UserError('Machine not found.');
    const used = await tx.productionEntry.count({ where: { machineId: id } });
    if (used) throw new UserError(`Machine ${m.code} has ${used} production entries; deactivate it instead of deleting.`);
    await tx.machine.delete({ where: { id } });
    await audit(tx, user, id, 'DELETED', JSON.stringify({ ...m, ratePerHour: m.ratePerHour.toNumber() }), null);
    return { id };
  });
}
