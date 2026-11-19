import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describePattern,
  ffd,
  planIndent,
  planWithComparison,
  replan,
  type CutSettings,
  type IndentPlan,
  type PlanPiece,
  type SectionInfo,
} from '../src/lib/planning/cutting';

const S: CutSettings = {
  stdBarMm: 6000,
  maxCustomMm: 6000,
  endAllowanceMm: 0,
  kerfMm: 0,
  tolPlusMm: 20,
  bufferPct: 0,
  minOffcutMm: 300,
  customMinBars: 5,
};
const SEC: Record<string, SectionInfo> = {
  ISA50: { label: 'ISA 50x50x6', kgPerM: 4.5, maxBarMm: null },
  ISMC: { label: 'ISMC 100x50', kgPerM: 9.56, maxBarMm: 6600 },
  ISA75: { label: 'ISA 75x75x6', kgPerM: 6.8, maxBarMm: null },
};
const pc = (markNo: string, sectionKey: string, lengthMm: number, qty: number): PlanPiece => ({ markNo, sectionKey, lengthMm, qty });

/** Every piece is cut exactly once and no bar is overfilled. */
function assertConsistent(plan: IndentPlan, pieces: PlanPiece[], s: CutSettings) {
  const cut = new Map<string, number>();
  for (const p of plan.patterns) {
    const used = p.cuts.reduce((a, c) => a + c.lengthMm, 0) + Math.max(0, p.cuts.length - 1) * s.kerfMm;
    assert.ok(used + s.endAllowanceMm <= p.barLengthMm, `bar ${p.barLengthMm} overfilled: ${used}`);
    assert.equal(p.offcutMm, p.barLengthMm - s.endAllowanceMm - used, 'offcut = usable - used');
    for (const c of p.cuts) cut.set(c.markNo, (cut.get(c.markNo) ?? 0) + p.count);
  }
  const want = new Map<string, number>();
  for (const p of pieces) want.set(p.markNo, (want.get(p.markNo) ?? 0) + p.qty);
  assert.deepEqual([...cut.entries()].sort(), [...want.entries()].sort());
  // Bars in lines match bars in patterns.
  assert.equal(plan.lines.reduce((a, l) => a + l.bars, 0), plan.patterns.reduce((a, p) => a + p.count, 0));
}

test('ISMC 100x50: 2200 mm pieces go 3 per 6600 mm custom bar (B1, 150 pcs -> 50 bars)', () => {
  const pieces = [pc('B1', 'ISMC', 2200, 150)];
  const plan = planIndent(pieces, SEC, S, 'MIXED');
  assert.equal(plan.lines.length, 1);
  assert.deepEqual(
    { len: plan.lines[0].barLengthMm, type: plan.lines[0].lineType, k: plan.lines[0].piecesPerBar, bars: plan.lines[0].bars },
    { len: 6600, type: 'CUSTOM', k: 3, bars: 50 },
  );
  assert.equal(plan.lines[0].wtKg, 3154.8); // 50 x 6.6 m x 9.56
  assert.equal(plan.totals.yieldPct, 100);
  assertConsistent(plan, pieces, S);
  assert.equal(describePattern(plan.patterns[0]), '6600 mm ×50: 3×2200 (B1) | offcut 0');
});

test('exact multiple below 6 m: 1450 mm x4 = 5800 custom bar (A1, 400 pcs -> 100 bars)', () => {
  const plan = planIndent([pc('A1', 'ISA50', 1450, 400)], SEC, S, 'MIXED');
  assert.equal(plan.lines[0].barLengthMm, 5800);
  assert.equal(plan.lines[0].bars, 100);
  assert.equal(plan.lines[0].wtKg, 2610); // 100 x 5.8 x 4.5
  const std = planIndent([pc('A1', 'ISA50', 1450, 400)], SEC, S, 'STANDARD');
  assert.equal(std.lines[0].barLengthMm, 6000);
  assert.equal(std.lines[0].bars, 100);
  assert.equal(std.lines[0].wtKg, 2700);
  assert.equal(std.patterns[0].offcutMm, 200);
});

test('custom length equal to the standard bar is a STANDARD line', () => {
  const plan = planIndent([pc('X', 'ISA50', 3000, 40)], SEC, S, 'MIXED');
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].lineType, 'STANDARD');
  assert.equal(plan.lines[0].bars, 20);
});

test('end allowance is added to the custom bar and can reduce k', () => {
  const s = { ...S, endAllowanceMm: 20 };
  const plan = planIndent([pc('B1', 'ISMC', 2200, 150)], SEC, s, 'MIXED');
  // 3 x 2200 + 20 = 6620 > 6600 -> k = 2, bar = 4420
  assert.equal(plan.lines[0].piecesPerBar, 2);
  assert.equal(plan.lines[0].barLengthMm, 4420);
  assert.equal(plan.lines[0].bars, 75);
  assertConsistent(plan, [pc('B1', 'ISMC', 2200, 150)], s);
});

