// Rev 2 §6: effective-dated master values (pure part: field specs, value parsing, "as on" lookup).
// A version = one field of one master record from a date. The master row keeps today's value.

export type VersionedTable = 'section_master' | 'machines' | 'plan_settings';
export type FieldKind = 'number' | 'int' | 'bool' | 'text';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  unit?: string;
}

/** Date before any real change: the value a record had before its first dated change. */
export const BASELINE_DATE = '2000-01-01';

export const VERSIONED: Record<VersionedTable, { label: string; recordLabel: string; fields: FieldSpec[] }> = {
  section_master: {
    label: 'GTP sections',
    recordLabel: 'Section',
    fields: [
      { key: 'kgPerM', label: 'kg/m', kind: 'number', min: 0.001, max: 10000, unit: 'kg/m' },
      { key: 'maxBarMm', label: 'Longest bar (mm)', kind: 'int', min: 1000, max: 20000, unit: 'mm' },
      { key: 'grade', label: 'Grade', kind: 'text' },
      { key: 'approved', label: 'Approved', kind: 'bool' },
    ],
  },
  machines: {
    label: 'Machines',
    recordLabel: 'Machine',
    fields: [
      { key: 'ratePerHour', label: 'Rate per hour', kind: 'number', min: 0.01, max: 100000 },
      { key: 'units', label: 'Units', kind: 'int', min: 1, max: 50 },
      { key: 'shiftsPerDay', label: 'Shifts per day', kind: 'int', min: 0, max: 3 },
      { key: 'hoursPerShift', label: 'Hours per shift', kind: 'number', min: 0.5, max: 12 },
      { key: 'utilisationPct', label: 'Utilisation %', kind: 'number', min: 1, max: 100, unit: '%' },
      { key: 'active', label: 'Working', kind: 'bool' },
      { key: 'rateConfirmed', label: 'Rate confirmed', kind: 'bool' },
    ],
  },
  plan_settings: {
    label: 'Planning settings',
    recordLabel: 'Settings',
    fields: [
      { key: 'stdBarMm', label: 'Standard bar length', kind: 'int', min: 1000, max: 20000, unit: 'mm' },
      { key: 'maxCustomMm', label: 'Max custom length', kind: 'int', min: 1000, max: 20000, unit: 'mm' },
      { key: 'endAllowanceMm', label: 'End allowance', kind: 'int', min: 0, max: 500, unit: 'mm' },
      { key: 'kerfMm', label: 'Kerf per cut', kind: 'int', min: 0, max: 20, unit: 'mm' },
      { key: 'tolPlusMm', label: 'Plus tolerance', kind: 'int', min: 0, max: 200, unit: 'mm' },
      { key: 'bufferPct', label: 'Buffer %', kind: 'number', min: 0, max: 50, unit: '%' },
      { key: 'minOffcutMm', label: 'Minimum usable offcut', kind: 'int', min: 0, max: 6000, unit: 'mm' },
      { key: 'customMinBars', label: 'Min bars for a custom length', kind: 'int', min: 1, max: 10000 },
      { key: 'customMinMetres', label: 'Custom length from (m per piece length)', kind: 'int', min: 0, max: 100000, unit: 'm' },
      { key: 'leadTimeDays', label: 'Standard lead time', kind: 'int', min: 1, max: 365, unit: 'days' },
      { key: 'paymentTermsDays', label: 'Payment terms', kind: 'int', min: 0, max: 365, unit: 'days' },
      { key: 'workDaysPerWeek', label: 'Working days per week', kind: 'int', min: 1, max: 7 },
    ],
  },
};

export const isVersionedTable = (t: unknown): t is VersionedTable => typeof t === 'string' && t in VERSIONED;
export const fieldSpec = (t: VersionedTable, f: string) => VERSIONED[t].fields.find((x) => x.key === f) ?? null;

/** Stored form of a value (text); null = empty. */
export function storeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') return String((v as { toNumber: () => number }).toNumber());
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Validate a value typed for a field; returns the stored text or an error message. */
export function parseFieldValue(spec: FieldSpec, raw: unknown): { value: string | null } | { error: string } {
  const s = String(raw ?? '').trim();
  if (spec.kind === 'text') return { value: s ? s.slice(0, 100) : null };
  if (spec.kind === 'bool') {
    if (/^(true|yes|y|1)$/i.test(s)) return { value: 'true' };
    if (/^(false|no|n|0)$/i.test(s)) return { value: 'false' };
    return { error: `${spec.label}: answer Yes or No.` };
  }
  if (s === '' && spec.key === 'maxBarMm') return { value: null };
  const n = Number(s.replace(/,/g, ''));
  if (s === '' || !Number.isFinite(n)) return { error: `${spec.label} must be a number.` };
  if (spec.kind === 'int' && !Number.isInteger(n)) return { error: `${spec.label} must be a whole number.` };
  if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) return { error: `${spec.label} must be from ${spec.min} to ${spec.max}.` };
  return { value: String(n) };
}

/** Stored text -> value for the master row (Prisma accepts numbers for Decimal columns). */
export function liveValue(spec: FieldSpec, v: string | null): string | number | boolean | null {
  if (v === null) return null;
  if (spec.kind === 'bool') return v === 'true';
  if (spec.kind === 'number' || spec.kind === 'int') return Number(v);
  return v;
}

export interface VersionRow {
  recordKey: string;
  field: string;
  value: string | null;
  validFrom: string; // yyyy-mm-dd
  id: number;
}

/**
 * Value of each (record, field) as on `date`: the version with the latest valid_from on or before the
 * date (the later-entered one wins on the same date). Records/fields with no such version are absent:
 * the caller keeps the master row's value.
 */
export function valuesAsOn(rows: VersionRow[], date: string): Map<string, Map<string, string | null>> {
  const best = new Map<string, VersionRow>();
  for (const r of rows) {
    if (r.validFrom > date) continue;
    const k = `${r.recordKey}\u0000${r.field}`;
    const b = best.get(k);
    if (!b || r.validFrom > b.validFrom || (r.validFrom === b.validFrom && r.id > b.id)) best.set(k, r);
  }
  const out = new Map<string, Map<string, string | null>>();
  for (const r of best.values()) {
    if (!out.has(r.recordKey)) out.set(r.recordKey, new Map());
    out.get(r.recordKey)!.set(r.field, r.value);
  }
  return out;
}

/** History with "valid to" = the day before the next version of the same field (null = open). */
export function withValidTo<T extends VersionRow>(rows: T[]): (T & { validTo: string | null })[] {
  const sorted = [...rows].sort((a, b) => a.recordKey.localeCompare(b.recordKey) || a.field.localeCompare(b.field) || a.validFrom.localeCompare(b.validFrom) || a.id - b.id);
  return sorted.map((r, i) => {
    const next = sorted.slice(i + 1).find((n) => n.recordKey === r.recordKey && n.field === r.field && n.validFrom > r.validFrom);
    if (!next) return { ...r, validTo: null };
    const d = new Date(`${next.validFrom}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { ...r, validTo: d.toISOString().slice(0, 10) };
  });
}

/** Today in India (yyyy-mm-dd): the plant's calendar day. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
