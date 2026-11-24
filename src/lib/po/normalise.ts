// M15 - clean up what the AI read from a PO copy. Pure functions (tested in tests/po.test.ts).
// Every value becomes the string the review form shows; anything that cannot be read cleanly
// keeps the raw text but drops to "low" confidence so it is highlighted for the user.

import {
  DRAWING_STATUSES,
  PO_FIELDS,
  PO_FIELD_KEYS,
  type Confidence,
  type PoBomPiece,
  type PoExtraction,
  type PoFieldKey,
  type PoFieldType,
  type PoFieldValue,
  type PoLineDraft,
} from './fields';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const month = (s: string): number | undefined => MONTHS[s.slice(0, 4)] ?? MONTHS[s.slice(0, 3)];
const pad = (n: number) => String(n).padStart(2, '0');
const validYmd = (y: number, m: number, d: number) => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Indian POs write dates day-first: 13-11-2026, 13.11.26, 13/11/2026, 13th Nov 2026, Nov 13, 2026, 2026-11-13. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})\b/);
  if (m) return validYmd(fullYear(+m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/. ]?([a-z]{3,9})\.?[-/. ]?(\d{2,4})\b/);
  if (m && month(m[2])) return validYmd(fullYear(+m[3]), month(m[2]) as number, +m[1]);
  m = s.match(/^([a-z]{3,9})\.? (\d{1,2}) (\d{4})\b/);
  if (m && month(m[1])) return validYmd(+m[3], month(m[1]) as number, +m[2]);
  return null;
}

/** Rs 1,23,456.50/-, ₹ 78.5 lakh, 1.2 Cr, INR 5,00,000 -> number of rupees. */
export function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).toLowerCase().trim();
  if (!s) return null;
  let mult = 1;
  if (/\b(crore|crores|cr)\b/.test(s)) mult = 1e7;
  else if (/\b(lakh|lakhs|lac|lacs)\b/.test(s)) mult = 1e5;
  s = s.replace(/rs\.?|inr|₹|\/-|crores?|cr\b|lakhs?|lacs?|\s/g, '').replace(/,/g, '');
  const m = s.match(/^-?\d+(\.\d+)?/);
  if (!m || m[0].length !== s.length) return null;
  const n = Number(m[0]) * mult;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** "18%", "IGST @ 18 %", "9% + 9%" (CGST+SGST) -> 18. Also "±25%" -> 25. */
