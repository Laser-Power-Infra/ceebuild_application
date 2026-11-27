// M15 - automatic checks on a PO before it becomes an order, and matching of the PO to a docket
// and its lines to our quoted items. Pure functions (tests/po.test.ts).

import { companyTokens, normUnit, parseDate, parseMoney, parsePct } from './normalise';
import type { PoLineDraft } from './fields';

export type CheckLevel = 'block' | 'flag' | 'info';
export interface PoCheck {
  level: CheckLevel;
  code: 'DUPLICATE' | 'LINE_TOTAL' | 'BASIC_TOTAL' | 'GST' | 'GRAND_TOTAL' | 'DELIVERY' | 'RATE' | 'NOT_IN_OFFER' | 'HSN' | 'REQUIRED' | 'NO_LINES';
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
  /** The chosen docket (offer): lines with no matching quoted item are flagged "item not in offer". */
  offer?: { docketNo: string | null; items: number } | null;
}

export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "68 KG/NO", "0.52 KG/Mtr", "48 KG/SET" -> { kg: 68, per: 'NOS' }; "4.45" -> { kg: 4.45, per: null }. */
export function parseUnitWeight(v: string | null | undefined): { kg: number; per: string | null } | null {
  if (!v) return null;
  const m = String(v).match(/(\d+(?:\.\d+)?)\s*KGS?\s*(?:\/|PER)\s*([A-Z.]+)/i);
  if (m) return { kg: Number(m[1]), per: normUnit(m[2]) };
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return /^\s*\d+(\.\d+)?\s*(KGS?)?\s*$/i.test(String(v)) && n > 0 ? { kg: n, per: null } : null;
}

/** NOS / SETS / PCS count as the same "per piece" basis for a unit weight. */
const pieceUnit = (u: string | null | undefined) => ['NOS', 'SETS', 'EA', 'PCS'].includes((u ?? '').toUpperCase());
const sameBasis = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && (a.toUpperCase() === b.toUpperCase() || (pieceUnit(a) && pieceUnit(b)));

/**
 * Per-kg rate so rates in different units can be compared: per KG as is, per MT / 1000, per NOS / SET /
 * MTR divided by the unit weight (kg per that unit) when it is known.
 */
export function ratePerKg(rate: number | null | undefined, unit: string | null | undefined, wt?: { kg: number; per: string | null } | null): number | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  const u = (unit ?? '').toUpperCase();
  if (u === 'KG' || u === 'KGS') return rate;
  // Quotation sheets often store a per-kg price against an MT quantity (e.g. "101.24 MT @ 77").
  if (u === 'MT' || u === 'MTS' || u === 'TON' || u === 'TONS') return rate >= 1000 ? rate / 1000 : rate;
  if (wt && wt.kg > 0 && (wt.per === null || sameBasis(wt.per, u))) return rate / wt.kg;
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compare the PO rate with our quoted rate on the same basis. The quoted rate is per `quotedUom` (the
 * unit the offer priced in, e.g. Rs/kg for a line counted in NOS); the unit weight converts per-piece /
 * per-metre rates to per kg. null when the units cannot be compared.
 */
