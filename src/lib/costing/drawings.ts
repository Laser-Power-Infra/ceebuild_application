// Approved-drawing search and BOM-line clean-up. Pure.

import { sectionKey, toNum } from '@/lib/bom/parse';

export type MatchLevel = 'UTILITY_ITEM' | 'STATE_ITEM' | 'ANY_ITEM';
export const MATCH_LABELS: Record<MatchLevel, string> = {
  UTILITY_ITEM: 'Same utility and item',
  STATE_ITEM: 'Same state and item',
  ANY_ITEM: 'Reference only – confirm',
};

export interface DrawingCandidate {
  id: number;
  utility: string;
  state: string | null;
  itemType: string;
  status: string;
  approvalDate: string | null;
}

const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Utility names are typed many ways ("SBPDCL", "South Bihar ... (SBPDCL)"): match on the bracketed code too. */
export function utilityKeys(u: string | null | undefined): string[] {
  const s = String(u ?? '');
  const keys = new Set<string>();
  if (norm(s)) keys.add(norm(s));
  for (const m of s.matchAll(/\(([^)]+)\)/g)) if (norm(m[1])) keys.add(norm(m[1]));
  return [...keys];
}

const sameUtility = (a: string | null, b: string | null) => {
  const ka = utilityKeys(a);
  const kb = new Set(utilityKeys(b));
  return ka.some((k) => kb.has(k));
};

/**
 * Approved drawings for an item, best first. Search order (M14): same utility + item type, then
 * same state + item type (docket state or delivery state), then any approved drawing of the item
 * type ("reference only - confirm"). Superseded drawings are never offered. Newest approval first
 * within a level.
 */
export function rankDrawings<T extends DrawingCandidate>(
  drawings: T[],
  want: { itemType: string | null; utility: string | null; states: (string | null)[] },
): { drawing: T; level: MatchLevel }[] {
  const type = norm(want.itemType);
  if (!type) return [];
  const states = new Set(want.states.map(norm).filter(Boolean));
  const out: { drawing: T; level: MatchLevel; rank: number }[] = [];
  for (const d of drawings) {
    if (d.status !== 'APPROVED' || norm(d.itemType) !== type) continue;
    const level: MatchLevel = want.utility && sameUtility(d.utility, want.utility) ? 'UTILITY_ITEM' : d.state && states.has(norm(d.state)) ? 'STATE_ITEM' : 'ANY_ITEM';
    out.push({ drawing: d, level, rank: level === 'UTILITY_ITEM' ? 0 : level === 'STATE_ITEM' ? 1 : 2 });
  }
  return out
    .sort((a, b) => a.rank - b.rank || String(b.drawing.approvalDate ?? '').localeCompare(String(a.drawing.approvalDate ?? '')) || b.drawing.id - a.drawing.id)
    .map(({ drawing, level }) => ({ drawing, level }));
}

export interface BomLineDraft {
  markNo: string | null;
  description: string | null;
  section: string | null;
  sectionKey: string | null;
  lengthMm: number | null;
  qtyPerSet: number | null;
  kgPerM: number | null;
  unitWtKg: number | null;
  category: 'STRUCTURE' | 'NUTS_BOLTS' | 'BOUGHT_OUT';
  rateKey: string | null;
  /** Supplied but not billed (BOM column "Billable / Non-Billable"). */
  nonBillable?: boolean;
}

const NB_RE = /\b(nut|bolt|washer|n\s*&\s*b|hex\s*bolt|m\d{2}\s*x)/i;
const BOUGHT_RE = /\b(danger\s*(board|plate)|stay\s*set|eye\s*bolt|insulator|clamp\s*set|name\s*plate|number\s*plate|anti[-\s]*climb|barbed\s*wire|bird\s*guard)\b/i;
const NB_SIZE_RE = /\bM\s*(\d{1,2})(\s*[xX×]\s*(\d{2,3}))?/;

const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' || s.toLowerCase() === 'null' ? null : s.slice(0, 200);
};
const num = (v: unknown) => {
  const n = toNum(typeof v === 'string' ? v.replace(/[^\d.,-]/g, '') : v);
  return n !== null && n >= 0 ? n : null;
};

