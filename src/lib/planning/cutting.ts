// RM indent + cutting plan (A15 steps 2 and 3). Pure functions: no I/O, all lengths in whole mm.
//
// Rules (from the tracker, SBPDCL 100 MT order):
//  - Standard bar = stdBarMm (6000). Supply tolerance is +0 / +tolPlusMm only: never negative, so
//    plans are made on the ORDERED length exactly; the extra up to +tol is never counted on.
//  - MIXED: a high-volume mark gets its own custom bar = k x piece (+ kerf between cuts) + end
//    allowance, k as large as the section's max bar allows (ISMC 100x50: 6600 = 3 x 2200).
//    The rest of the pieces are nested on standard bars, first-fit decreasing.
//  - STANDARD: everything nested on standard bars (the "6 m only" comparison).
//  - Pieces longer than a standard bar's usable length are OVERLENGTH: one piece per bar.
//  - Buffer % adds ceil(bars x buffer%) bars per indent line.
//  - Re-plan on RM actually received: whole bars to exact multiples first, then best-fit decreasing;
//    what still cannot be cut is the shortfall -> supplementary indent (6 m FFD). Offcuts >= minOffcut
//    are listed for reuse.

export type Strategy = 'MIXED' | 'STANDARD';
/** STOCK is used on patterns only: store offcuts / full bars already in hand (nothing to order). */
export type LineType = 'CUSTOM' | 'STANDARD' | 'OVERLENGTH' | 'STOCK';

export interface CutSettings {
  stdBarMm: number;
  maxCustomMm: number;
  endAllowanceMm: number;
  kerfMm: number;
  tolPlusMm: number;
  bufferPct: number;
  minOffcutMm: number;
  customMinBars: number;
  /**
   * Rev 2 "length" rule (indent reference script). When > 0, a custom length is decided per piece
   * LENGTH of a section (all marks of that length together), and is used when that length needs
   * at least this many metres and at least 2 pieces fit on one bar; customMinBars is then not used,
   * and a custom length equal to the standard bar is still a custom (exact-multiple) line.
   * 0 / unset = the per-mark rule with customMinBars.
   */
  customMinMetres?: number;
}

/**
 * Store material deducted before ordering (Rev 3 "offcut / stock first").
 * forLengthMm set: the store cuts that piece length out of these bars (offcuts or full bars), so
 * the requirement of that length drops by nos x pieces-per-bar. Unset: the bars are nested first
 * with the 6 m pool pieces of the section (first fit, before any new bar).
 */
export interface StockLot {
  sectionKey: string;
  lengthMm: number;
  nos: number;
  forLengthMm?: number | null;
  /** e.g. "Satya 23-11-2026"; shown on the indent. */
  note?: string | null;
}

export interface StockUse extends StockLot {
  sectionLabel: string;
  /** Pieces cut from the store material. */
  pieces: number;
  /** Store bars/offcuts actually used. */
  barsUsed: number;
}

export interface SectionInfo {
  label: string;
  kgPerM: number;
  /** Longest bar the mill supplies for this section; null -> settings.maxCustomMm. */
  maxBarMm: number | null;
}

export interface PlanPiece {
  markNo: string;
  sectionKey: string;
  lengthMm: number;
  qty: number;
}

export interface IndentLine {
  sectionKey: string;
  sectionLabel: string;
  barLengthMm: number;
  lineType: LineType;
  forMark: string | null;
  piecesPerBar: number | null;
  bars: number;
  bufferBars: number;
  kgPerM: number;
  wtKg: number;
}

export interface Cut {
  markNo: string;
  lengthMm: number;
}

export interface BarPattern {
  sectionKey: string;
  sectionLabel: string;
  barLengthMm: number;
  lineType: LineType;
  cuts: Cut[];
  /** Identical bars cut this way. */
  count: number;
  /** Leftover after the cuts and the end allowance (mm). */
  offcutMm: number;
}

export interface SectionSummary {
  sectionKey: string;
  sectionLabel: string;
  bars: number;
  bufferBars: number;
  /** Weight of all bars incl. buffer (what is indented). */
  wtKg: number;
  /** Weight of the bars actually cut (excl. buffer). */
  barWtKg: number;
  /** Weight of the pieces. */
  netKg: number;
  scrapKg: number;
  yieldPct: number;
}

