// M15 - automatic checks on a PO before it becomes an order, and matching of the PO to a docket
// and its lines to our quoted items. Pure functions (tests/po.test.ts).

import { companyTokens, normUnit, parseDate, parseMoney, parsePct } from './normalise';
import type { PoLineDraft } from './fields';

export type CheckLevel = 'block' | 'flag' | 'info';
export interface PoCheck {
  level: CheckLevel;
  code: 'DUPLICATE' | 'LINE_TOTAL' | 'BASIC_TOTAL' | 'GST' | 'GRAND_TOTAL' | 'DELIVERY' | 'RATE' | 'REQUIRED' | 'NO_LINES';
  message: string;
  /** Field key or `line:<index>` the check points at. */
  target?: string;
}

/** Amounts match when within Rs 10 or 0.5 %, whichever is larger (rounding on printed POs). */
export const amountsMatch = (a: number, b: number) => Math.abs(a - b) <= Math.max(10, Math.abs(b) * 0.005);

const rs = (n: number) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface CheckInput {
  fields: Partial<Record<string, string | null>>;
  lines: PoLineDraft[];
  /** yyyy-mm-dd */
  today: string;
  leadTimeDays: number;
  duplicateOf?: { poNumber: string; orderId: number } | null;
}

export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Per-kg rate so a PO rate per MT can be compared with a quoted rate per kg (and back). */
export function ratePerKg(rate: number | null | undefined, unit: string | null | undefined): number | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  const u = (unit ?? '').toUpperCase();
  if (u === 'KG' || u === 'KGS') return rate;
  // Quotation sheets often store a per-kg price against an MT quantity (e.g. "101.24 MT @ 77").
  if (u === 'MT' || u === 'MTS' || u === 'TON' || u === 'TONS') return rate >= 1000 ? rate / 1000 : rate;
  return null;
}

/** Compare PO rate with our quoted rate on the same basis. null when the units cannot be compared. */
export function compareRate(line: Pick<PoLineDraft, 'unitRate' | 'unit' | 'quotedRate' | 'quotedUom'>): { diffPct: number; basis: string } | null {
  if (line.unitRate === null || line.quotedRate === null || line.quotedRate === undefined) return null;
  const a = ratePerKg(line.unitRate, line.unit);
  const b = ratePerKg(line.quotedRate, line.quotedUom ?? line.unit);
  if (a !== null && b !== null && b > 0) return { diffPct: Math.round(((a - b) / b) * 1000) / 10, basis: 'per kg' };
  const sameUnit = (line.unit ?? '').toUpperCase() === (line.quotedUom ?? line.unit ?? '').toUpperCase();
  if (sameUnit && line.quotedRate > 0) return { diffPct: Math.round(((line.unitRate - line.quotedRate) / line.quotedRate) * 1000) / 10, basis: `per ${line.unit ?? 'unit'}` };
  return null;
}

