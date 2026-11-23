import 'server-only';
import { prisma } from '@/lib/prisma';
import { auditUser, type AuthUser } from '@/lib/auth/server';
import { UserError } from '@/lib/actionResult';
import { sectionKey, toNum } from '@/lib/bom/parse';
import { RATE_KINDS, RATE_META, normSubject, type RateKind, type RateRow } from '@/lib/costing/calc';
import { FAB_CAT_BY_CODE } from '@/lib/costing/fab';

// Costing Master (Administration). Admin only: every change is a new, dated row plus an audit entry.

export const PURCHASE_CATEGORIES = ['CHANNEL', 'ANGLE', 'FLAT', 'ROD', 'OTHER'] as const;

export interface PurchaseItemRow {
  id: number;
  sectionKey: string;
  label: string;
  category: string;
  active: boolean;
  sortOrder: number;
  kgPerM: number | null;
  inGtp: boolean;
}

export interface RateListRow extends RateRow {
  source: string | null;
  createdByName: string | null;
  createdAt: string;
  /** In force today (latest effective <= today for its kind + subject). */
  current: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function listPurchaseItems(): Promise<PurchaseItemRow[]> {
  const [items, sections] = await Promise.all([
    prisma.rmPurchaseItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    prisma.sectionMaster.findMany({ select: { sectionKey: true, kgPerM: true, approved: true } }),
  ]);
  const gtp = new Map(sections.map((s) => [s.sectionKey, s]));
  return items.map((i) => ({
    id: i.id,
    sectionKey: i.sectionKey,
    label: i.label,
    category: i.category,
    active: i.active,
    sortOrder: i.sortOrder,
    kgPerM: gtp.get(i.sectionKey)?.kgPerM.toNumber() ?? null,
    inGtp: gtp.has(i.sectionKey),
  }));
}

export async function upsertPurchaseItem(input: Record<string, unknown>, user: AuthUser) {
  const label = String(input.label ?? '').trim().slice(0, 100);
  const key = sectionKey(label);
  if (!key) throw new UserError('Section is required (e.g. ISMC 75x40).');
  const category = String(input.category ?? '').toUpperCase();
  if (!(PURCHASE_CATEGORIES as readonly string[]).includes(category)) throw new UserError('Choose a category.');
  const active = input.active !== false && input.active !== 'false';
  const sortOrder = Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
  return prisma.$transaction(async (tx) => {
    const before = await tx.rmPurchaseItem.findUnique({ where: { sectionKey: key } });
    const row = await tx.rmPurchaseItem.upsert({
      where: { sectionKey: key },
      create: { sectionKey: key, label, category, active, sortOrder },
      update: { label, category, active, sortOrder },
    });
    await tx.editLog.create({
      data: {
        tableName: 'rm_purchase_items',
        recordId: row.id,
        fieldName: before ? 'ALL_FIELDS (updated)' : 'ALL_FIELDS',
        oldValue: before ? JSON.stringify(before) : 'NONE (New Record)',
        newValue: JSON.stringify({ sectionKey: key, label, category, active, sortOrder }),
        ...auditUser(user),
      },
    });
    return { id: row.id };
  });
}

export async function listRates(): Promise<RateListRow[]> {
  const rows = await prisma.costRate.findMany({ orderBy: [{ kind: 'asc' }, { subject: 'asc' }, { effectiveFrom: 'desc' }, { id: 'desc' }] });
  const t = today();
  const currentIds = new Set<number>();
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${r.kind}|${r.subject}`;
    if (seen.has(k) || ymd(r.effectiveFrom) > t) continue;
    seen.add(k);
    currentIds.add(r.id);
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    value: r.value.toNumber(),
    unit: r.unit,
    effectiveFrom: ymd(r.effectiveFrom),
    source: r.source,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    current: currentIds.has(r.id),
  }));
}

/** All rates as plain rows for the calculator. */
export async function allRates(): Promise<RateRow[]> {
  const rows = await prisma.costRate.findMany();
  return rows.map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, value: r.value.toNumber(), unit: r.unit, effectiveFrom: ymd(r.effectiveFrom), source: r.source }));
}

/** New version of a rate. Old versions are kept untouched. */
export async function addRate(input: Record<string, unknown>, user: AuthUser) {
  const kind = String(input.kind ?? '') as RateKind;
  if (!(RATE_KINDS as readonly string[]).includes(kind)) throw new UserError('Choose what the rate is for.');
  const meta = RATE_META[kind];
  let subject = meta.perSubject ? normSubject(String(input.subject ?? '')) : 'DEFAULT';
  // RM rates / wastage are keyed by the purchase item section key.
  if ((kind === 'RM_RATE' || kind === 'WASTAGE_PCT') && subject !== 'DEFAULT') subject = sectionKey(subject) ?? subject;
  if (kind === 'RM_RATE') {
    const item = await prisma.rmPurchaseItem.findUnique({ where: { sectionKey: subject } });
    if (!item) throw new UserError('RM rate must be for an item on the RM purchase list. Add the item first.');
  }
  if (kind === 'BOUGHT_OUT' && subject === 'DEFAULT') throw new UserError('Give the bought-out item name.');
  let unit = String(input.unit ?? meta.units[0]);
  if (kind === 'FAB_RATE') {
    // Keyed by the job-work chart category; the unit (Rs/kg or Rs/pc) is the category's own.
    const cat = FAB_CAT_BY_CODE[subject];
    if (!cat) throw new UserError('Choose a fabrication category from the job-work chart.');
    unit = cat.unit;
  }
  if (!meta.units.includes(unit)) throw new UserError(`Unit must be ${meta.units.join(' or ')}.`);
  const value = toNum(input.value);
  if (value === null || value < 0 || value > 1e9) throw new UserError('Enter a value of 0 or more.');
  if (unit === '%' && value > 100) throw new UserError('A percentage cannot be over 100.');
  const eff = String(input.effectiveFrom ?? '').trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || Number.isNaN(Date.parse(eff))) throw new UserError('Effective date must be a date.');
  const source = String(input.source ?? '').trim().slice(0, 300) || null;

  return prisma.$transaction(async (tx) => {
    const prev = await tx.costRate.findFirst({ where: { kind, subject, effectiveFrom: { lte: new Date(`${eff}T00:00:00Z`) } }, orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }] });
    const row = await tx.costRate.create({
      data: { kind, subject, value, unit, effectiveFrom: new Date(`${eff}T00:00:00Z`), source, createdById: user.id, createdByName: user.name },
    });
    await tx.editLog.create({
      data: {
        tableName: 'cost_rates',
        recordId: row.id,
        fieldName: `${kind} ${subject}`,
        oldValue: prev ? `${prev.value.toString()} ${prev.unit} from ${ymd(prev.effectiveFrom)}` : 'NONE (New Record)',
        newValue: `${value} ${unit} from ${eff}${source ? ` (${source})` : ''}`,
        ...auditUser(user),
      },
    });
    return { id: row.id };
  });
}

/**
 * Remove a rate version only if no saved costing used it (otherwise an old quotation could no
 * longer show its rates). Entered-by-mistake rows are the use case.
 */
export async function deleteRate(id: number, user: AuthUser) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.costRate.findUnique({ where: { id } });
    if (!row) throw new UserError('Rate not found.');
    const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM item_costings WHERE detail->'ratesUsed' @> ${JSON.stringify([{ id }])}::jsonb`;
    if (n > 0) throw new UserError(`This rate was used by ${n} saved costing(s); add a new version instead of deleting it.`);
    await tx.costRate.delete({ where: { id } });
    await tx.editLog.create({ data: { tableName: 'cost_rates', recordId: id, fieldName: 'DELETED', oldValue: JSON.stringify(row), newValue: null, ...auditUser(user) } });
    return { id };
  });
}