export function compareRate(
  line: Pick<PoLineDraft, 'unitRate' | 'unit' | 'quotedRate' | 'quotedUom' | 'quotedWtKg' | 'quotedWtPer'>,
): { diffPct: number; basis: string; poPerKg?: number; quotedPerKg?: number } | null {
  if (line.unitRate === null || line.quotedRate === null || line.quotedRate === undefined || line.quotedRate <= 0) return null;
  const qUnit = line.quotedUom ?? line.unit;
  // Per MT is often a per-kg price against an MT quantity (77 "per MT"), so MT always goes via per kg.
  const isMt = (u: string | null | undefined) => ['MT', 'MTS', 'TON', 'TONS'].includes((u ?? '').toUpperCase());
  if (sameBasis(line.unit, qUnit) && !isMt(line.unit)) {
    return { diffPct: r1(((line.unitRate - line.quotedRate) / line.quotedRate) * 100), basis: `per ${line.unit ?? 'unit'}` };
  }
  const wt = line.quotedWtKg ? { kg: line.quotedWtKg, per: line.quotedWtPer ?? null } : null;
  const a = ratePerKg(line.unitRate, line.unit, wt);
  const b = ratePerKg(line.quotedRate, qUnit, wt);
  if (a !== null && b !== null && b > 0) {
    const isKg = (u: string | null | undefined) => ['KG', 'KGS'].includes((u ?? '').toUpperCase());
    const converted = !isKg(line.unit) || !isKg(qUnit);
    if (converted && wt) return { diffPct: r1(((a - b) / b) * 100), basis: `per kg (unit wt ${wt.kg} kg/${wt.per ?? 'unit'})`, poPerKg: r2(a), quotedPerKg: r2(b) };
    return { diffPct: r1(((a - b) / b) * 100), basis: 'per kg' };
  }
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
      const per = (u: string | null | undefined) => (u ? `/${u}` : '');
      const kg = cmp.poPerKg !== undefined && cmp.quotedPerKg !== undefined && cmp.basis.startsWith('per kg (') ? ` = ${cmp.poPerKg} vs ${cmp.quotedPerKg} per kg` : '';
      const msg = `Line ${i + 1}: PO rate ${l.unitRate}${per(l.unit)} vs our quoted ${l.quotedRate}${per(l.quotedUom)}${kg} (${cmp.diffPct > 0 ? '+' : ''}${cmp.diffPct}% ${cmp.basis}).`;
      out.push({ level: cmp.diffPct < -0.5 ? 'flag' : 'info', code: 'RATE', target: `line:${i}`, message: cmp.diffPct < -0.5 ? `${msg} PO rate is below our quote.` : msg });
    } else if (l.quotedRate !== null && l.quotedRate !== undefined && l.unitRate !== null) {
      out.push({ level: 'flag', code: 'RATE', target: `line:${i}`, message: `Line ${i + 1}: PO rate ${l.unitRate}/${l.unit ?? '?'} cannot be compared with our quoted ${l.quotedRate}/${l.quotedUom ?? '?'} (no unit weight on the offer item). Check it by hand.` });
    }
    if (input.offer && input.offer.items > 0 && (l.quotedItemId === null || l.quotedItemId === undefined) && l.description.trim()) {
      out.push({ level: 'flag', code: 'NOT_IN_OFFER', target: `line:${i}`, message: `Line ${i + 1}: item not in offer${input.offer.docketNo ? ` ${input.offer.docketNo}` : ''} ("${l.description.slice(0, 60)}").` });
    }
    if (!l.hsn && l.description.trim()) {
      out.push({ level: 'flag', code: 'HSN', target: `line:${i}`, message: `Line ${i + 1}: HSN missing – not on the PO and not found in the item master. Enter it.` });
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

// Typos are forgiven in words, never in sizes: "25X6MM" is not "35X6MM".
const tokenEq = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && !/\d/.test(a + b) && editDistance(a, b, 2) <= 2);

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
  /** Delivery location of the offer ("Rangia, Assam", "Rohtas & Kaimur, Bihar"). */
  site?: string | null;
  /** uom = unit the quantity is in; qtnUom = unit the price is per (iteam-table.uom_of_qtn); wt = unit weight text ("68 KG/NO"). */
  items: { id: number; name: string | null; uom: string | null; qty: string | null; price: string | null; qtnUom?: string | null; wt?: string | null }[];
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
  /** SAME_PARTY = an offer to this customer (shown first, latest revision pre-selected); OTHER = other parties. */
  group: 'SAME_PARTY' | 'OTHER';
  /** Same party AND (same utility or matching items): the offer this PO most likely answers. */
  relevant: boolean;
  /** PO lines whose rate equals this offer's quoted rate (within RATE_EXACT_PCT), of the PO lines with a rate. */
  rateExact?: number;
  rateLines?: number;
  /** The PO names the same place (town / district) as this offer's delivery location. */
  siteHit?: string | null;
}

/** A PO rate within this % of our quoted rate counts as "the same rate" (rounding on the PO). */
export const RATE_EXACT_PCT = 0.5;

/**
 * Dockets loaded in bulk on 26-08-2026 (CEE-000278 ... 000517) carry the load date, not the offer
 * date: a docket date before this is unknown, never "made after the PO".
 */
