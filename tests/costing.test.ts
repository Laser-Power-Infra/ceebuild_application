import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCosting, pickRate, setsFromItem, wastageFromPlan, type CostInput, type RateRow } from '../src/lib/costing/calc';
import { cleanLines, nbSize, parseAiLines, rankDrawings, guessCategory } from '../src/lib/costing/drawings';

let nextId = 1;
const rate = (kind: string, value: number, unit: string, subject = 'DEFAULT', effectiveFrom = '2026-01-01'): RateRow => ({ id: nextId++, kind, subject, value, unit, effectiveFrom });

const baseRates = (): RateRow[] => [
  rate('RM_RATE', 55, 'Rs/kg', 'ISMC100X50'),
  rate('FAB_RATE', 6, 'Rs/kg', 'PLAIN_CUT'),
  rate('GALV_RATE', 20, 'Rs/kg black'),
  rate('ZINC_PCT', 5, '%'),
  rate('GALV_TRANSPORT', 1, 'Rs/kg'),
  rate('FREIGHT_MT', 2000, 'Rs/MT', 'BIHAR'),
  rate('INTEREST_PCT', 0, '%'),
  rate('CREDIT_DAYS', 0, 'days'),
  rate('LC_BG_PCT', 0, '%'),
  rate('MIN_VA_PCT', 10, '%'),
  rate('NB_RATE', 110, 'Rs/kg', 'M16X40'),
  rate('BOUGHT_OUT', 250, 'Rs/no', 'DANGER BOARD'),
];

const input = (over: Partial<CostInput> = {}): CostInput => ({
  lines: [
    { rowNo: 1, markNo: 'A1', description: 'Cross arm', section: 'ISMC 100x50', sectionKey: 'ISMC100X50', lengthMm: 2000, qtyPerSet: 2, kgPerM: null, unitWtKg: null, category: 'STRUCTURE', scope: 'IN_SCOPE', nonBillable: false, rateKey: null },
  ],
  sets: 10,
  fabType: 'PLAIN_CUT',
  galvanised: true,
  billingBasis: 'BLACK',
  destState: 'Bihar',
  vaPct: null,
  quoteDate: '2026-11-21',
  sectionKgm: { ISMC100X50: 9.56 },
  purchaseItems: { ISMC100X50: 'ISMC 100x50' },
  planWastagePct: { ISMC100X50: 4 },
  rates: baseRates(),
  ...over,
});

test('pickRate: latest effective on the date, exact subject before DEFAULT', () => {
  const rs = [rate('RM_RATE', 50, 'Rs/kg', 'ISA50', '2026-01-01'), rate('RM_RATE', 60, 'Rs/kg', 'ISA50', '2026-06-01'), rate('RM_RATE', 40, 'Rs/kg', 'DEFAULT', '2026-01-01')];
  assert.equal(pickRate(rs, 'RM_RATE', 'isa50', '2026-05-31')?.value, 50);
  assert.equal(pickRate(rs, 'RM_RATE', 'ISA50', '2026-06-01')?.value, 60);
  assert.equal(pickRate(rs, 'RM_RATE', 'ISA65', '2026-06-01')?.value, 40);
  assert.equal(pickRate(rs, 'RM_RATE', 'ISA65', '2026-06-01', false), null);
  assert.equal(pickRate(rs, 'RM_RATE', 'ISA50', '2025-12-31', false), null);
});

test('structure line: weights, RM with cutting-plan wastage, fab, galv, freight, VA', () => {
  const r = computeCosting(input());
  const l = r.lines[0];
  assert.equal(l.status, 'COSTED');
  // black = 2 x 2.0 m x 9.56 = 38.24 kg; galv = 40.152
  assert.equal(l.blackWtKg, 38.24);
  assert.equal(l.galvWtKg, 40.152);
  assert.equal(l.wastageSource, 'CUTTING_PLAN');
  assert.equal(l.rm, Math.round(38.24 * 55 * 1.04 * 100) / 100);
  assert.equal(l.fab, Math.round(38.24 * 6 * 100) / 100);
  assert.equal(l.galv, Math.round((38.24 * 20 + 38.24 * 1) * 100) / 100);
  assert.equal(l.freight, Math.round((40.152 / 1000) * 2000 * 100) / 100);
  const cost = 38.24 * 55 * 1.04 + 38.24 * 6 + 38.24 * 21 + (40.152 / 1000) * 2000;
  assert.ok(Math.abs(l.cost - cost) < 0.01);
  assert.equal(r.vaPct, 10); // minimum VA used when none given
  assert.ok(Math.abs(l.sell - cost * 1.1) < 0.02);
  assert.equal(r.structure.blackWtKg, 382.4);
  assert.ok(Math.abs(r.structure.sellPerKg - (cost * 1.1) / 38.24) < 0.01);
  assert.equal(r.checks.ok, true);
});