export function parsePct(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  const s = String(v);
  const all = [...s.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  let n: number | null = null;
  if (all.length >= 2 && /\+|cgst|sgst/i.test(s) && all.every((x) => x === all[0])) n = all.reduce((a, b) => a + b, 0);
  else if (all.length >= 1) n = all[0];
  else {
    const m = s.trim().match(/^(?:±|\+\s*\/\s*-|\+-|\+|-)?\s*(\d+(?:\.\d+)?)$/);
    n = m ? Number(m[1]) : null;
  }
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

export function parseIntSafe(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const m = String(v).replace(/,/g, '').match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) && n >= 0 && n < 100000 ? n : null;
}

/** Plain number (quantities): "1,341.200", "100 MT" -> number. */
export function parseNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  const m = s.match(/^[±+]?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit (15th character). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = GST_CHARS.indexOf(first14[i]);
    const prod = val * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

/** Uppercase, no spaces; valid = right shape AND right check digit. */
export function normGstin(v: unknown): { value: string | null; valid: boolean } {
  if (v === null || v === undefined) return { value: null, valid: false };
  const s = String(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!s) return { value: null, valid: false };
  const shape = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(s);
  return { value: s, valid: shape && gstinCheckChar(s.slice(0, 14)) === s[14] };
}

export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const UNIT_MAP: [RegExp, string][] = [
  [/^(mt|mts|m\.t\.?|ton|tons|tonne|tonnes|t)$/, 'MT'],
  [/^(kg|kgs|kilogram|kilograms)$/, 'KG'],
  [/^(no|nos|no\.|nos\.|number|numbers|pc|pcs|piece|pieces|ea|each|qty)$/, 'NOS'],
  [/^(set|sets)$/, 'SETS'],
  [/^(km|kms|kilometre|kilometer)$/, 'KM'],
  [/^(m|mtr|mtrs|meter|metre|meters|metres|rmt|rm)$/, 'MTR'],
  [/^(lot|ls|lumpsum|lump sum|job)$/, 'LOT'],
];

export function normUnit(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).toLowerCase().trim().replace(/\.$/, '');
  if (!s) return null;
  for (const [re, u] of UNIT_MAP) if (re.test(s)) return u;
  return String(v).toUpperCase().trim().slice(0, 20);
}

const CONF = new Set(['high', 'medium', 'low']);
const conf = (v: unknown): Confidence => (CONF.has(String(v).toLowerCase()) ? (String(v).toLowerCase() as Confidence) : 'medium');
const lower = (a: Confidence, b: Confidence): Confidence => {
  const order: Confidence[] = ['missing', 'low', 'medium', 'high'];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
};
const str = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && !/^(null|n\/?a|not (stated|mentioned|given|available)|none|-|nil)$/i.test(s) ? s : null;
};
const fmtMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** One field: normalise by type; failures keep the raw text with low confidence. */
export function normaliseField(type: PoFieldType, raw: { value?: unknown; confidence?: unknown; note?: unknown } | undefined): PoFieldValue {
  const text = str(raw?.value);
  const note = str(raw?.note);
  if (!text) return { value: null, confidence: 'missing', note };
  let c = conf(raw?.confidence);
  const bad = (why: string): PoFieldValue => ({ value: text, confidence: 'low', note: note ? `${note}; ${why}` : why });
  switch (type) {
    case 'date': {
      const d = parseDate(text);
      return d ? { value: d, confidence: c, note } : bad(`could not read "${text}" as a date`);
    }
    case 'money': {
      const n = parseMoney(text);
      return n !== null ? { value: fmtMoney(n), confidence: c, note } : bad(`could not read "${text}" as an amount`);
    }
    case 'pct': {
      const n = parsePct(text);
      return n !== null ? { value: fmtNum(n), confidence: c, note } : bad(`could not read "${text}" as a percentage`);
    }
    case 'int': {
      const n = parseIntSafe(text);
      return n !== null ? { value: String(n), confidence: c, note } : bad(`could not read "${text}" as a number`);
    }
    case 'gstin': {
      const g = normGstin(text);
      if (!g.valid) return { value: g.value ?? text, confidence: 'low', note: 'GSTIN format / check digit does not match - check it' };
      return { value: g.value, confidence: c, note };
    }
    case 'email': {
      const e = text.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
      return e ? { value: e[0], confidence: c, note } : bad('not an email address');
    }
    case 'drawingStatus': {
      const v = text.toUpperCase().replace(/[\s-]+/g, '_');
      if ((DRAWING_STATUSES as readonly string[]).includes(v)) return { value: v, confidence: c, note };
      return bad('unknown drawing status');
    }
    default:
      c = text.length > 2000 ? lower(c, 'medium') : c;
      return { value: text.slice(0, 4000), confidence: c, note };
  }
}

interface RawLine {
  description?: unknown; hsn?: unknown; unit?: unknown; qty?: unknown; unitRate?: unknown; lineValue?: unknown; qtyVariation?: unknown; confidence?: unknown;
}
interface RawPiece {
  markNo?: unknown; description?: unknown; section?: unknown; lengthMm?: unknown; qtyPerSet?: unknown; sets?: unknown; totalQty?: unknown; unitWtKg?: unknown; structure?: unknown;
}
export interface RawExtraction {
  documentType?: unknown;
  fields?: Record<string, { value?: unknown; confidence?: unknown; note?: unknown }>;
  lines?: RawLine[];
  bomPieces?: RawPiece[];
  warnings?: unknown[];
}