export const DOCKET_DATES_FROM = '2026-09-01';

/** PO lines with a rate, and how many of them equal the rate quoted in this offer. */
export function rateHits(lines: PoLineDraft[], items: DocketCandidate['items']): { exact: number; lines: number } {
  const withRate = lines.filter((l) => l.unitRate !== null && l.unitRate !== undefined && l.unitRate > 0);
  if (!withRate.length || !items.length) return { exact: 0, lines: withRate.length };
  let exact = 0;
  for (const l of matchQuotedItems(withRate, items)) {
    const c = compareRate(l);
    if (c && Math.abs(c.diffPct) <= RATE_EXACT_PCT) exact++;
  }
  return { exact, lines: withRate.length };
}

/** Strong enough to name the offer on its own: 2+ lines and 30 %+ of the PO lines at exactly the quoted rate. */
export const rateMatchStrong = (d: Pick<DocketMatch, 'rateExact' | 'rateLines'>) => (d.rateExact ?? 0) >= 2 && (d.rateExact ?? 0) / Math.max(1, d.rateLines ?? 0) >= 0.3;

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

/** CEE-000419 -> 419 (newer offers / revisions have higher numbers). */
export const docketSeq = (no: string | null | undefined) => Number(String(no ?? '').match(/(\d+)(?!.*\d)/)?.[1] ?? 0);

/**
 * Rank the dockets (offers) this PO most likely answers. The customer's own offers come first
 * (group SAME_PARTY); among them the relevant ones (same utility or items) by LATEST revision
 * (highest docket no.) - the final revised offer, not the one with the most item hits. Other
 * parties follow (group OTHER) by score.
 */
export function rankDockets(
  po: { customer: string | null; endClient: string | null; project: string | null; site?: string | null; lines: { description: string; qty: number | null; unit: string | null; unitRate?: number | null }[] },
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
    // The place: "RANGIA RDSS PROJECT" vs "Rangia, Bongaigaon, North Lakhimpur, Assam".
    const siteHit = placeHit(po.site, d.site);
    if (siteHit) {
      score += 12;
      reasons.push(`site ${siteHit}`);
    }
    if (d.hasBom) {
      score += 3;
      reasons.push('costed BOM on file');
    }
    // The surest sign: the PO's rates are exactly the rates we quoted in this offer.
    const hits = nameSim >= 0.5 ? rateHits(po.lines as PoLineDraft[], d.items) : { exact: 0, lines: 0 };
    if (hits.exact) {
      score += Math.min(30, hits.exact * 5);
      reasons.unshift(`rates match this offer on ${hits.exact} of ${hits.lines} lines`);
    }
    const group: DocketMatch['group'] = nameSim >= 0.5 ? 'SAME_PARTY' : 'OTHER';
    const strong = rateMatchStrong({ rateExact: hits.exact, rateLines: hits.lines });
    const relevant = group === 'SAME_PARTY' && (strong || reasons.some((r) => r.startsWith('utility')) || best > 0.3 || !target.length);
    return { id: d.id, docketNo: d.docketNo, party: d.party, utility: d.utility, score: Math.round(score * 10) / 10, reasons, hasBom: d.hasBom, orders: d.orders, group, relevant, rateExact: hits.exact, rateLines: hits.lines, siteHit };
  });
  const same = ranked
    .filter((r) => r.group === 'SAME_PARTY')
    .sort(
      (a, b) =>
        Number(rateMatchStrong(b)) - Number(rateMatchStrong(a)) ||
        (rateMatchStrong(a) && rateMatchStrong(b) ? (b.rateExact ?? 0) - (a.rateExact ?? 0) : 0) ||
        Number(b.relevant) - Number(a.relevant) ||
        docketSeq(b.docketNo) - docketSeq(a.docketNo) ||
        b.id - a.id,
    );
  if (same[0]?.relevant) same[0].reasons.unshift(same.filter((x) => x.relevant).length > 1 ? 'latest revision for this party' : 'offer to this party');
  const other = ranked.filter((r) => r.group === 'OTHER' && r.score >= 20).sort((a, b) => b.score - a.score || b.id - a.id);
  return [...same, ...other];
}

