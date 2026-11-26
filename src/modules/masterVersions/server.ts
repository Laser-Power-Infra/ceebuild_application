import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import {
  BASELINE_DATE,
  VERSIONED,
  fieldSpec,
  isVersionedTable,
  liveValue,
  parseFieldValue,
  storeValue,
  todayIst,
  valuesAsOn,
  withValidTo,
  type VersionRow,
  type VersionedTable,
} from '@/lib/masters/versions';

// Rev 2 §6: every change of a section, machine or planning setting is kept as a dated version.
// The master row always shows the value as on today; a future-dated value is copied to it on its
// date (applyDueVersions, called when the masters are read). Costing "as on <date>" reads versions.
// Quotation snapshots are frozen JSON, so a back-dated change never alters a quoted offer.

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The master row's current value of a field, as stored text. */
async function liveRow(db: Db, table: VersionedTable, key: string): Promise<Record<string, unknown> | null> {
  if (table === 'section_master') return db.sectionMaster.findUnique({ where: { sectionKey: key } });
  if (table === 'machines') return db.machine.findUnique({ where: { code: key } });
  return db.planSettings.findUnique({ where: { id: 1 } });
}

async function writeLive(tx: Tx, table: VersionedTable, key: string, field: string, value: unknown) {
  const data = { [field]: value } as never;
  if (table === 'section_master') await tx.sectionMaster.update({ where: { sectionKey: key }, data });
  else if (table === 'machines') await tx.machine.update({ where: { code: key }, data });
  else await tx.planSettings.update({ where: { id: 1 }, data });
}

async function recordId(tx: Tx, table: VersionedTable, key: string) {
  const row = await liveRow(tx, table, key);
  return row && typeof row.id === 'number' ? row.id : 0;
}

/** First dated change of a field: keep the value it had until now as the baseline version. */
async function ensureBaseline(tx: Tx, table: VersionedTable, key: string, field: string, current: string | null, user: AuthUser) {
  const any = await tx.masterVersion.findFirst({ where: { tableName: table, recordKey: key, field }, select: { id: true } });
  if (any) return;
  await tx.masterVersion.create({
    data: { tableName: table, recordKey: key, field, value: current, validFrom: day(BASELINE_DATE), applied: true, reason: 'Value before the first dated change', changedById: user.id, changedByName: user.name },
  });
}

/**
 * Called inside the transaction of an ordinary master edit (effective today): a version for every
 * tracked field that changed. `before` = the row before the edit (null for a new record).
 */
export async function recordMasterChanges(tx: Tx, table: VersionedTable, key: string, before: Record<string, unknown> | null, after: Record<string, unknown>, user: AuthUser, reason?: string) {
  const today = todayIst();
  for (const f of VERSIONED[table].fields) {
    if (!(f.key in after)) continue;
    const oldV = before ? storeValue(before[f.key]) : null;
    const newV = storeValue(after[f.key]);
    if (before && oldV === newV) continue;
    if (before) await ensureBaseline(tx, table, key, f.key, oldV, user);
    await tx.masterVersion.create({
      data: { tableName: table, recordKey: key, field: f.key, value: newV, validFrom: day(before ? today : BASELINE_DATE), applied: true, reason: reason ?? (before ? 'Edited in the master' : 'New record'), changedById: user.id, changedByName: user.name },
    });
  }
}

/** Copy to the master row the value of `field` as on today (the latest version on or before today). */
async function syncLive(tx: Tx, table: VersionedTable, key: string, field: string, user: AuthUser | null) {
  const spec = fieldSpec(table, field);
  if (!spec) return false;
  const v = await tx.masterVersion.findFirst({
    where: { tableName: table, recordKey: key, field, validFrom: { lte: day(todayIst()) } },
    orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
  });
  const row = await liveRow(tx, table, key);
  if (!v || !row) return false;
  const current = storeValue(row[field]);
  if (current === v.value) return false;
  await writeLive(tx, table, key, field, liveValue(spec, v.value));
  await tx.editLog.create({
    data: {
      tableName: table,
      recordId: typeof row.id === 'number' ? row.id : 0,
      fieldName: field,
      oldValue: current,
      newValue: v.value,
      ...(user ? auditUser(user) : { userName: `Dated change from ${ymd(v.validFrom)} (${v.changedByName ?? 'system'})` }),
    },
  });
  return true;
}