test('kerf is consumed between cuts, not after the last one', () => {
  const s = { ...S, kerfMm: 5 };
  // 4 x 1495 + 3 x 5 = 5995 fits 6000; 1500 would need 6015.
  const bars = ffd([{ markNo: 'K', lengthMm: 1495, qty: 8 }], 6000, 0, 5);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].used, 5995);
  const bars2 = ffd([{ markNo: 'K', lengthMm: 1500, qty: 8 }], 6000, 0, 5);
  assert.equal(bars2.length, 3);
  const plan = planIndent([pc('K', 'ISA50', 1495, 40)], SEC, s, 'MIXED');
  assert.equal(plan.lines[0].barLengthMm, 5995);
  assertConsistent(plan, [pc('K', 'ISA50', 1495, 40)], s);
});

test('remainder of a custom mark goes to the 6 m pool and is nested with others', () => {
  const pieces = [pc('A2', 'ISA50', 2200, 121), pc('A9', 'ISA50', 1500, 3)];
  const plan = planIndent(pieces, SEC, S, 'MIXED');
  const custom = plan.lines.find((l) => l.lineType === 'CUSTOM')!;
  assert.equal(custom.barLengthMm, 4400); // 2 x 2200 (3 x 2200 = 6600 > 6000)
  assert.equal(custom.bars, 60);
  const std = plan.lines.find((l) => l.lineType === 'STANDARD')!;
  assert.equal(std.bars, 2); // 2200 + 1500 + 1500 = 5200; the third 1500 needs a second bar
  assertConsistent(plan, pieces, S);
});

test('low-volume marks are not given custom lengths (customMinBars)', () => {
  const plan = planIndent([pc('B2', 'ISMC', 3100, 12)], SEC, S, 'MIXED');
  // k = 2 (6200 <= 6600), 6 bars >= 5 -> custom 6200
  assert.equal(plan.lines[0].lineType, 'CUSTOM');
  const plan2 = planIndent([pc('B2', 'ISMC', 3100, 8)], SEC, S, 'MIXED');
  assert.equal(plan2.lines[0].lineType, 'STANDARD');
  assert.equal(plan2.lines[0].bars, 8); // one 3100 per 6 m bar
});

test('overlength pieces get one bar each and a warning', () => {
  const plan = planIndent([pc('C2', 'ISA75', 6400, 4)], SEC, S, 'STANDARD');
  assert.equal(plan.lines[0].lineType, 'OVERLENGTH');
  assert.equal(plan.lines[0].barLengthMm, 6400);
  assert.equal(plan.lines[0].bars, 4);
  assert.match(plan.warnings[0], /special order or joint/);
});

test('buffer rounds up per line', () => {
  const plan = planIndent([pc('B1', 'ISMC', 2200, 150)], SEC, { ...S, bufferPct: 2 }, 'MIXED');
  assert.equal(plan.lines[0].bufferBars, 1); // ceil(50 x 2%) = 1
  assert.equal(plan.totals.bufferBars, 1);
  assert.equal(plan.lines[0].wtKg, 3217.896); // 51 bars
  const p2 = planIndent([pc('B1', 'ISMC', 2200, 150)], SEC, { ...S, bufferPct: 4 }, 'MIXED');
  assert.equal(p2.lines[0].bufferBars, 2);
});

test('FFD: mixed lengths, no bar overfilled, every piece placed once', () => {
  const pieces = [pc('A', 'ISA50', 2875, 7), pc('B', 'ISA50', 1980, 13), pc('C', 'ISA50', 760, 29), pc('D', 'ISA50', 350, 61), pc('E', 'ISA50', 5990, 2)];
  for (const s of [S, { ...S, kerfMm: 3, endAllowanceMm: 10 }]) {
    const plan = planIndent(pieces, SEC, s, 'STANDARD');
    assertConsistent(plan, pieces, s);
    const lower = Math.ceil(pieces.reduce((a, p) => a + p.lengthMm * p.qty, 0) / (6000 - s.endAllowanceMm));
    assert.ok(plan.totals.bars >= lower);
  }
});

test('Mixed vs 6 m-only comparison: Mixed never needs more steel on the sample order', () => {
  const pieces = [pc('A1', 'ISA50', 1450, 400), pc('A2', 'ISA50', 2200, 120), pc('B1', 'ISMC', 2200, 150), pc('B2', 'ISMC', 3100, 12)];
  const { plan, comparison } = planWithComparison(pieces, SEC, S, 'MIXED');
  assert.equal(plan.strategy, 'MIXED');
  assert.ok(comparison.mixed.totals.wtKg <= comparison.standard.totals.wtKg);
  assert.equal(comparison.savingKg, Math.round((comparison.standard.totals.wtKg - comparison.mixed.totals.wtKg) * 1000) / 1000);
  assert.ok(comparison.mixed.totals.yieldPct >= comparison.standard.totals.yieldPct);
  assert.equal(comparison.mixed.sections.length, 2);
});