export function normaliseLine(l: RawLine): PoLineDraft | null {
  const description = str(l.description);
  if (!description) return null;
  const qty = parseNum(l.qty);
  const unitRate = parseMoney(l.unitRate);
  const lineValue = parseMoney(l.lineValue);
  let c = conf(l.confidence);
  if (qty === null || unitRate === null || lineValue === null) c = lower(c, 'low');
  const hsn = str(l.hsn)?.replace(/\D/g, '') || null;
  return {
    description: description.slice(0, 2000),
    hsn: hsn && hsn.length >= 4 && hsn.length <= 8 ? hsn : null,
    unit: normUnit(str(l.unit)),
    qty,
    unitRate,
    lineValue,
    qtyVarPct: parsePct(str(l.qtyVariation)),
    confidence: c,
  };
}

export function normalisePiece(p: RawPiece): PoBomPiece | null {
  const piece: PoBomPiece = {
    markNo: str(p.markNo)?.slice(0, 60) ?? null,
    description: str(p.description)?.slice(0, 300) ?? null,
    section: str(p.section)?.slice(0, 80) ?? null,
    lengthMm: (() => {
      const n = parseNum(p.lengthMm);
      return n !== null && n > 0 && n < 100000 ? Math.round(n) : null;
    })(),
    qtyPerSet: parseNum(p.qtyPerSet),
    sets: parseNum(p.sets),
    totalQty: parseNum(p.totalQty),
    unitWtKg: parseNum(p.unitWtKg),
    structure: str(p.structure)?.slice(0, 200) ?? null,
  };
  if (!piece.section && !piece.markNo) return null;
  if (piece.totalQty === null && piece.qtyPerSet !== null && piece.sets !== null) piece.totalQty = Math.round(piece.qtyPerSet * piece.sets * 1000) / 1000;
  return piece;
}

/** The AI's JSON -> the shape the review form and the order use. */
export function normaliseExtraction(raw: RawExtraction, model: string, at = new Date().toISOString()): PoExtraction {
  const rawFields = raw.fields ?? {};
  const fields = {} as Record<PoFieldKey, PoFieldValue>;
  for (const f of PO_FIELDS) fields[f.key] = normaliseField(f.type, rawFields[f.key]);

  // State from the GSTIN when the AI left it out (the first two digits are the state code).
  const g = fields.customerGstin.value;
  if (!fields.state.value && g && GST_STATE_CODES[g.slice(0, 2)]) {
    fields.state = { value: GST_STATE_CODES[g.slice(0, 2)], confidence: 'low', note: "from the customer's GSTIN; the delivery state may differ" };
  }
  // GST amount when only basic and rate are printed.
  const basic = parseMoney(fields.basicValue.value);
  const pct = parsePct(fields.gstPct.value);
  if (!fields.gstAmount.value && basic !== null && pct !== null) {
    fields.gstAmount = { value: fmtMoney((basic * pct) / 100), confidence: 'low', note: 'worked out as basic x GST %' };
  }
  for (const k of PO_FIELD_KEYS) if (!(k in fields)) fields[k] = { value: null, confidence: 'missing' };

  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(normaliseLine).filter((l): l is PoLineDraft => !!l).slice(0, 500);
  const bomPieces = (Array.isArray(raw.bomPieces) ? raw.bomPieces : []).map(normalisePiece).filter((p): p is PoBomPiece => !!p).slice(0, 3000);
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : []).map(str).filter((w): w is string => !!w).slice(0, 20);
  return { fields, lines, bomPieces, documentType: str(raw.documentType), warnings, model, at };
}

/** Customer + PO no. key for the duplicate check: case, spaces and punctuation ignored. */
export function poKey(customer: string | null | undefined, poNumber: string) {
  const c = companyTokens(customer ?? '').join(' ');
  const p = poNumber.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return `${c}|${p}`;
}

const COMPANY_STOP = new Set(['PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'CO', 'COMPANY', 'THE', 'AND', 'M/S', 'MS', 'INC', 'CORP', 'CORPORATION', 'INDIA']);

/** "AKS Ventures Pvt. Ltd" -> ["AKS", "VENTURES"]. */
export function companyTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^0-9A-Z]+/g, ' ')
    .split(' ')
    .filter((t) => t && !COMPANY_STOP.has(t));
}