export interface DatedChangeInput {
  table: string;
  recordKey: string;
  field: string;
  value: unknown;
  validFrom: string;
  reason: string;
}

/** Admin: a value of one field from a chosen date (back-dated, today or future), with a reason. */
export async function addDatedChange(i: DatedChangeInput, user: AuthUser) {
  if (!isVersionedTable(i.table)) throw new UserError('Unknown master.');
  const table = i.table;
  const spec = fieldSpec(table, i.field);
  if (!spec) throw new UserError('This field has no dated values.');
  const key = table === 'plan_settings' ? '1' : String(i.recordKey ?? '').trim();
  if (!key) throw new UserError(`Choose the ${VERSIONED[table].recordLabel.toLowerCase()}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.validFrom) || Number.isNaN(day(i.validFrom).getTime())) throw new UserError('Give the date the value applies from.');
  if (i.validFrom <= BASELINE_DATE) throw new UserError('The date must be after 01-01-2000.');
  const reason = String(i.reason ?? '').trim();
  if (!reason) throw new UserError('Give the reason for the change.');
  const parsed = parseFieldValue(spec, i.value);
  if ('error' in parsed) throw new UserError(parsed.error);

  const today = todayIst();
  const result = await prisma.$transaction(async (tx) => {
    const row = await liveRow(tx, table, key);
    if (!row) throw new UserError(`${VERSIONED[table].recordLabel} ${key} not found.`);
    await ensureBaseline(tx, table, key, spec.key, storeValue(row[spec.key]), user);
    const v = await tx.masterVersion.create({
      data: { tableName: table, recordKey: key, field: spec.key, value: parsed.value, validFrom: day(i.validFrom), applied: i.validFrom <= today, reason: reason.slice(0, 300), changedById: user.id, changedByName: user.name },
    });
    await tx.editLog.create({
      data: { tableName: 'master_versions', recordId: v.id, fieldName: `${table}.${key}.${spec.key} from ${i.validFrom}`, oldValue: storeValue(row[spec.key]), newValue: parsed.value, ...auditUser(user) },
    });
    const changedToday = await syncLive(tx, table, key, spec.key, user);
    return { id: v.id, future: i.validFrom > today, changedToday, recordId: await recordId(tx, table, key) };
  });
  if (table === 'section_master' && result.changedToday) {
    const { recheckOpenUploads } = await import('@/modules/bom/server/mutations');
    await recheckOpenUploads();
  }
  return result;
}

/** Future-dated values whose date has come: copy them to the master rows. Cheap when none are due. */
export async function applyDueVersions() {
  const due = await prisma.masterVersion.findMany({ where: { applied: false, validFrom: { lte: day(todayIst()) } }, select: { id: true, tableName: true, recordKey: true, field: true } });
  if (due.length === 0) return 0;
  let changed = 0;
  await prisma.$transaction(async (tx) => {
    const seen = new Set<string>();
    for (const d of due) {
      const k = `${d.tableName}|${d.recordKey}|${d.field}`;
      if (seen.has(k) || !isVersionedTable(d.tableName)) continue;
      seen.add(k);
      if (await syncLive(tx, d.tableName, d.recordKey, d.field, null)) changed++;
    }
    await tx.masterVersion.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { applied: true } });
  });
  if (changed && due.some((d) => d.tableName === 'section_master')) {
    const { recheckOpenUploads } = await import('@/modules/bom/server/mutations');
    await recheckOpenUploads();
  }
  return changed;
}

async function versionRows(table: VersionedTable, keys?: string[]): Promise<VersionRow[]> {
  const rows = await prisma.masterVersion.findMany({
    where: { tableName: table, ...(keys ? { recordKey: { in: keys } } : {}) },
    select: { id: true, recordKey: true, field: true, value: true, validFrom: true },
  });
  return rows.map((r) => ({ ...r, validFrom: ymd(r.validFrom) }));
}

/** Section kg/m (and longest bar) as on a date, for the given keys. Missing = no dated change. */
export async function sectionsAsOn(keys: string[], date: string) {
  if (keys.length === 0) return new Map<string, { kgPerM?: number; maxBarMm?: number | null; approved?: boolean }>();
  const vals = valuesAsOn(await versionRows('section_master', keys), date);
  const out = new Map<string, { kgPerM?: number; maxBarMm?: number | null; approved?: boolean }>();
  for (const [k, f] of vals) {
    const o: { kgPerM?: number; maxBarMm?: number | null; approved?: boolean } = {};
    if (f.has('kgPerM') && f.get('kgPerM') !== null) o.kgPerM = Number(f.get('kgPerM'));
    if (f.has('maxBarMm')) o.maxBarMm = f.get('maxBarMm') === null ? null : Number(f.get('maxBarMm'));
    if (f.has('approved')) o.approved = f.get('approved') === 'true';
    out.set(k, o);
  }
  return out;
}

/** Planning settings as on a date: today's settings with the dated values of that date laid over. */
export async function planSettingsAsOn<T extends object>(current: T, date: string): Promise<T> {
  if (date >= todayIst()) return current;
  const f = valuesAsOn(await versionRows('plan_settings', ['1']), date).get('1');
  if (!f) return current;
  const out = { ...current } as Record<string, unknown>;
  for (const [field, v] of f) {
    const spec = fieldSpec('plan_settings', field);
    if (spec && v !== null) out[field] = liveValue(spec, v);
  }
  return out as T;
}

/** Machines as on a date (rate, units, shifts, working). */
export async function machinesAsOn(date: string) {
  const machines = await prisma.machine.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  const vals = valuesAsOn(await versionRows('machines'), date);
  return machines.map((m) => {
    const out: Record<string, unknown> = { code: m.code, name: m.name, operation: m.operation, units: m.units, ratePerHour: m.ratePerHour.toNumber(), shiftsPerDay: m.shiftsPerDay, hoursPerShift: m.hoursPerShift.toNumber(), utilisationPct: m.utilisationPct.toNumber(), active: m.active, rateConfirmed: m.rateConfirmed };
    for (const [field, v] of vals.get(m.code) ?? []) {
      const spec = fieldSpec('machines', field);
      if (spec && v !== null) out[field] = liveValue(spec, v);
    }
    return out;
  });
}

export interface VersionView {
  id: number;
  recordKey: string;
  field: string;
  fieldLabel: string;
  value: string | null;
  validFrom: string;
  validTo: string | null;
  status: 'BASELINE' | 'PAST' | 'CURRENT' | 'FUTURE';
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

/** History of one master (optionally one record), newest first. */
export async function listMasterVersions(table: string, recordKey?: string | null): Promise<VersionView[]> {
  if (!isVersionedTable(table)) throw new UserError('Unknown master.');
  const rows = await prisma.masterVersion.findMany({
    where: { tableName: table, ...(recordKey ? { recordKey } : {}) },
    orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
    take: 500,
  });
  const today = todayIst();
  const withTo = withValidTo(rows.map((r) => ({ ...r, validFrom: ymd(r.validFrom) })));
  const byId = new Map(withTo.map((r) => [r.id, r]));
  return rows.map((r) => {
    const w = byId.get(r.id)!;
    const from = ymd(r.validFrom);
    const status: VersionView['status'] = from === BASELINE_DATE ? 'BASELINE' : from > today ? 'FUTURE' : w.validTo && w.validTo < today ? 'PAST' : 'CURRENT';
    return {
      id: r.id,
      recordKey: r.recordKey,
      field: r.field,
      fieldLabel: fieldSpec(table, r.field)?.label ?? r.field,
      value: r.value,
      validFrom: from,
      validTo: w.validTo,
      status,
      reason: r.reason,
      changedByName: r.changedByName,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Records a dated change can be made for (key + label). */
export async function versionedRecords(table: string): Promise<{ key: string; label: string }[]> {
  if (!isVersionedTable(table)) throw new UserError('Unknown master.');
  if (table === 'plan_settings') return [{ key: '1', label: 'Planning settings' }];
  if (table === 'machines') return (await prisma.machine.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true } })).map((m) => ({ key: m.code, label: `${m.code} – ${m.name}` }));
  return (await prisma.sectionMaster.findMany({ orderBy: { label: 'asc' }, select: { sectionKey: true, label: true } })).map((s) => ({ key: s.sectionKey, label: s.label }));
}