/** Nuts & bolts size key from a description/section: "M16 x 40 bolt" -> "M16X40", "Hex nut M20" -> "M20". */
export function nbSize(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = String(t ?? '').toUpperCase().match(NB_SIZE_RE);
    if (m) return m[3] ? `M${m[1]}X${m[3]}` : `M${m[1]}`;
  }
  return null;
}

/** Category from the text: nuts/bolts/washers -> NUTS_BOLTS, known bought-out items -> BOUGHT_OUT, else STRUCTURE. */
export function guessCategory(description: string | null, section: string | null): BomLineDraft['category'] {
  // A piece cut from a steel section is fabricated, whatever it is for ("clamp for danger board",
  // "eye hook/bolt" from 16 dia rod).
  if (/^(ISMC|ISA|FLAT|RB)\d/.test(sectionKey(section) ?? '')) return 'STRUCTURE';
  const t = `${description ?? ''} ${section ?? ''}`;
  if (NB_RE.test(t)) return 'NUTS_BOLTS';
  if (BOUGHT_RE.test(t)) return 'BOUGHT_OUT';
  return 'STRUCTURE';
}

/**
 * Raw rows (from the AI or a spreadsheet) -> clean BOM line drafts. Length is taken as mm unless
 * `lengthInMetres`, or the value is clearly metres (< 30 with a decimal). Rows with neither a
 * section nor a description are dropped; so are TOTAL rows.
 */
export function cleanLines(rows: Record<string, unknown>[], opts: { lengthInMetres?: boolean } = {}): BomLineDraft[] {
  const out: BomLineDraft[] = [];
  for (const r of rows) {
    const g = (...keys: string[]) => {
      for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
      return undefined;
    };
    const markNo = text(g('markNo', 'mark', 'mark_no', 'Mark No'));
    const description = text(g('description', 'desc', 'item', 'Description'));
    const section = text(g('section', 'size', 'Section'));
    if (!section && !description) continue;
    if (/^(grand|sub)?\s*-?\s*totals?\b/i.test(description ?? section ?? '')) continue;
    let lengthMm = num(g('lengthMm', 'length_mm', 'length', 'Length'));
    const lengthM = num(g('lengthM', 'length_m'));
    if (lengthMm === null && lengthM !== null) lengthMm = lengthM * 1000;
    else if (lengthMm !== null && (opts.lengthInMetres || (lengthMm < 30 && !Number.isInteger(lengthMm)))) lengthMm = lengthMm * 1000;
    const category = (['STRUCTURE', 'NUTS_BOLTS', 'BOUGHT_OUT'] as const).includes(r.category as never)
      ? (r.category as BomLineDraft['category'])
      : guessCategory(description, section);
    const rateKey = category === 'NUTS_BOLTS' ? nbSize(section, description) : category === 'BOUGHT_OUT' ? text(description ?? section)?.toUpperCase() ?? null : null;
    out.push({
      markNo,
      description,
      section,
      sectionKey: category === 'STRUCTURE' ? sectionKey(section) : null,
      lengthMm: lengthMm === null ? null : Math.round(lengthMm),
      qtyPerSet: num(g('qtyPerSet', 'qty_per_set', 'qty', 'Qty')),
      kgPerM: num(g('kgPerM', 'kg_per_m', 'kgm')),
      unitWtKg: num(g('unitWtKg', 'unit_wt_kg', 'unitWt')),
      category,
      rateKey,
      nonBillable: r.nonBillable === true || r.nonBillable === 'true' || /^non/i.test(String(r.billable ?? '')),
    });
  }
  return out.slice(0, 2000);
}

/** JSON array out of an AI reply (plain, fenced, or wrapped in {"lines": [...]}). */
export function parseAiLines(reply: string): Record<string, unknown>[] {
  let t = reply.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  try {
    const v = JSON.parse(t);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.lines) ? v.lines : Array.isArray(v?.pieces) ? v.pieces : [];
    return arr.filter((x: unknown) => x && typeof x === 'object');
  } catch {
    return [];
  }
}