/** Item text for matching: "[Weight: 3 KG/NO]" dropped, OCR "Gl" read as "GI". */
export const itemText = (s: string) => s.replace(/\[\s*weight[^\]]*\]/gi, ' ').replace(/\bG[lL]\b/g, 'GI').replace(/\s+/g, ' ').trim();

/** Voltages named in a description ("11 kV", "33KV") - an 11 kV item never matches a 33 kV one. */
const voltages = (s: string) => new Set([...s.matchAll(/(\d+(?:\.\d+)?)\s*K\.?V\b/gi)].map((m) => Number(m[1])));

/** Best quoted item for each PO line (same docket), by description; used for the rate comparison. */
export function matchQuotedItems(lines: PoLineDraft[], items: DocketCandidate['items']): PoLineDraft[] {
  const named = items.filter((it) => it.name);
  return lines.map((l) => {
    let best: { it: DocketCandidate['items'][number]; s: number } | null = null;
    const desc = itemText(l.description);
    const vl = voltages(desc);
    for (const it of named) {
      const vi = voltages(it.name as string);
      if (vl.size && vi.size && ![...vl].some((v) => vi.has(v))) continue;
      const s = textSimilarity(desc, itemText(it.name as string)) + (named.length === 1 ? 0.3 : 0);
      if (!best || s > best.s) best = { it, s };
    }
    if (!best || best.s < 0.3) return { ...l, quotedRate: null, quotedItemId: null, quotedItemName: null, quotedUom: null, quotedWtKg: null, quotedWtPer: null };
    const price = parseMoney(best.it.price);
    const wt = parseUnitWeight(best.it.wt) ?? parseUnitWeight(best.it.name?.match(/\[\s*weight\s*:?\s*([^\]]+)\]/i)?.[1]);
    return {
      ...l,
      quotedRate: price,
      quotedItemId: best.it.id,
      quotedItemName: best.it.name,
      // The price is per the offer's price unit (uom_of_qtn), which may differ from the quantity unit.
      quotedUom: normUnit(best.it.qtnUom) ?? normUnit(best.it.uom),
      quotedWtKg: wt?.kg ?? null,
      quotedWtPer: wt?.per ?? normUnit(best.it.uom),
    };
  });
}

const itemPct = (d: DocketMatch) => Number(d.reasons.find((r) => r.startsWith('items match'))?.match(/\d+/)?.[0] ?? 0);

/**
 * The docket an order may be made with WITHOUT a person choosing (PO mails -> orders automatically).
 * Stricter than the review screen's pre-selection: same party, same utility when the PO names one,
 * and either the only such offer or the latest revision that also matches the items best (>= 50 %).
 * Otherwise null with the reason, and the PO waits for a person to choose.
 */