export interface PlanTotals {
  bars: number;
  bufferBars: number;
  wtKg: number;
  barWtKg: number;
  netKg: number;
  scrapKg: number;
  yieldPct: number;
}

export interface IndentPlan {
  strategy: Strategy;
  lines: IndentLine[];
  patterns: BarPattern[];
  sections: SectionSummary[];
  totals: PlanTotals;
  warnings: string[];
  /** Store material deducted (absent on plans made without stock). */
  stock?: StockUse[];
}

export interface PlanComparison {
  mixed: { sections: SectionSummary[]; totals: PlanTotals };
  standard: { sections: SectionSummary[]; totals: PlanTotals };
  /** STANDARD minus MIXED (positive = Mixed saves). */
  savingKg: number;
  savingBars: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const kg = (lengthMm: number, kgPerM: number) => (lengthMm / 1000) * kgPerM;

function assertSettings(s: CutSettings) {
  const ints: Exclude<keyof CutSettings, 'customMinMetres'>[] = ['stdBarMm', 'maxCustomMm', 'endAllowanceMm', 'kerfMm', 'tolPlusMm', 'minOffcutMm', 'customMinBars'];
  for (const k of ints) {
    if (!Number.isInteger(s[k]) || s[k] < 0) throw new Error(`Setting ${k} must be a whole number >= 0`);
  }
  if (s.stdBarMm <= s.endAllowanceMm) throw new Error('Standard bar must be longer than the end allowance');
  if (!(s.bufferPct >= 0)) throw new Error('Buffer % must be >= 0');
  if (s.customMinMetres !== undefined && !(s.customMinMetres >= 0)) throw new Error('Custom length min metres must be >= 0');
}

/** Same mark + section + length appearing on several rows -> one entry with the summed qty. */
export function mergePieces(pieces: PlanPiece[]): PlanPiece[] {
  const map = new Map<string, PlanPiece>();
  for (const p of pieces) {
    if (!Number.isInteger(p.lengthMm) || p.lengthMm <= 0) throw new Error(`Mark ${p.markNo}: length must be a whole number of mm > 0`);
    if (!Number.isInteger(p.qty) || p.qty < 0) throw new Error(`Mark ${p.markNo}: qty must be a whole number`);
    if (p.qty === 0) continue;
    const key = `${p.sectionKey}\u0000${p.markNo}\u0000${p.lengthMm}`;
    const cur = map.get(key);
    if (cur) cur.qty += p.qty;
    else map.set(key, { ...p });
  }
  return [...map.values()];
}

const bySection = <T extends { sectionKey: string }>(items: T[]) => {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const list = m.get(i.sectionKey) ?? [];
    list.push(i);
    m.set(i.sectionKey, list);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
};

/** Largest number of pieces of `length` on a bar with `usable` mm (kerf between cuts). */
export const piecesPerBar = (usable: number, length: number, kerf: number) => Math.max(0, Math.floor((usable + kerf) / (length + kerf)));
/** Material a set of cuts consumes: sum of lengths + kerf between them. */
const consumed = (lengths: number[], kerf: number) => (lengths.length ? lengths.reduce((a, b) => a + b, 0) + (lengths.length - 1) * kerf : 0);

interface OpenBar {
  barLengthMm: number;
  usable: number;
  cuts: Cut[];
  used: number; // consumed() of cuts
  /** Store bar / offcut (already in hand). */
  stock?: boolean;
}

const fits = (bar: OpenBar, len: number, kerf: number) => (bar.cuts.length ? bar.used + kerf + len : len) <= bar.usable;
const place = (bar: OpenBar, cut: Cut, kerf: number) => {
  bar.used = bar.cuts.length ? bar.used + kerf + cut.lengthMm : cut.lengthMm;
  bar.cuts.push(cut);
};

/**
 * First-fit decreasing on bars of one length. Identical pieces are handled as a run: first fit of
 * each identical piece in turn is the same as filling each bar (in order) as far as it goes.
 */
export function ffd(
  pieces: { markNo: string; lengthMm: number; qty: number }[],
  barLengthMm: number,
  endAllowanceMm: number,
  kerfMm: number,
  /** Store bars (lengths) opened before any new bar, so they are filled first. */
  stockBarsMm: number[] = [],
): OpenBar[] {
  const usable = barLengthMm - endAllowanceMm;
  const sorted = [...pieces].filter((p) => p.qty > 0).sort((a, b) => b.lengthMm - a.lengthMm || a.markNo.localeCompare(b.markNo));
  const bars: OpenBar[] = stockBarsMm.map((len) => ({ barLengthMm: len, usable: len - endAllowanceMm, cuts: [], used: 0, stock: true }));
  for (const p of sorted) {
    if (p.lengthMm > usable) throw new Error(`Piece ${p.markNo} (${p.lengthMm} mm) is longer than the bar's usable ${usable} mm`);
    let left = p.qty;
    for (const bar of bars) {
      while (left > 0 && fits(bar, p.lengthMm, kerfMm)) {
        place(bar, { markNo: p.markNo, lengthMm: p.lengthMm }, kerfMm);
        left--;
      }
      if (left === 0) break;
    }
    const per = piecesPerBar(usable, p.lengthMm, kerfMm);
    while (left > 0) {
      const bar: OpenBar = { barLengthMm, usable, cuts: [], used: 0 };
      for (let i = 0; i < per && left > 0; i++, left--) place(bar, { markNo: p.markNo, lengthMm: p.lengthMm }, kerfMm);
      bars.push(bar);
    }
  }
  return bars;
}

/** Identical bars (same length, same cut sequence) grouped into patterns. */
function toPatterns(bars: OpenBar[], sectionKey: string, sectionLabel: string, lineType: LineType): BarPattern[] {
  const map = new Map<string, BarPattern>();
  for (const b of bars) {
    const cuts = [...b.cuts].sort((x, y) => y.lengthMm - x.lengthMm || x.markNo.localeCompare(y.markNo));
    const key = `${b.barLengthMm}|${cuts.map((c) => `${c.markNo}:${c.lengthMm}`).join(',')}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { sectionKey, sectionLabel, barLengthMm: b.barLengthMm, lineType, cuts, count: 1, offcutMm: b.usable - b.used });
  }
  return [...map.values()];
}

const bufferOf = (bars: number, pct: number) => (pct > 0 && bars > 0 ? Math.ceil((bars * pct) / 100 - 1e-9) : 0);

function sectionInfo(sections: Record<string, SectionInfo>, key: string): SectionInfo {
  const s = sections[key];
  if (!s) throw new Error(`No kg/m for section ${key}`);
  if (!(s.kgPerM > 0)) throw new Error(`kg/m for section ${s.label || key} must be > 0`);
  return s;
}

/** Indent plan for one strategy. */
export function planIndent(
  input: PlanPiece[],
  sections: Record<string, SectionInfo>,
  settings: CutSettings,
  strategy: Strategy,
  stockIn: StockLot[] = [],
): IndentPlan {
  assertSettings(settings);
  const { stdBarMm, endAllowanceMm: allow, kerfMm: kerf } = settings;
  const stock = deductStock(mergePieces(input), stockIn, sections, settings);
  const pieces = stock.pieces;
  const stdUsable = stdBarMm - allow;
  const lines: IndentLine[] = [];
  const patterns: BarPattern[] = [];
  const sectionSummaries: SectionSummary[] = [];
  const warnings: string[] = [...stock.warnings];
  const lengthRule = (settings.customMinMetres ?? 0) > 0;

  for (const [key, list] of bySection(pieces)) {
    const info = sectionInfo(sections, key);
    const maxBar = info.maxBarMm ?? settings.maxCustomMm;
    const pool: PlanPiece[] = [];
    const overlength: PlanPiece[] = [];
    const sectionLines: IndentLine[] = [];
    let netKg = list.reduce((a, p) => a + kg(p.lengthMm, info.kgPerM) * p.qty, 0);

    const sortedMarks = [...list].sort((a, b) => b.lengthMm - a.lengthMm || a.markNo.localeCompare(b.markNo));
    if (strategy === 'MIXED' && lengthRule) {
      // Rev 2 length rule: all marks of one length share the custom bars.
      const byLength = new Map<number, PlanPiece[]>();
      for (const p of sortedMarks) byLength.set(p.lengthMm, [...(byLength.get(p.lengthMm) ?? []), p]);
      for (const [len, marks] of byLength) {
        const qty = marks.reduce((a, p) => a + p.qty, 0);
        const k = piecesPerBar(maxBar - allow, len, kerf);
        const customLen = k * len + (k - 1) * kerf + allow;
        const fullBars = k > 0 ? Math.floor(qty / k) : 0;
        if (len > stdUsable || k < 2 || fullBars < 1 || (len * qty) / 1000 < settings.customMinMetres!) {
          for (const p of marks) (len > stdUsable ? overlength : pool).push(p);
          continue;
        }
        // Pieces in mark order; the first fullBars x k go on custom bars, the balance to the pool.
        const bars: OpenBar[] = [];
        let bar: OpenBar | null = null;
        const rest = new Map<string, number>();
        let placed = 0;
        for (const p of marks) {
          for (let i = 0; i < p.qty; i++) {
            if (placed >= fullBars * k) {
              rest.set(p.markNo, (rest.get(p.markNo) ?? 0) + 1);
              continue;
            }
            if (!bar || bar.cuts.length === k) bars.push((bar = { barLengthMm: customLen, usable: customLen - allow, cuts: [], used: 0 }));
            place(bar, { markNo: p.markNo, lengthMm: len }, kerf);
            placed++;
          }
        }
        for (const p of marks) if (rest.get(p.markNo)) pool.push({ ...p, qty: rest.get(p.markNo)! });
        const markNos = marks.map((m) => m.markNo);
        sectionLines.push({
          sectionKey: key,
          sectionLabel: info.label,
          barLengthMm: customLen,
          lineType: 'CUSTOM',
          forMark: markNos.length > 3 ? `${markNos.slice(0, 3).join(', ')} +${markNos.length - 3}` : markNos.join(', '),
          piecesPerBar: k,
          bars: fullBars,
          bufferBars: 0,
          kgPerM: info.kgPerM,
          wtKg: 0,
        });
        patterns.push(...toPatterns(bars, key, info.label, 'CUSTOM'));
      }
    }
    for (const p of strategy === 'MIXED' && lengthRule ? [] : sortedMarks) {
      if (strategy === 'MIXED') {
        const k = Math.min(p.qty, piecesPerBar(maxBar - allow, p.lengthMm, kerf));
        const customLen = k * p.lengthMm + (k - 1) * kerf + allow;
        const fullBars = k > 0 ? Math.floor(p.qty / k) : 0;
        if (k >= 1 && fullBars >= settings.customMinBars && customLen !== stdBarMm && customLen <= maxBar) {
          sectionLines.push({
            sectionKey: key,
            sectionLabel: info.label,
            barLengthMm: customLen,
            lineType: 'CUSTOM',
            forMark: p.markNo,
            piecesPerBar: k,
            bars: fullBars,
            bufferBars: 0,
            kgPerM: info.kgPerM,
            wtKg: 0,
          });
          patterns.push({
            sectionKey: key,
            sectionLabel: info.label,
            barLengthMm: customLen,
            lineType: 'CUSTOM',
            cuts: Array.from({ length: k }, () => ({ markNo: p.markNo, lengthMm: p.lengthMm })),
            count: fullBars,
            offcutMm: 0,
          });
          const rest = p.qty - fullBars * k;
          if (rest > 0) (p.lengthMm > stdUsable ? overlength : pool).push({ ...p, qty: rest });
          continue;
        }
      }
      (p.lengthMm > stdUsable ? overlength : pool).push(p);
    }

    const nestStock = stock.uses.filter((s) => s.sectionKey === key && !s.forLengthMm);
    if (pool.length) {
      const stockBars = nestStock.flatMap((s) => Array.from({ length: s.nos }, () => s.lengthMm));
      const all = ffd(pool, stdBarMm, allow, kerf, stockBars);
      const bars = all.filter((b) => !b.stock);
      // Store bars that took pieces: count them per lot (lots are opened in order) and take their pieces off the net.
      let i = 0;
      for (const s of nestStock) {
        for (let n = 0; n < s.nos; n++, i++) {
          const b = all[i];
          if (!b.cuts.length) continue;
          s.barsUsed++;
          s.pieces += b.cuts.length;
          netKg -= kg(b.cuts.reduce((a, c) => a + c.lengthMm, 0), info.kgPerM);
        }
      }
      patterns.push(...toPatterns(all.filter((b) => b.stock && b.cuts.length), key, info.label, 'STOCK'));
      if (bars.length) sectionLines.push({
        sectionKey: key,
        sectionLabel: info.label,
        barLengthMm: stdBarMm,
        lineType: 'STANDARD',
        forMark: null,
        piecesPerBar: null,
        bars: bars.length,
        bufferBars: 0,
        kgPerM: info.kgPerM,
        wtKg: 0,
      });
      patterns.push(...toPatterns(bars, key, info.label, 'STANDARD'));
    }

    for (const p of overlength) {
      const barLen = p.lengthMm + allow;
      if (barLen > maxBar) warnings.push(`Mark ${p.markNo} (${info.label}, ${p.lengthMm} mm) needs a ${barLen} mm bar, longer than the ${maxBar} mm the mill supplies: special order or joint needed.`);
      else warnings.push(`Mark ${p.markNo} (${info.label}, ${p.lengthMm} mm) is longer than a standard bar: ordered as ${barLen} mm bars, one piece each.`);
      sectionLines.push({
        sectionKey: key,
        sectionLabel: info.label,
        barLengthMm: barLen,
        lineType: 'OVERLENGTH',
        forMark: p.markNo,
        piecesPerBar: 1,
        bars: p.qty,
        bufferBars: 0,
        kgPerM: info.kgPerM,
        wtKg: 0,
      });
      patterns.push({ sectionKey: key, sectionLabel: info.label, barLengthMm: barLen, lineType: 'OVERLENGTH', cuts: [{ markNo: p.markNo, lengthMm: p.lengthMm }], count: p.qty, offcutMm: 0 });
    }

    let barWt = 0;
    for (const l of sectionLines) {
      l.bufferBars = bufferOf(l.bars, settings.bufferPct);
      l.wtKg = r3(kg(l.barLengthMm, info.kgPerM) * (l.bars + l.bufferBars));
      barWt += kg(l.barLengthMm, info.kgPerM) * l.bars;
    }
    lines.push(...sectionLines);
    sectionSummaries.push({
      sectionKey: key,
      sectionLabel: info.label,
      bars: sectionLines.reduce((a, l) => a + l.bars, 0),
      bufferBars: sectionLines.reduce((a, l) => a + l.bufferBars, 0),
      wtKg: r3(sectionLines.reduce((a, l) => a + l.wtKg, 0)),
      barWtKg: r3(barWt),
      netKg: r3(netKg),
      scrapKg: r3(barWt - netKg),
      yieldPct: barWt > 0 ? r1((netKg / barWt) * 100) : 0,
    });
  }

  for (const s of stock.uses) {
    if (!s.forLengthMm && s.barsUsed === 0) warnings.push(`Store ${s.sectionLabel} ${s.nos} × ${s.lengthMm} mm: no piece nested on it, not used.`);
  }
  const plan: IndentPlan = { strategy, lines, patterns: sortPatterns(patterns), sections: sectionSummaries, totals: sumTotals(sectionSummaries), warnings };
  if (stockIn.length) plan.stock = stock.uses;
  return plan;
}

/**
 * Store material for a given piece length comes off the requirement first (marks of that length
 * in mark order). Lots for nesting are only validated here; planIndent nests them.
 */
function deductStock(pieces: PlanPiece[], lots: StockLot[], sections: Record<string, SectionInfo>, settings: CutSettings) {
  const warnings: string[] = [];
  const uses: StockUse[] = [];
  const left = pieces.map((p) => ({ ...p }));
  for (const lot of lots) {
    if (!Number.isInteger(lot.lengthMm) || lot.lengthMm <= 0 || !Number.isInteger(lot.nos) || lot.nos <= 0) {
      throw new Error(`Store stock ${lot.sectionKey}: length and nos must be whole numbers > 0`);
    }
    const label = sections[lot.sectionKey]?.label ?? lot.sectionKey;
    const use: StockUse = { ...lot, sectionLabel: label, pieces: 0, barsUsed: 0 };
    uses.push(use);
    if (!lot.forLengthMm) continue;
    const marks = left.filter((p) => p.sectionKey === lot.sectionKey && p.lengthMm === lot.forLengthMm && p.qty > 0).sort((a, b) => a.markNo.localeCompare(b.markNo));
    const per = piecesPerBar(lot.lengthMm - settings.endAllowanceMm, lot.forLengthMm, settings.kerfMm);
    const need = marks.reduce((a, p) => a + p.qty, 0);
    if (per < 1 || need === 0) {
      warnings.push(`Store ${label} ${lot.nos} × ${lot.lengthMm} mm: ${per < 1 ? `too short for ${lot.forLengthMm} mm pieces` : `no ${lot.forLengthMm} mm piece left to cut`}, not used.`);
      continue;
    }
    let take = Math.min(need, per * lot.nos);
    use.pieces = take;
    use.barsUsed = Math.ceil(take / per);
    for (const p of marks) {
      const n = Math.min(p.qty, take);
      p.qty -= n;
      take -= n;
    }
  }
  return { pieces: left.filter((p) => p.qty > 0), uses, warnings };
}

function sortPatterns(p: BarPattern[]) {
  const order: Record<LineType, number> = { STOCK: 0, CUSTOM: 1, STANDARD: 2, OVERLENGTH: 3 };
  return p.sort(
    (a, b) => a.sectionKey.localeCompare(b.sectionKey) || order[a.lineType] - order[b.lineType] || b.count - a.count || b.barLengthMm - a.barLengthMm,
  );
}

function sumTotals(sections: SectionSummary[]): PlanTotals {
  const t = sections.reduce(
    (a, s) => ({ bars: a.bars + s.bars, bufferBars: a.bufferBars + s.bufferBars, wtKg: a.wtKg + s.wtKg, barWtKg: a.barWtKg + s.barWtKg, netKg: a.netKg + s.netKg }),
    { bars: 0, bufferBars: 0, wtKg: 0, barWtKg: 0, netKg: 0 },
  );
  return {
    bars: t.bars,
    bufferBars: t.bufferBars,
    wtKg: r3(t.wtKg),
    barWtKg: r3(t.barWtKg),
    netKg: r3(t.netKg),
    scrapKg: r3(t.barWtKg - t.netKg),
    yieldPct: t.barWtKg > 0 ? r1((t.netKg / t.barWtKg) * 100) : 0,
  };
}

/** Both strategies, the chosen one in full plus the Mixed vs 6 m-only comparison. */
export function planWithComparison(pieces: PlanPiece[], sections: Record<string, SectionInfo>, settings: CutSettings, strategy: Strategy) {
  const mixed = planIndent(pieces, sections, settings, 'MIXED');
  const standard = planIndent(pieces, sections, settings, 'STANDARD');
  const comparison: PlanComparison = {
    mixed: { sections: mixed.sections, totals: mixed.totals },
    standard: { sections: standard.sections, totals: standard.totals },
    savingKg: r3(standard.totals.wtKg - mixed.totals.wtKg),
    savingBars: standard.totals.bars + standard.totals.bufferBars - (mixed.totals.bars + mixed.totals.bufferBars),
  };
  return { plan: strategy === 'MIXED' ? mixed : standard, comparison };
}

// ---------------------------------------------------------------------------
// Re-plan on RM actually received
// ---------------------------------------------------------------------------

export interface ReceivedLot {
  sectionKey: string;
  /** Measured (actual) length of the bars in the lot. */
  lengthMm: number;
  nos: number;
}

export interface ReplanPattern extends BarPattern {
  /** EXACT: whole bar cut to an exact multiple of one mark. BEST_FIT: mixed/remaining pieces. */
  source: 'EXACT' | 'BEST_FIT';
}

export interface MarkBalance {
  sectionKey: string;
  sectionLabel: string;
  markNo: string;
  lengthMm: number;
  required: number;
  planned: number;
  short: number;
}

export interface Offcut {
  sectionKey: string;
  sectionLabel: string;
  lengthMm: number;
  count: number;
}

export interface ReplanResult {
  patterns: ReplanPattern[];
  marks: MarkBalance[];
  offcuts: Offcut[];
  /** Received bars no piece was planned on. */
  unusedBars: { sectionKey: string; sectionLabel: string; lengthMm: number; count: number }[];
  /** Sections with pieces to cut but no bars received / no kg/m. */
  piecesPlanned: number;
  piecesShort: number;
  /** Standard-bar plan for the shortfall (null when nothing is short). */
  supplementary: IndentPlan | null;
  warnings: string[];
}

/**
 * Plan the pieces on the bars actually received.
 * Step 1 (exact): a bar is an exact multiple for a mark when, after the most pieces of that mark it
 * holds, the leftover beyond the end allowance is <= tolPlusMm (custom bars were ordered as
 * k x piece + allowance, delivered +0/+tol). Whole bars only, longest marks first.
 * Step 2 (best fit decreasing): remaining pieces, longest first, each on the bar where it leaves the
 * smallest leftover (started bars and fresh bars of every received length).
 */
export function replan(lots: ReceivedLot[], input: PlanPiece[], sections: Record<string, SectionInfo>, settings: CutSettings): ReplanResult {
  assertSettings(settings);
  const pieces = mergePieces(input);
  const { endAllowanceMm: allow, kerfMm: kerf, tolPlusMm: tol, minOffcutMm } = settings;
  const patterns: ReplanPattern[] = [];
  const marks: MarkBalance[] = [];
  const offcutMap = new Map<string, Offcut>();
  const unusedBars: ReplanResult['unusedBars'] = [];
  const warnings: string[] = [];
  const shortPieces: PlanPiece[] = [];

  const lotsBySection = new Map<string, Map<number, number>>();
  for (const l of lots) {
    if (!Number.isInteger(l.lengthMm) || l.lengthMm <= 0 || !Number.isInteger(l.nos) || l.nos <= 0) throw new Error('Lot length and nos must be whole numbers > 0');
    const m = lotsBySection.get(l.sectionKey) ?? new Map<number, number>();
    m.set(l.lengthMm, (m.get(l.lengthMm) ?? 0) + l.nos);
    lotsBySection.set(l.sectionKey, m);
  }

  const sectionKeys = [...new Set([...pieces.map((p) => p.sectionKey), ...lotsBySection.keys()])].sort();
  for (const key of sectionKeys) {
    const info = sections[key];
    const label = info?.label ?? key;
    const list = pieces.filter((p) => p.sectionKey === key).sort((a, b) => b.lengthMm - a.lengthMm || a.markNo.localeCompare(b.markNo));
    // Fresh (uncut) bars: length -> count, longest first.
    const fresh = new Map([...(lotsBySection.get(key) ?? new Map<number, number>()).entries()].sort((a, b) => b[0] - a[0]));
    const left = new Map(list.map((p) => [p.markNo + '\u0000' + p.lengthMm, p.qty]));
    const planned = new Map<string, number>();
    const addPlanned = (p: PlanPiece, n: number) => planned.set(p.markNo + '\u0000' + p.lengthMm, (planned.get(p.markNo + '\u0000' + p.lengthMm) ?? 0) + n);

    if (list.length && fresh.size === 0) warnings.push(`No RM received yet for ${label}.`);

    // Step 1: whole bars to exact multiples.
    for (const p of list) {
      const id = p.markNo + '\u0000' + p.lengthMm;
      for (const [len, count] of fresh) {
        let need = left.get(id) ?? 0;
        if (need <= 0 || count <= 0) continue;
        const usable = len - allow;
        const k = piecesPerBar(usable, p.lengthMm, kerf);
        if (k < 1) continue;
        const leftover = usable - (k * p.lengthMm + (k - 1) * kerf);
        if (leftover > tol) continue;
        const n = Math.min(count, Math.floor(need / k));
        if (n <= 0) continue;
        fresh.set(len, count - n);
        need -= n * k;
        left.set(id, need);
        addPlanned(p, n * k);
        patterns.push({
          sectionKey: key,
          sectionLabel: label,
          barLengthMm: len,
          lineType: 'CUSTOM',
          cuts: Array.from({ length: k }, () => ({ markNo: p.markNo, lengthMm: p.lengthMm })),
          count: n,
          offcutMm: leftover,
          source: 'EXACT',
        });
      }
    }

    // Step 2: best-fit decreasing over started bars + fresh bars.
    const started: OpenBar[] = [];
    for (const p of list) {
      const id = p.markNo + '\u0000' + p.lengthMm;
      let need = left.get(id) ?? 0;
      while (need > 0) {
        // Tightest started bar that still takes the piece.
        let best: OpenBar | null = null;
        let bestLeft = Infinity;
        for (const b of started) {
          if (!fits(b, p.lengthMm, kerf)) continue;
          const after = b.usable - (b.used + kerf + p.lengthMm);
          if (after < bestLeft) {
            bestLeft = after;
            best = b;
          }
        }
        // Tightest fresh length (a fresh bar holding just this piece).
        let bestFresh: number | null = null;
        for (const [len, count] of fresh) {
          if (count <= 0 || len - allow < p.lengthMm) continue;
          const after = len - allow - p.lengthMm;
          if (after < bestLeft) {
            bestLeft = after;
            bestFresh = len;
          }
        }
        if (bestFresh !== null) {
          fresh.set(bestFresh, fresh.get(bestFresh)! - 1);
          best = { barLengthMm: bestFresh, usable: bestFresh - allow, cuts: [], used: 0 };
          started.push(best);
        }
        if (!best) break;
        // Identical pieces keep going to the same bar while it fits (still the tightest).
        while (need > 0 && fits(best, p.lengthMm, kerf)) {
          place(best, { markNo: p.markNo, lengthMm: p.lengthMm }, kerf);
          need--;
          addPlanned(p, 1);
        }
      }
      left.set(id, need);
    }
    for (const pat of toPatterns(started, key, label, 'STANDARD')) patterns.push({ ...pat, source: 'BEST_FIT' });

    // Offcuts (exact bars + best-fit bars) and unused fresh bars.
    const allPatterns = patterns.filter((x) => x.sectionKey === key);
    for (const pat of allPatterns) {
      if (pat.offcutMm >= minOffcutMm && pat.offcutMm > 0) {
        const ok = `${key}|${pat.offcutMm}`;
        const cur = offcutMap.get(ok);
        if (cur) cur.count += pat.count;
        else offcutMap.set(ok, { sectionKey: key, sectionLabel: label, lengthMm: pat.offcutMm, count: pat.count });
      }
    }
    for (const [len, count] of fresh) if (count > 0) unusedBars.push({ sectionKey: key, sectionLabel: label, lengthMm: len, count });

    for (const p of list) {
      const id = p.markNo + '\u0000' + p.lengthMm;
      const got = planned.get(id) ?? 0;
      const short = p.qty - got;
      marks.push({ sectionKey: key, sectionLabel: label, markNo: p.markNo, lengthMm: p.lengthMm, required: p.qty, planned: got, short });
      if (short > 0) shortPieces.push({ ...p, qty: short });
    }
  }

  let supplementary: IndentPlan | null = null;
  if (shortPieces.length) {
    const missing = [...new Set(shortPieces.map((p) => p.sectionKey))].filter((k) => !(sections[k]?.kgPerM > 0));
    if (missing.length) warnings.push(`No kg/m for ${missing.join(', ')}: supplementary indent cannot be weighed.`);
    else supplementary = planIndent(shortPieces, sections, settings, 'STANDARD');
  }

  const offcuts = [...offcutMap.values()].sort((a, b) => a.sectionKey.localeCompare(b.sectionKey) || b.lengthMm - a.lengthMm);
  return {
    patterns,
    marks,
    offcuts,
    unusedBars,
    piecesPlanned: marks.reduce((a, m) => a + m.planned, 0),
    piecesShort: marks.reduce((a, m) => a + m.short, 0),
    supplementary,
    warnings,
  };
}

/** "6600 ×3: 2200+2200+2200 | offcut 0" */
export function describePattern(p: BarPattern): string {
  const runs: string[] = [];
  let i = 0;
  while (i < p.cuts.length) {
    let j = i;
    while (j < p.cuts.length && p.cuts[j].markNo === p.cuts[i].markNo && p.cuts[j].lengthMm === p.cuts[i].lengthMm) j++;
    const n = j - i;
    runs.push(n > 1 ? `${n}×${p.cuts[i].lengthMm} (${p.cuts[i].markNo})` : `${p.cuts[i].lengthMm} (${p.cuts[i].markNo})`);
    i = j;
  }
  return `${p.barLengthMm} mm ×${p.count}: ${runs.join(' + ')} | offcut ${p.offcutMm}`;
}