test('missing kg/m and bad input are rejected', () => {
  assert.throws(() => planIndent([pc('Z', 'NOPE', 1000, 1)], SEC, S, 'MIXED'), /No kg\/m/);
  assert.throws(() => planIndent([pc('Z', 'ISA50', 1000.5, 1)], SEC, S, 'MIXED'), /whole number/);
  assert.throws(() => planIndent([pc('Z', 'ISA50', 1000, 1.5)], SEC, S, 'MIXED'), /whole number/);
});

test('duplicate rows of the same mark are merged', () => {
  const plan = planIndent([pc('A1', 'ISA50', 1450, 200), pc('A1', 'ISA50', 1450, 200)], SEC, S, 'MIXED');
  assert.equal(plan.lines[0].bars, 100);
});

// ---------------------------------------------------------------- re-plan

test('re-plan: exact multiples first (6600 bars -> 3 x 2200), then best fit', () => {
  const pieces = [pc('B1', 'ISMC', 2200, 150), pc('B2', 'ISMC', 3100, 2)];
  const r = replan([{ sectionKey: 'ISMC', lengthMm: 6610, nos: 50 }, { sectionKey: 'ISMC', lengthMm: 6000, nos: 2 }], pieces, SEC, S);
  const exact = r.patterns.filter((p) => p.source === 'EXACT');
  assert.equal(exact.length, 1);
  assert.equal(exact[0].count, 50);
  assert.equal(exact[0].offcutMm, 10); // +10 mm delivered over 6600 is within +20 tolerance
  const b2 = r.marks.find((m) => m.markNo === 'B2')!;
  assert.equal(b2.planned, 2);
  assert.equal(r.piecesShort, 0);
  assert.equal(r.supplementary, null);
  // 2 x 3100 on 6000 bars: one per bar (6200 > 6000) -> offcut 2900 each
  assert.deepEqual(r.offcuts, [{ sectionKey: 'ISMC', sectionLabel: 'ISMC 100x50', lengthMm: 2900, count: 2 }]);
});

test('re-plan: a short lot (rejected upstream) leaves a shortfall -> supplementary indent on 6 m bars', () => {
  const pieces = [pc('A1', 'ISA50', 1450, 400)];
  const r = replan([{ sectionKey: 'ISA50', lengthMm: 5800, nos: 90 }], pieces, SEC, S);
  assert.equal(r.marks[0].planned, 360);
  assert.equal(r.marks[0].short, 40);
  assert.ok(r.supplementary);
  assert.equal(r.supplementary!.lines[0].barLengthMm, 6000);
  assert.equal(r.supplementary!.lines[0].bars, 10);
});

test('re-plan: best fit picks the tightest bar and offcuts below the threshold are not listed', () => {
  const pieces = [pc('X', 'ISA50', 2500, 1), pc('Y', 'ISA50', 1000, 1)];
  const r = replan(
    [
      { sectionKey: 'ISA50', lengthMm: 6000, nos: 1 },
      { sectionKey: 'ISA50', lengthMm: 2700, nos: 1 },
    ],
    pieces,
    SEC,
    S,
  );
  // X 2500 -> 2700 bar (leftover 200, not listed); Y 1000 -> 6000 bar (leftover 5000).
  const xBar = r.patterns.find((p) => p.cuts.some((c) => c.markNo === 'X'))!;
  assert.equal(xBar.barLengthMm, 2700);
  assert.deepEqual(r.offcuts.map((o) => o.lengthMm), [5000]);
  assert.equal(r.piecesShort, 0);
});

test('re-plan: lot below the exact tolerance is not used as exact but still best-fit', () => {
  // 6625 leaves 25 mm over 3 x 2200 -> not "exact" (tol 20) but best fit still puts 3 on it.
  const r = replan([{ sectionKey: 'ISMC', lengthMm: 6625, nos: 1 }], [pc('B1', 'ISMC', 2200, 3)], SEC, S);
  assert.equal(r.patterns[0].source, 'BEST_FIT');
  assert.equal(r.patterns[0].cuts.length, 3);
});

test('re-plan: section with no RM received warns and is all short; unused bars are listed', () => {
  const r = replan([{ sectionKey: 'ISA75', lengthMm: 6000, nos: 3 }], [pc('A1', 'ISA50', 1450, 4)], SEC, S);
  assert.match(r.warnings.join(' '), /No RM received yet for ISA 50x50x6/);
  assert.equal(r.piecesShort, 4);
  assert.deepEqual(r.unusedBars, [{ sectionKey: 'ISA75', sectionLabel: 'ISA 75x75x6', lengthMm: 6000, count: 3 }]);
});