export function autoDocketPick(
  dockets: DocketMatch[],
  po: { endClient: string | null; project: string | null; poDate?: string | null },
  docketDates?: Map<number, string>,
): { pick: DocketMatch | null; why: string } {
  let c = dockets.filter((d) => d.group === 'SAME_PARTY' && d.relevant);
  if (!c.length) return { pick: null, why: 'no offer (docket) to this party matches' };
  // A known docket date (not the 26-08 bulk load) well after the PO date: not the offer it answers.
  const known = (id: number) => {
    const v = docketDates?.get(id);
    return v && v >= DOCKET_DATES_FROM ? v : null;
  };
  const limit = po.poDate ? new Date(new Date(`${po.poDate}T00:00:00Z`).getTime() + 7 * 86400_000).toISOString().slice(0, 10) : null;
  const inTime = (d: DocketMatch) => !limit || !known(d.id) || (known(d.id) as string) <= limit;
  // 1. Exact rates: the PO's rates are the rates of ONE offer (clearly more lines than any other).
  const util = utilityKey(po.endClient) || utilityKey(po.project);
  const byRate = c
    .filter((d) => rateMatchStrong(d) && inTime(d))
    .filter((d) => {
      const du = utilityKey(d.utility);
      return !util || !du || du === util || du.includes(util) || util.includes(du);
    })
    .sort((a, b) => (b.rateExact ?? 0) - (a.rateExact ?? 0));
  if (byRate.length && (byRate.length === 1 || (byRate[0].rateExact ?? 0) >= 2 * (byRate[1].rateExact ?? 0))) {
    return { pick: byRate[0], why: `PO rates = this offer's rates on ${byRate[0].rateExact} of ${byRate[0].rateLines} lines` };
  }
  // 1b. The one offer to this party for the same place (town / district named on the PO), in time.
  const bySite = c.filter((d) => d.siteHit && inTime(d));
  const sites = new Set(bySite.map((d) => d.siteHit));
  if (bySite.length && sites.size === 1) {
    const latest = [...bySite].sort((a, b) => docketSeq(b.docketNo) - docketSeq(a.docketNo))[0];
    if (bySite.length === 1) return { pick: latest, why: `the only offer to this party for ${latest.siteHit}` };
  }
  // 2. Otherwise by party / utility / items / latest revision.
  // An offer made well after the PO date cannot be what the PO answers (7 days' grace for late entry).
  if (limit && docketDates) {
    const dated = c.filter(inTime);
    if (!dated.length) return { pick: null, why: `the offers to this party were made after the PO date ${po.poDate}` };
    c = dated;
  }
  const dated = c;
  const hasTarget = !!(utilityKey(po.endClient) || utilityKey(po.project));
  if (hasTarget) {
    const util = c.filter((d) => d.reasons.some((r) => r.startsWith('utility')));
    if (!util.length) return { pick: null, why: 'no offer to this party for this utility / project' };
    c = util;
  }
  // A newer offer to the party with no utility filled may be the revision of the one picked: a person decides.
  const newerBlank = (p: DocketMatch) => dated.find((d) => !d.utility && docketSeq(d.docketNo) > docketSeq(p.docketNo));
  const done = (p: DocketMatch, why: string) => {
    const n = newerBlank(p);
    return n ? { pick: null, why: `${n.docketNo} (newer, no utility entered) may be the revised offer of ${p.docketNo} – choose one` } : { pick: p, why };
  };
  if (c.length === 1) return done(c[0], 'the only matching offer to this party');
  const best = Math.max(...c.map(itemPct));
  // The latest revision wins (Puja's rule) when it also matches the items (about) best.
  if (itemPct(c[0]) >= 50 && best - itemPct(c[0]) <= 5) return done(c[0], 'latest revision, best item match');
  return { pick: null, why: `${c.length} offers to this party match (${c.slice(0, 4).map((d) => d.docketNo).join(', ')}) – choose one` };
}

/** Words that name no particular place. */
const NOT_PLACE = new Set(['RDSS', 'PROJECT', 'PROJECTS', 'PKG', 'PACKAGE', 'AIIB', 'PHASE', 'DIST', 'DISTRICT', 'STORE', 'SITE', 'SUPPLY', 'WORKS', 'ROAD', 'NEAR', 'STATE', 'INDIA', 'LASER', 'POWER', 'INFRA', 'LIMITED', 'PVT', 'LTD', 'CIRCLE', 'DIVISION', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'PASCHIM', 'PURBA', 'UPPER', 'LOWER', 'ASSAM', 'BIHAR', 'HARYANA', 'BENGAL', 'UTTARAKHAND', 'UTTAR', 'PRADESH', 'MAHARASHTRA', 'JHARKHAND', 'HIMACHAL', 'ODISHA', 'APDCL', 'SBPDCL', 'NBPDCL', 'WBSEDCL', 'UPCL', 'DHBVN', 'DHBVNL', 'UHBVNL', 'HPSEBL', 'CESC', 'KESCO', 'TRANSMISSION', 'LINE', 'SUBSTATION', 'SCHEME', 'AGAINST', 'FENCING', 'SOLAR', 'KUSUM', 'MATERIAL', 'MATERIALS', 'STRUCTURE', 'STRUCTURES']);
const placeWords = (s: string | null | undefined) =>
  new Set(String(s ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 5 && !NOT_PLACE.has(w)));
/** A place word (town / district, 5+ letters) that both texts name, or null. */
export function placeHit(poText: string | null | undefined, docketSite: string | null | undefined): string | null {
  const a = placeWords(poText);
  if (!a.size) return null;
  for (const w of placeWords(docketSite)) if (a.has(w)) return w.charAt(0) + w.slice(1).toLowerCase();
  return null;
}