export function runPoChecks(input: CheckInput): PoCheck[] {
  const out: PoCheck[] = [];
  const f = input.fields;
  if (input.duplicateOf) {
    out.push({ level: 'block', code: 'DUPLICATE', target: 'poNumber', message: `Duplicate: this customer's PO ${input.duplicateOf.poNumber} is already order #${input.duplicateOf.orderId}.` });
  }
  for (const [k, label] of [['customerName', 'Customer'], ['poNumber', 'PO no.'], ['poDate', 'PO date']] as const) {
    if (!f[k]) out.push({ level: 'block', code: 'REQUIRED', target: k, message: `${label} is required.` });
  }
  if (input.lines.length === 0) out.push({ level: 'flag', code: 'NO_LINES', message: 'No PO line items were read. Add them, or check the PO copy.' });

  input.lines.forEach((l, i) => {
    if (l.qty !== null && l.unitRate !== null && l.lineValue !== null) {
      const calc = Math.round(l.qty * l.unitRate * 100) / 100;
      if (!amountsMatch(calc, l.lineValue)) {
        out.push({ level: 'flag', code: 'LINE_TOTAL', target: `line:${i}`, message: `Line ${i + 1}: qty x rate = ${rs(calc)} but line value is ${rs(l.lineValue)}.` });
      }
    }
    const cmp = compareRate(l);
    if (cmp && l.quotedRate !== null && l.quotedRate !== undefined) {
      const msg = `Line ${i + 1}: PO rate ${l.unitRate} vs our quoted ${l.quotedRate} (${cmp.diffPct > 0 ? '+' : ''}${cmp.diffPct}% ${cmp.basis}).`;
      out.push({ level: cmp.diffPct < -0.5 ? 'flag' : 'info', code: 'RATE', target: `line:${i}`, message: cmp.diffPct < -0.5 ? `${msg} PO rate is below our quote.` : msg });
    }
  });

  const basic = parseMoney(f.basicValue);
  const lineSum = input.lines.every((l) => l.lineValue !== null) && input.lines.length ? input.lines.reduce((s, l) => s + (l.lineValue ?? 0), 0) : null;
  if (basic !== null && lineSum !== null && !amountsMatch(lineSum, basic)) {
    out.push({ level: 'flag', code: 'BASIC_TOTAL', target: 'basicValue', message: `Line values add up to ${rs(lineSum)} but the basic value is ${rs(basic)}.` });
  }
  const pct = parsePct(f.gstPct);
  const gst = parseMoney(f.gstAmount);
  const total = parseMoney(f.totalValue);
  const base = basic ?? lineSum;
  if (base !== null && pct !== null && gst !== null && !amountsMatch((base * pct) / 100, gst)) {
    out.push({ level: 'flag', code: 'GST', target: 'gstAmount', message: `GST ${pct}% of ${rs(base)} is ${rs((base * pct) / 100)} but the PO shows ${rs(gst)}.` });
  }
  if (base !== null && total !== null) {
    const expected = gst !== null ? base + gst : pct !== null ? base * (1 + pct / 100) : null;
    if (expected !== null && !amountsMatch(expected, total)) {
      out.push({ level: 'flag', code: 'GRAND_TOTAL', target: 'totalValue', message: `Basic + GST = ${rs(expected)} but the total is ${rs(total)} (freight or other charges?).` });
    }
  }

  const due = parseDate(f.completionDate);
  if (due) {
    const earliest = addDays(input.today, input.leadTimeDays);
    if (due < earliest) {
      out.push({ level: 'flag', code: 'DELIVERY', target: 'completionDate', message: `Delivery date ${due} is earlier than today + standard lead time of ${input.leadTimeDays} days (${earliest}).` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ matching

/** Levenshtein distance, capped (enough for typos such as VETURES vs VENTURES). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const tokenEq = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b, 2) <= 2);

/** 0..1 similarity of two company names (stop-words dropped, typo-tolerant). */
export function nameSimilarity(a: string, b: string): number {
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  if (!ta.length || !tb.length) return 0;
  const hits = ta.filter((x) => tb.some((y) => tokenEq(x, y))).length;
  return hits / Math.max(ta.length, tb.length);
}

const WORD_STOP = new Set(['OF', 'THE', 'AND', 'FOR', 'WITH', 'TO', 'IN', 'ON', 'AS', 'PER', 'MM', 'NO', 'NOS', 'SUPPLY', 'ITEMS', 'ITEM', 'MATERIAL', 'MATERIALS', 'LIKE', 'ALL', 'ETC']);
/** FABRICATION / FABRICATED / FABRICATING -> FABRICAT; STRUCTURES -> STRUCTURE. */
const stem = (w: string) => (w.length > 6 ? w.replace(/(ATION|ATED|ATING|ING|ED|ES|S)$/, '') : w.length > 4 ? w.replace(/S$/, '') : w);
// Voltages and bare numbers say nothing about the item ("11 kV stay set" vs "11 kV GI structure").
const NOISE = /^(\d+|\d*KV|KV|V|KM|MT|KG)$/;
export const words = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !WORD_STOP.has(w) && !NOISE.test(w))
    .map(stem);

/** 0..1 overlap of two item descriptions. */
export function textSimilarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w) || [...wb].some((x) => tokenEq(w, x))) hits++;
  return hits / Math.min(wa.size, wb.size) * (Math.min(wa.size, wb.size) / Math.max(wa.size, wb.size)) ** 0.25;
}

export interface DocketCandidate {
  id: number;
  docketNo: string | null;
  party: string | null;
  utility: string | null;
  state: string | null;
  items: { id: number; name: string | null; uom: string | null; qty: string | null; price: string | null }[];
  /** Confirmed item BOM / costing exists (the quotation BOM can be carried into the order). */
  hasBom: boolean;
  orders: number;
}
export interface DocketMatch {
  id: number;
  docketNo: string | null;
  party: string | null;
  utility: string | null;
  score: number;
  reasons: string[];
  hasBom: boolean;
  orders: number;
}

const UTILITY_ALIASES: [RegExp, string][] = [
  [/south bihar|sbpdcl/i, 'SBPDCL'],
  [/north bihar|nbpdcl/i, 'NBPDCL'],
  [/uttarakhand power|upcl/i, 'UPCL'],
  [/chel+igada|chheligada/i, 'CHELLIGADA'],
];
const utilityKey = (s: string | null | undefined) => {
  if (!s) return null;
  for (const [re, k] of UTILITY_ALIASES) if (re.test(s)) return k;
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
};

/**
 * Rank the dockets (offers) this PO most likely answers: customer name first, then end client /
 * project, then how well the PO lines match the quoted items. Ties go to the newer docket.
 */
export function rankDockets(
  po: { customer: string | null; endClient: string | null; project: string | null; lines: { description: string; qty: number | null; unit: string | null }[] },
  dockets: DocketCandidate[],
): DocketMatch[] {
  const target = [utilityKey(po.endClient), utilityKey(po.project)].filter(Boolean) as string[];
  const ranked = dockets.map((d) => {
    const reasons: string[] = [];
    const nameSim = po.customer && d.party ? nameSimilarity(po.customer, d.party) : 0;
    let score = nameSim * 60;
    if (nameSim >= 0.5) reasons.push(`party "${d.party}"`);
    const u = utilityKey(d.utility);
    if (u && target.some((t) => t === u || t.includes(u) || u.includes(t))) {
      score += 15;
      reasons.push(`utility ${d.utility}`);
    }
    let best = 0;
    for (const l of po.lines) for (const it of d.items) if (it.name) best = Math.max(best, textSimilarity(l.description, it.name));
    if (best > 0.3) {
      score += best * 20;
      reasons.push(`items match ${Math.round(best * 100)}%`);
    }
    // Same quantity (e.g. 100 MT PO vs 100 MT quoted) is a strong hint.
    const poQty = po.lines.map((l) => l.qty).filter((q): q is number => q !== null);
    const qQty = d.items.map((i) => Number(String(i.qty ?? '').replace(/,/g, ''))).filter((q) => Number.isFinite(q) && q > 0);
    if (poQty.some((p) => qQty.some((q) => Math.abs(p - q) / Math.max(p, q) < 0.03 || Math.abs(p * 1000 - q) / Math.max(p * 1000, q) < 0.03))) {
      score += 5;
      reasons.push('quantity matches');
    }
    if (d.hasBom) {
      score += 3;
      reasons.push('costed BOM on file');
    }
    return { id: d.id, docketNo: d.docketNo, party: d.party, utility: d.utility, score: Math.round(score * 10) / 10, reasons, hasBom: d.hasBom, orders: d.orders };
  });
  return ranked.filter((r) => r.score >= 20).sort((a, b) => b.score - a.score || b.id - a.id);
}

/** Best quoted item for each PO line (same docket), by description; used for the rate comparison. */
export function matchQuotedItems(lines: PoLineDraft[], items: DocketCandidate['items']): PoLineDraft[] {
  return lines.map((l) => {
    let best: { it: DocketCandidate['items'][number]; s: number } | null = null;
    for (const it of items) {
      if (!it.name) continue;
      const s = textSimilarity(l.description, it.name) + (items.length === 1 ? 0.3 : 0);
      if (!best || s > best.s) best = { it, s };
    }
    if (!best || best.s < 0.3) return { ...l, quotedRate: null, quotedItemId: null, quotedItemName: null, quotedUom: null };
    const price = parseMoney(best.it.price);
    return { ...l, quotedRate: price, quotedItemId: best.it.id, quotedItemName: best.it.name, quotedUom: normUnit(best.it.uom) };
  });
}
