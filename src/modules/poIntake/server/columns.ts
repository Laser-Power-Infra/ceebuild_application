import 'server-only';
import { Prisma, type Order } from '@prisma/client';
import { UserError } from '@/lib/actionResult';
import { PO_FIELDS, PO_FIELD_KEYS, type PoFieldKey } from '@/lib/po/fields';
import { normaliseField } from '@/lib/po/normalise';

// M15: PO field key <-> orders column. Most keys are the column name; these differ.
const COLUMN: Partial<Record<PoFieldKey, keyof Order>> = {
  customerName: 'client',
  completionDate: 'deliveryDue',
};
export const columnOf = (k: PoFieldKey) => (COLUMN[k] ?? k) as keyof Order;

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Order row -> the form's string values. */
export function fieldsFromOrder(o: Order): Record<PoFieldKey, string | null> {
  const out = {} as Record<PoFieldKey, string | null>;
  for (const f of PO_FIELDS) {
    const v = o[columnOf(f.key)] as unknown;
    out[f.key] =
      v === null || v === undefined ? null : v instanceof Date ? ymd(v) : Prisma.Decimal.isDecimal(v) ? (v as Prisma.Decimal).toString() : String(v);
  }
  return out;
}

/**
 * Validated form strings -> orders columns. Typed fields must parse (a date must be a date, an
 * amount an amount); the error names the field.
 */
export function columnsFromFields(fields: Partial<Record<PoFieldKey, string | null>>, only?: PoFieldKey[]) {
  const data: Record<string, unknown> = {};
  const clean: Partial<Record<PoFieldKey, string | null>> = {};
  for (const f of PO_FIELDS) {
    if (only && !only.includes(f.key)) continue;
    if (!(f.key in fields)) continue;
    const raw = fields[f.key];
    const n = normaliseField(f.type, { value: raw, confidence: 'high' });
    if (n.value !== null && n.confidence === 'low' && f.type !== 'gstin') throw new UserError(`${f.label}: ${n.note ?? 'not valid'}.`);
    const v = n.value;
    clean[f.key] = v;
    const col = columnOf(f.key) as string;
    if (v === null) {
      if (f.required) throw new UserError(`${f.label} is required.`);
      data[col] = null;
      continue;
    }
    switch (f.type) {
      case 'date':
        data[col] = new Date(`${v}T00:00:00Z`);
        break;
      case 'money':
      case 'pct':
        data[col] = Number(v);
        break;
      case 'int':
        data[col] = Number.parseInt(v, 10);
        break;
      default:
        data[col] = f.key === 'poNumber' ? v.slice(0, 100) : f.key === 'customerName' ? v.slice(0, 200) : v;
    }
  }
  return { data, clean };
}

export const isPoFieldKey = (k: string): k is PoFieldKey => (PO_FIELD_KEYS as readonly string[]).includes(k);