test('master wastage override beats the cutting plan', () => {
  const r = computeCosting(input({ rates: [...baseRates(), rate('WASTAGE_PCT', 7, '%', 'ISMC100X50')] }));
  assert.equal(r.lines[0].wastagePct, 7);
  assert.equal(r.lines[0].wastageSource, 'MASTER');
});

test('only purchase-scope lines are costed; N&B and bought-out kept separate', () => {
  const r = computeCosting(
    input({
      lines: [
        ...input().lines,
        { rowNo: 2, markNo: 'B1', description: 'Brace', section: 'ISMC 100x50', sectionKey: 'ISMC100X50', lengthMm: 1000, qtyPerSet: 1, kgPerM: null, unitWtKg: null, category: 'STRUCTURE', scope: 'CLIENT_SUPPLY', nonBillable: false, rateKey: null },
        { rowNo: 3, markNo: null, description: 'Hex bolt M16x40', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 8, kgPerM: null, unitWtKg: 0.12, category: 'NUTS_BOLTS', scope: 'IN_SCOPE', nonBillable: false, rateKey: 'M16X40' },
        { rowNo: 4, markNo: null, description: 'Danger board', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 1, kgPerM: null, unitWtKg: null, category: 'BOUGHT_OUT', scope: 'BOUGHT_OUT', nonBillable: false, rateKey: 'Danger board' },
        { rowNo: 5, markNo: 'C1', description: 'Spare', section: 'ISMC 100x50', sectionKey: 'ISMC100X50', lengthMm: 500, qtyPerSet: 1, kgPerM: null, unitWtKg: null, category: 'STRUCTURE', scope: 'IN_SCOPE', nonBillable: true, rateKey: null },
      ],
    }),
  );
  assert.equal(r.lines[1].status, 'EXCLUDED');
  assert.equal(r.lines[2].status, 'COSTED');
  assert.equal(r.lines[2].rm, Math.round(8 * 0.12 * 110 * 100) / 100);
  assert.equal(r.lines[3].rm, 250);
  assert.equal(r.lines[4].status, 'EXCLUDED');
  assert.deepEqual(r.checks.nonBillable, ['row 5 (mark C1)']);
  // Structure weight/price excludes N&B and bought-out.
  assert.equal(r.perSet.blackWtKg, 38.24);
  assert.ok(r.nutsBolts.sell > 0 && r.boughtOut.sell > 0);
  assert.equal(r.grandSell, Math.round((r.structure.sell + r.nutsBolts.sell + r.boughtOut.sell) * 100) / 100);
});

test('section outside the purchase list is flagged, not costed; blank rate blocks apply', () => {
  const r = computeCosting(
    input({
      lines: [
        ...input().lines,
        { rowNo: 2, markNo: 'X', description: null, section: 'ISA 65x65x6', sectionKey: 'ISA65X65X6', lengthMm: 1000, qtyPerSet: 1, kgPerM: 5.8, unitWtKg: null, category: 'STRUCTURE', scope: 'IN_SCOPE', nonBillable: false, rateKey: null },
      ],
    }),
  );
  assert.equal(r.lines[1].status, 'FLAGGED');
  assert.equal(r.checks.outsidePurchaseList.length, 1);
  assert.equal(r.checks.ok, false);

  const noRate = computeCosting(input({ rates: baseRates().filter((x) => x.kind !== 'RM_RATE') }));
  assert.equal(noRate.lines[0].status, 'FLAGGED');
  assert.equal(noRate.checks.blankLines.length, 1);
  assert.equal(noRate.checks.ok, false);
});

test('below minimum VA and variance vs last quote are flagged', () => {
  const r = computeCosting(input({ vaPct: 5, lastPricePerKg: { value: 80, ref: 'CEE-000500' } }));
  assert.equal(r.checks.belowMinVa, true);
  assert.notEqual(r.checks.variancePct, null);
  assert.ok(r.checks.messages.some((m) => m.includes('CEE-000500')));
});

test('galvanised billing basis gives the per-kg price on galvanised weight', () => {
  const black = computeCosting(input({ billingBasis: 'BLACK' }));
  const galv = computeCosting(input({ billingBasis: 'GALV' }));
  assert.ok(galv.structure.sellPerKg < black.structure.sellPerKg);
  assert.equal(galv.structure.billedWtKg, galv.structure.galvWtKg);
});

test('commercial: interest on credit days and LC/BG', () => {
  const rs = baseRates().filter((x) => !['INTEREST_PCT', 'CREDIT_DAYS', 'LC_BG_PCT'].includes(x.kind));
  rs.push(rate('INTEREST_PCT', 12, '%'), rate('CREDIT_DAYS', 73, 'days'), rate('LC_BG_PCT', 1, '%'));
  const r = computeCosting(input({ rates: rs }));
  const l = r.lines[0];
  const base = l.rm + l.fab + l.galv + l.freight + l.inspPack;
  assert.ok(Math.abs(l.commercial - base * (0.12 * 0.2 + 0.01)) < 0.02);
});

test('setsFromItem: KG/MT quantity divides by set weight; NOS/SET is the count', () => {
  assert.deepEqual(setsFromItem(100000, 'KG', 40), { sets: 2500, basis: 'WEIGHT' });
  assert.deepEqual(setsFromItem(100, 'MT', 40), { sets: 2500, basis: 'WEIGHT' });
  assert.deepEqual(setsFromItem(25, 'Nos', 40), { sets: 25, basis: 'SETS' });
  assert.equal(setsFromItem(null, 'KG', 40).sets, 0);
});

test('wastageFromPlan', () => {
  assert.deepEqual(wastageFromPlan([{ sectionKey: 'A', netKg: 100, scrapKg: 5 }]), { A: 5 });
});

test('rankDrawings: utility+item, then state+item, then any (reference only); superseded skipped', () => {
  const ds = [
    { id: 1, utility: 'NBPDCL', state: 'Bihar', itemType: 'V Cross Arm', status: 'APPROVED', approvalDate: '2025-01-01' },
    { id: 2, utility: 'MSEDCL', state: 'Maharashtra', itemType: 'V Cross Arm', status: 'APPROVED', approvalDate: '2025-05-01' },
    { id: 3, utility: 'SBPDCL', state: 'Bihar', itemType: 'v cross-arm', status: 'APPROVED', approvalDate: '2025-07-28' },
    { id: 4, utility: 'SBPDCL', state: 'Bihar', itemType: 'V Cross Arm', status: 'SUPERSEDED', approvalDate: '2024-01-01' },
    { id: 5, utility: 'SBPDCL', state: 'Bihar', itemType: 'Top Clamp', status: 'APPROVED', approvalDate: '2025-07-28' },
  ];
  const r = rankDrawings(ds, { itemType: 'V CROSS ARM', utility: 'South Bihar Power Distribution Company Limited (SBPDCL)', states: ['Telangana', 'Bihar'] });
  assert.deepEqual(r.map((x) => [x.drawing.id, x.level]), [[3, 'UTILITY_ITEM'], [1, 'STATE_ITEM'], [2, 'ANY_ITEM']]);
});

test('cleanLines / nbSize / guessCategory / parseAiLines', () => {
  assert.equal(nbSize('Hex bolt M16 x 40 with nut'), 'M16X40');
  assert.equal(nbSize('Nut M20'), 'M20');
  assert.equal(guessCategory('Danger Board', null), 'BOUGHT_OUT');
  assert.equal(guessCategory('Hex Bolt', 'M16x40'), 'NUTS_BOLTS');
  const lines = cleanLines([
    { markNo: 'A1', section: 'ISMC 75 x 40', length: 1.2, qty: 2 },
    { description: 'Hex bolt M16x40', qty: 8, unitWtKg: '0.12 kg' },
    { description: 'TOTAL', qty: 10 },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].lengthMm, 1200);
  assert.equal(lines[0].sectionKey, 'ISMC75X40');
  assert.equal(lines[1].category, 'NUTS_BOLTS');
  assert.equal(lines[1].rateKey, 'M16X40');
  assert.equal(lines[1].unitWtKg, 0.12);
  assert.equal(parseAiLines('Here:\n```json\n{"lines":[{"markNo":"1"}]}\n```').length, 1);
  assert.equal(parseAiLines('not json').length, 0);
});
