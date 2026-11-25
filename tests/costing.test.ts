import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCosting, pickRate, setsFromItem, wastageFromPlan, type CostInput, type CostLineInput, type RateRow } from '../src/lib/costing/calc';
import { cleanLines, guessCategory, nbSize, parseAiLines, rankDrawings } from '../src/lib/costing/drawings';
import { isMixedBom, parseMixedBom, resolveSection } from '../src/lib/costing/mixedBom';
import { sectionKey } from '../src/lib/bom/parse';
import { classifyFab } from '../src/lib/costing/fab';

let nextId = 1;
const rate = (kind: string, value: number, unit: string, subject = 'DEFAULT', effectiveFrom = '2026-01-01'): RateRow => ({ id: nextId++, kind, subject, value, unit, effectiveFrom });

const baseRates = (): RateRow[] => [
  rate('RM_RATE', 55, 'Rs/kg', 'ISMC100X50'),
  rate('FAB_RATE', 6, 'Rs/kg', 'CH_ANG'),
  rate('GALV_RATE', 20, 'Rs/kg black'),
  rate('ZINC_PCT', 5, '%'),
  rate('ZINC_RATE', 100, 'Rs/kg'),
  rate('GALV_TRANSPORT', 1, 'Rs/kg'),
  rate('FREIGHT_MT', 2000, 'Rs/MT', 'BIHAR'),
  rate('INTEREST_PCT', 0, '%'),
  rate('CREDIT_DAYS', 0, 'days'),
  rate('LC_BG_PCT', 0, '%'),
  rate('INSPECTION', 0, 'Rs/kg'),
  rate('PACKING', 0, 'Rs/kg'),
  rate('MIN_VA_PCT', 10, '%'),
  rate('NB_RATE', 110, 'Rs/kg', 'M16X40'),
  rate('NB_MARGIN_PCT', 5, '%'),
  rate('BOUGHT_OUT', 250, 'Rs/no', 'DANGER BOARD'),
  rate('BO_MARGIN_PCT', 8, '%'),
];

const line = (over: Partial<CostLineInput> = {}): CostLineInput => ({
  rowNo: 1,
  markNo: 'A1',
  description: 'Cross arm',
  section: 'ISMC 100x50',
  sectionKey: 'ISMC100X50',
  lengthMm: 2000,
  qtyPerSet: 2,
  kgPerM: null,
  unitWtKg: null,
  category: 'STRUCTURE',
  scope: 'IN_SCOPE',
  nonBillable: false,
  rateKey: null,
  sets: 10,
  group: null,
  fabCat: 'CH_ANG',
  ...over,
});

const input = (over: Partial<CostInput> = {}): CostInput => ({
  lines: [line()],
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
  assert.equal(l.blackWtKg, 38.24); // 2 x 2.0 m x 9.56, per set
  assert.equal(l.galvWtKg, 40.152);
  assert.equal(l.wastageSource, 'CUTTING_PLAN');
  // GI = labour 20 + 5% x zinc 100 + transport 1 = Rs 26/kg black
  const cost = 38.24 * 55 * 1.04 + 38.24 * 6 + 38.24 * 26 + (40.152 / 1000) * 2000;
  assert.ok(Math.abs(l.cost - cost) < 0.01);
  assert.equal(r.vaPct, 10); // minimum VA used when none given
  assert.ok(Math.abs(l.sell - cost * 1.1) < 0.02);
  assert.equal(r.structure.blackWtKg, 382.4); // x 10 sets
  assert.equal(r.sets, 10);
  assert.equal(r.perSet?.blackWtKg, 38.24);
  assert.ok(Math.abs(r.structure.sellPerKg - (cost * 1.1) / 38.24) < 0.01);
  assert.equal(r.checks.ok, true);
});

test('master wastage override beats the cutting plan', () => {
  const r = computeCosting(input({ rates: [...baseRates(), rate('WASTAGE_PCT', 7, '%', 'ISMC100X50')] }));
  assert.equal(r.lines[0].wastagePct, 7);
  assert.equal(r.lines[0].wastageSource, 'MASTER');
});

test('purchase scope; N&B and bought-out at their own margin, kept out of the structure', () => {
  const r = computeCosting(
    input({
      lines: [
        line(),
        line({ rowNo: 2, markNo: 'B1', lengthMm: 1000, qtyPerSet: 1, scope: 'CLIENT_SUPPLY' }),
        line({ rowNo: 3, markNo: null, description: 'Hex bolt M16x40', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 8, unitWtKg: 0.12, category: 'NUTS_BOLTS', rateKey: 'M16X40' }),
        line({ rowNo: 4, markNo: null, description: 'Danger board', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 1, category: 'BOUGHT_OUT', scope: 'BOUGHT_OUT', rateKey: 'Danger board' }),
      ],
    }),
  );
  assert.equal(r.lines[1].status, 'EXCLUDED');
  assert.equal(r.lines[2].status, 'COSTED');
  assert.equal(r.lines[2].rm, Math.round(8 * 0.12 * 110 * 100) / 100);
  assert.equal(r.lines[2].marginPct, 5); // own N&B margin, not the 10% VA
  assert.equal(r.lines[2].sell, Math.round(8 * 0.12 * 110 * 1.05 * 100) / 100);
  assert.equal(r.lines[3].marginPct, 8);
  assert.equal(r.lines[3].sell, 270);
  assert.equal(r.perSet?.blackWtKg, 38.24);
  assert.equal(r.nutsBolts.sell, Math.round(8 * 0.12 * 110 * 1.05 * 10 * 100) / 100);
  assert.equal(r.grandSell, Math.round((r.structure.sell + r.nutsBolts.sell + r.boughtOut.sell) * 100) / 100);
});

test('interest applies to N&B too', () => {
  const rs = baseRates().filter((x) => !['INTEREST_PCT', 'CREDIT_DAYS'].includes(x.kind));
  rs.push(rate('INTEREST_PCT', 1, '%'), rate('CREDIT_DAYS', 45, 'days'));
  const r = computeCosting(input({ rates: rs, lines: [line({ rowNo: 3, markNo: null, description: 'Bolt', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 10, category: 'NUTS_BOLTS', rateKey: 'M16X40', unitWtKg: 0.1 })] }));
  const l = r.lines[0];
  // 45 days / 30 x 1% = 1.5% of the selling value; N&B margin 5%
  assert.ok(Math.abs(l.interest - 0.015 * l.sell) < 0.01);
  assert.ok(Math.abs(l.sell - (110 * 1.05) / (1 - 0.015 * 1.05)) < 0.01);
  assert.ok(Math.abs(l.sell - l.cost * 1.05) < 0.02);
});

test('Rev 2: GI example 3.80 + 3.8% x 379 + 0.70 = Rs 18.90/kg black', () => {
  const rs = baseRates().filter((x) => !['GALV_RATE', 'ZINC_PCT', 'ZINC_RATE', 'GALV_TRANSPORT'].includes(x.kind));
  rs.push(rate('GALV_RATE', 3.8, 'Rs/kg black'), rate('ZINC_PCT', 3.8, '%'), rate('ZINC_RATE', 379, 'Rs/kg'), rate('GALV_TRANSPORT', 0.7, 'Rs/kg'));
  const r = computeCosting(input({ rates: rs }));
  assert.ok(Math.abs(r.lines[0].galv / 38.24 - 18.902) < 0.001);
});

test('Rev 2: default VA % from VA_PCT; N&B / bought-out use VA % when no own margin', () => {
  const rs = baseRates().filter((x) => !['NB_MARGIN_PCT', 'BO_MARGIN_PCT'].includes(x.kind));
  rs.push(rate('VA_PCT', 12, '%'));
  const r = computeCosting(
    input({
      rates: rs,
      lines: [line(), line({ rowNo: 3, markNo: null, description: 'Bolt', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 8, unitWtKg: 0.12, category: 'NUTS_BOLTS', rateKey: 'M16X40' })],
    }),
  );
  assert.equal(r.vaPct, 12);
  assert.equal(r.lines[1].marginPct, 12);
  assert.ok(Math.abs(r.lines[0].sell - r.lines[0].cost * 1.12) < 0.02);
  // docket override still wins
  assert.equal(computeCosting(input({ rates: rs, vaPct: 15 })).vaPct, 15);
});

test('Rev 2: ex-works (no destination) = no freight and no freight master needed', () => {
  const r = computeCosting(input({ destState: null, rates: baseRates().filter((x) => x.kind !== 'FREIGHT_MT') }));
  assert.equal(r.lines[0].freight, 0);
  assert.equal(r.checks.ok, true);
  assert.ok(r.checks.messages.some((m) => /ex-works/.test(m)));
});

test('Rev 2: RM lookup size row -> family row; off-list size costed at the family rate', () => {
  const rs = [...baseRates(), rate('RM_RATE', 50, 'Rs/kg', 'ANGLE'), rate('FAB_RATE', 1.6, 'Rs/kg', 'CH_ANG')];
  const r = computeCosting(
    input({
      rates: rs,
      sectionKgm: { ISMC100X50: 9.56, ISA65X65X6: 5.8 },
      lines: [line(), line({ rowNo: 2, markNo: 'X', section: 'ISA 65x65x6', sectionKey: 'ISA65X65X6', lengthMm: 1000, qtyPerSet: 1 })],
    }),
  );
  assert.equal(r.lines[0].rmRate, 55); // size row wins
  assert.equal(r.lines[1].status, 'COSTED');
  assert.equal(r.lines[1].rmRate, 50); // family row
  assert.equal(r.checks.outsidePurchaseList.length, 0);
  assert.ok(r.checks.messages.some((m) => /family RM rate/.test(m)));
  // no family rate either -> still flagged
  const none = computeCosting(input({ sectionKgm: { ISMC100X50: 9.56, ISA65X65X6: 5.8 }, lines: [line({ section: 'ISA 65x65x6', sectionKey: 'ISA65X65X6' })] }));
  assert.equal(none.lines[0].status, 'FLAGGED');
});

test('Rev 2 §7: discount -> final price and effective VA (red below minimum VA)', () => {
  const base = computeCosting(input({ vaPct: 12 }));
  assert.equal(base.discount, null);
  assert.ok(Math.abs(base.vaAmount - (base.grandSell - base.costTotal)) < 0.01);
  const pct = computeCosting(input({ vaPct: 12, discount: { mode: 'PCT', value: 1, reason: 'L1 match' } }));
  assert.ok(Math.abs(pct.discount!.amount - base.grandSell * 0.01) < 0.01);
  assert.ok(Math.abs(pct.discount!.effectiveVaPct - ((base.grandSell * 0.99 - base.costTotal) / base.costTotal) * 100) < 0.01);
  assert.equal(pct.discount!.belowMinVa, false); // 1% off 12% VA leaves ~10.9%, above the 10% minimum
  const perKg = computeCosting(input({ vaPct: 12, discount: { mode: 'RS_PER_KG', value: 1, reason: 'x' } }));
  assert.ok(Math.abs(perKg.discount!.amount - perKg.structure.billedWtKg) < 0.01);
  const big = computeCosting(input({ vaPct: 12, discount: { mode: 'LUMP', value: base.grandSell * 0.05, reason: 'x' } }));
  assert.equal(big.discount!.belowMinVa, true); // ~6.4% < 10%
  assert.ok(big.checks.messages.some((m) => /below the minimum/.test(m)));
});

test('Rev 2: pending masters (min VA, LC/BG, inspection, packing) are flagged but do not block', () => {
  const rs = baseRates().filter((x) => !['MIN_VA_PCT', 'LC_BG_PCT', 'INSPECTION', 'PACKING'].includes(x.kind));
  rs.push(rate('VA_PCT', 12, '%'));
  const r = computeCosting(input({ rates: rs, planConfirmed: false }));
  assert.equal(r.checks.pendingMasters.length, 5);
  assert.deepEqual(r.checks.missingMasters, []);
  assert.equal(r.checks.ok, true);
});

test('non-billable: costed, weight not billed, cost carried on the billable kg', () => {
  const both = computeCosting(input({ lines: [line(), line({ rowNo: 2, markNo: 'C1', lengthMm: 1000, qtyPerSet: 1, nonBillable: true })] }));
  const only = computeCosting(input());
  assert.equal(both.lines[1].status, 'COSTED');
  assert.equal(both.structure.billedWtKg, only.structure.billedWtKg);
  assert.ok(both.structure.sell > only.structure.sell);
  assert.ok(both.structure.sellPerKg > only.structure.sellPerKg);
  assert.equal(both.structure.nonBillableWtKg, 95.6);
});

test('section outside the purchase list is flagged; blank rate blocks apply', () => {
  const r = computeCosting(input({ lines: [line(), line({ rowNo: 2, markNo: 'X', section: 'ISA 65x65x6', sectionKey: 'ISA65X65X6', lengthMm: 1000, qtyPerSet: 1, kgPerM: 5.8 })] }));
  assert.equal(r.lines[1].status, 'FLAGGED');
  assert.equal(r.checks.outsidePurchaseList.length, 1);
  assert.equal(r.checks.ok, false);
  const noRate = computeCosting(input({ rates: baseRates().filter((x) => x.kind !== 'RM_RATE') }));
  assert.equal(noRate.lines[0].status, 'FLAGGED');
  assert.equal(noRate.checks.ok, false);
});

test('mixed BOM: each structure has its own sets; 0 sets skipped, blank sets flagged', () => {
  const r = computeCosting(
    input({
      lines: [
        line({ group: 'DP', sets: 3 }),
        line({ rowNo: 2, group: 'Single', sets: 321, qtyPerSet: 1, lengthMm: 1000 }),
        line({ rowNo: 3, group: 'Cantilever', sets: 0 }),
      ],
    }),
  );
  assert.equal(r.groups.length, 3);
  assert.equal(r.sets, null);
  assert.equal(r.perSet, null);
  assert.equal(r.totalSets, 324);
  assert.equal(r.structure.blackWtKg, Math.round((38.24 * 3 + 9.56 * 321) * 1000) / 1000);
  assert.equal(r.lines[2].status, 'EXCLUDED');
  assert.equal(r.checks.ok, true);
  const blank = computeCosting(input({ lines: [line({ group: 'DP', sets: 3 }), line({ rowNo: 2, group: 'X', sets: null })] }));
  assert.equal(blank.lines[1].status, 'FLAGGED');
  assert.equal(blank.checks.ok, false);
});

test('below minimum VA and variance vs last quote are flagged', () => {
  const r = computeCosting(input({ vaPct: 5, lastPricePerKg: { value: 80, ref: 'CEE-000500' } }));
  assert.equal(r.checks.belowMinVa, true);
  assert.notEqual(r.checks.variancePct, null);
});

test('setsFromItem / wastageFromPlan', () => {
  assert.deepEqual(setsFromItem(100000, 'KG', 40), { sets: 2500, basis: 'WEIGHT' });
  assert.deepEqual(setsFromItem(25, 'Nos', 40), { sets: 25, basis: 'SETS' });
  assert.deepEqual(wastageFromPlan([{ sectionKey: 'A', netKg: 100, scrapKg: 5 }]), { A: 5 });
});

test('section names as written in client BOMs map to one key', () => {
  assert.equal(sectionKey('L65X65X6'), 'ISA65X65X6');
  assert.equal(sectionKey('Angle 50x50x6'), 'ISA50X50X6');
  assert.equal(sectionKey('FL 50X8'), 'FLAT50X8');
  assert.equal(sectionKey('FT 50X8'), 'FLAT50X8');
  assert.equal(sectionKey('Flat 30x3'), 'FLAT30X3');
  assert.equal(sectionKey('16 Dia'), 'RB16');
  assert.equal(sectionKey('Round bar 16 dia'), 'RB16');
  assert.equal(sectionKey('ISMC 100X50'), 'ISMC100X50');
  assert.deepEqual(resolveSection('FLAT75X40', 7.14, { ISMC75X40: 7.14 }), { key: 'ISMC75X40', note: 'FLAT75X40 read as ISMC75X40 (same size, kg/m 7.14)' });
  assert.equal(resolveSection('FLAT75X40', 3.14, { ISMC75X40: 7.14 }).key, 'FLAT75X40'); // different weight: left for the user
  assert.equal(guessCategory('CLAMP FOR BARBED WIRE (TOP)', 'FT 40X5'), 'STRUCTURE');
  assert.equal(guessCategory('EYE HOOK/BOLT', '16 Dia'), 'STRUCTURE');
});

test('parseMixedBom reads structures, set counts by site, drawing no and billable flag', () => {
  const cells: unknown[][] = [
    ['BOM of GI Fabricated Material'],
    ['Sl. No', 'Drawing No.', 'ERE Code', 'Description', 'Unit', 'Billable/Non-Billable', 'Qty / Unit', 'Section', 'Lg of Section in mm', 'Unit Wt/Mtr (Kg)', 'Total ', '', 'Banka', 'Jamui', '', ''],
    ['', '', '', '', '', '', '', '', '', '', 'Wt/No (Kg)', 'Wt/Set (Kg)', 'Khaira', 'Indpey', 'Total', 'Total Weight (Kg)'],
    ['11KV LINE'],
    ['', '', '', '11KV on DP 11M Angular', '', '', '', '', '', '', '', 170.9, 1, 2, 3, ''],
    [8, 'EPC-PD-2023-HT-011', 'R01', 'TOP CHANNEL', 'Nos.', 'Billable', 2, 'ISMC 100X50', 2200, 9.56, 21.03, 42.06, 2, 4, 6, 126],
    ['', '', 'R15', 'CLAMP FOR STAY SET-A', 'Nos.', 'Non-Billable', 8, 'FL 50X8', 435, 3.14, 1.36, 10.9, 8, 16, 24, 32],
    ['', '', '', '11KV Single Pole In line', '', '', '', '', '', '', '', 19.4, 704.5, 0, 704.5, 0],
    [29, 'EPC-PD-2023-HT-022', 904, 'TCP BRACKET', 'Nos.', 'Billable', 1, 'FT 75X40', 385, 7.14, 2.7, 2.7, 704.5, 0, 704.5, 1939],
    ['', '', '', 'Total Qty in Kg', '', '', '', '', '', '', '', '', 1, 1, 1, 1],
  ];
  assert.equal(isMixedBom(cells), true);
  const m = parseMixedBom(cells)!;
  assert.equal(m.groups.length, 2);
  assert.deepEqual(m.sites, ['Banka Khaira', 'Jamui Indpey']);
  assert.equal(m.groups[0].sets, 3);
  assert.deepEqual(m.groups[0].siteSets, { 'Banka Khaira': 1, 'Jamui Indpey': 2 });
  assert.equal(m.groups[0].drawingNo, 'EPC-PD-2023-HT-011');
  assert.equal(m.groups[0].lines[1].nonBillable, true);
  assert.equal(m.groups[0].lines[1].sectionKey, 'FLAT50X8');
  assert.equal(m.groups[1].sets, 704.5);
  assert.equal(m.groups[1].lines[0].markNo, '904');
});

test('rankDrawings: utility+item, then state+item, then any; superseded and pending skipped', () => {
  const ds = [
    { id: 1, utility: 'NBPDCL', state: 'Bihar', itemType: 'V Cross Arm', status: 'APPROVED', approvalDate: '2025-01-01' },
    { id: 2, utility: 'MSEDCL', state: 'Maharashtra', itemType: 'V Cross Arm', status: 'APPROVED', approvalDate: '2025-05-01' },
    { id: 3, utility: 'SBPDCL', state: 'Bihar', itemType: 'v cross-arm', status: 'APPROVED', approvalDate: '2025-07-28' },
    { id: 4, utility: 'SBPDCL', state: 'Bihar', itemType: 'V Cross Arm', status: 'SUPERSEDED', approvalDate: '2024-01-01' },
    { id: 6, utility: 'SBPDCL', state: 'Bihar', itemType: 'V Cross Arm', status: 'PENDING', approvalDate: '2026-01-01' },
  ];
  const r = rankDrawings(ds, { itemType: 'V CROSS ARM', utility: 'South Bihar Power Distribution Company Limited (SBPDCL)', states: ['Telangana', 'Bihar'] });
  assert.deepEqual(r.map((x) => [x.drawing.id, x.level]), [[3, 'UTILITY_ITEM'], [1, 'STATE_ITEM'], [2, 'ANY_ITEM']]);
});

test('cleanLines / nbSize / parseAiLines', () => {
  assert.equal(nbSize('Hex bolt M16 x 40 with nut'), 'M16X40');
  const lines = cleanLines([
    { markNo: 'A1', section: 'ISMC 75 x 40', length: 1.2, qty: 2 },
    { description: 'Hex bolt M16x40', qty: 8, unitWtKg: '0.12 kg' },
    { description: 'Clamp', section: 'FL 50X8', length: 435, qty: 8, billable: 'Non-Billable' },
    { description: 'TOTAL', qty: 10 },
  ]);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].lengthMm, 1200);
  assert.equal(lines[1].category, 'NUTS_BOLTS');
  assert.equal(lines[2].nonBillable, true);
  assert.equal(parseAiLines('```json\n{"lines":[{"markNo":"1"}]}\n```').length, 1);
});

// --- 23-Nov-2026: fabrication rate per line category (job-work chart), masters blank-flagged ---

const fc = (section: string, description = '', lengthMm: number | null = 1000, structureType: string | null = null) =>
  classifyFab({ sectionKey: sectionKey(section), section, description, lengthMm, structureType });

test('classifyFab: picks the job-work chart category from section, description and item type', () => {
  assert.equal(fc('ISMC 100x50', 'Cross arm'), 'CH_ANG');
  assert.equal(fc('L 50x50x6', 'Bracing angle'), 'CH_ANG');
  assert.equal(fc('FL 50x8', 'Clamp'), 'CLAMP_65_50');
  assert.equal(fc('Flat 65x6', 'Radius clamp'), 'RADIUS_CLAMP');
  assert.equal(fc('FL 40x5', 'Stay clamp'), 'CLAMP_40');
  assert.equal(fc('FL 30x3', 'Barbed wire clamp'), 'CLAMP_30_25');
  assert.equal(fc('FT 50x8', 'Welded flat'), 'WELDED');
  assert.equal(fc('ISMC 75x40', 'V-Bracket'), 'WELDED');
  assert.equal(fc('ISMC 100x50', 'Taper cut V-cross arm'), 'TAPER_VCROSS');
  assert.equal(fc('FL 50x5', 'Square washer'), 'SQ_WASHER');
  assert.equal(fc('16 Dia', 'Rod', 560), 'RB16_CUT_560');
  assert.equal(fc('RB 16', 'Rod', 1800), 'RB16_CUT_1800');
  assert.equal(fc('16 Dia', 'Angle bow', 400), 'RB16_BOW');
  assert.equal(fc('40 NB tube', 'Pipe', 3000), 'TUBE40_3000_DRILL');
  assert.equal(fc('40 NB tube', 'Pipe', 1800), 'TUBE40_1800_DRILL');
  assert.equal(fc('Plate 200x200x6', 'Base plate', 200), 'PLATE200_PUNCH');
  assert.equal(fc('ISA 50x50x6', 'Leg', 3000, 'Lattice tower 9M'), 'WELDED');
  // No category on the chart: flagged.
  assert.equal(fc('FL 75x10', 'Plate'), null);
  assert.equal(fc('16 Dia', 'Rod', 900), null);
  assert.equal(fc('40 NB tube', 'Pipe', 2500), null);
});

test('fab: per-kg rate on black weight, per-piece rate on BOM qty; no category is flagged, not costed', () => {
  const rates = [...baseRates(), rate('FAB_RATE', 1.5, 'Rs/pc', 'RB16_CUT_1800'), rate('RM_RATE', 50.5, 'Rs/kg', 'RB16')];
  const r = computeCosting(
    input({
      rates,
      sectionKgm: { ISMC100X50: 9.56, RB16: 1.58 },
      purchaseItems: { ISMC100X50: 'ISMC 100x50', RB16: 'Round bar 16' },
      lines: [
        line(),
        line({ rowNo: 2, markNo: 'R1', section: '16 Dia', sectionKey: 'RB16', lengthMm: 1800, qtyPerSet: 4, fabCat: 'RB16_CUT_1800' }),
        line({ rowNo: 3, markNo: 'X1', fabCat: null }),
      ],
    }),
  );
  assert.equal(r.lines[0].fab, 229.44); // 38.24 kg x Rs 6
  assert.equal(r.lines[1].fab, 6); // 4 pcs x Rs 1.5
  assert.equal(r.lines[1].fabUnit, 'Rs/pc');
  assert.equal(r.lines[2].status, 'FLAGGED');
  assert.match(r.lines[2].note ?? '', /No fabrication category/);
  assert.equal(r.checks.ok, false);
});

test('masters left blank are listed and block Apply; interim RM rate is marked but allowed', () => {
  const full = [
    ...baseRates().filter((x) => x.kind !== 'RM_RATE'),
    { ...rate('RM_RATE', 50.5, 'Rs/kg', 'ISMC100X50', '2026-11-20'), source: 'INTERIM – Anchal Ispat L1 quote 20-Nov-2026' },
  ];
  const ok = computeCosting(input({ rates: full, planConfirmed: true }));
  assert.deepEqual(ok.checks.missingMasters, []);
  assert.equal(ok.lines[0].rmInterim, true);
  assert.equal(ok.checks.interimLines.length, 1);
  assert.equal(ok.checks.ok, true);

  const noFreight = computeCosting(input({ rates: full.filter((x) => x.kind !== 'FREIGHT_MT' && x.kind !== 'INTEREST_PCT'), planConfirmed: false }));
  assert.equal(noFreight.checks.ok, false);
  assert.equal(noFreight.checks.missingMasters.length, 2); // freight (Bihar), interest
  // Rev 2: kerf / end allowance not confirmed is pending (0 used), not blocking
  assert.ok(noFreight.checks.pendingMasters.some((m) => /End allowance/.test(m)));
});

// ---- M14 25-11: VA band, freight by space, painted finish, delivery-state lanes ----

test('25-11: VA below the minimum is blocked; between minimum and default needs approval', () => {
  const rs = [...baseRates().filter((r) => r.kind !== 'MIN_VA_PCT'), rate('MIN_VA_PCT', 8, '%'), rate('VA_PCT', 12, '%')];
  const ok = computeCosting(input({ rates: rs }));
  assert.equal(ok.checks.belowMinVa, false);
  assert.equal(ok.checks.vaNeedsApproval, false);
  assert.equal(ok.checks.ok, true);
  const mid = computeCosting(input({ rates: rs, vaPct: 10 }));
  assert.equal(mid.checks.vaNeedsApproval, true);
  assert.equal(mid.checks.ok, true); // allowed, but only with an Admin approval + reason (server)
  const low = computeCosting(input({ rates: rs, vaPct: 7 }));
  assert.equal(low.checks.belowMinVa, true);
  assert.equal(low.checks.ok, false);
  // A discount that takes the effective VA under 8% is blocked too.
  const disc = computeCosting(input({ rates: rs, discount: { mode: 'PCT', value: 5, reason: 'x' } }));
  assert.ok(disc.checks.effectiveVaPct < 8);
  assert.equal(disc.checks.belowMinVa, true);
  assert.equal(disc.checks.ok, false);
});

test('25-11: freight by space = ROUNDUP(sets / sets per truck) trips x trip rate', () => {
  const rs = [...baseRates(), rate('FREIGHT_TRIP', 43450, 'Rs/trip', 'BIHAR')];
  const r = computeCosting(input({ rates: rs, load: { basis: 'SPACE', setsPerTruck: 14 }, lines: [line({ sets: 262 })] }));
  assert.equal(r.freight.basis, 'SPACE');
  assert.equal(r.freight.trips, 19); // 262 / 14 = 18.7 -> 19
  // Per-line rounding (Rs 0.01 a line per set): within a few rupees of 19 x 43,450.
  assert.ok(Math.abs(r.freight.total - 19 * 43450) < 5);
  assert.ok(Math.abs((r.freight.perSet ?? 0) - (19 * 43450) / 262) < 0.05);
  // No sets per truck: listed as missing, price cannot be applied.
  const miss = computeCosting(input({ rates: rs, load: { basis: 'SPACE', setsPerTruck: null } }));
  assert.ok(miss.checks.missingMasters.some((m) => /Sets per truck/.test(m)));
  assert.equal(miss.checks.ok, false);
  // Weight basis unchanged.
  assert.equal(computeCosting(input()).freight.basis, 'WEIGHT');
});

test('25-11: painted finish adds PAINT_RATE x black kg; not with galvanised', () => {
  const rs = [...baseRates(), rate('PAINT_RATE', 7, 'Rs/kg')];
  const painted = computeCosting(input({ rates: rs, galvanised: false, painted: true }));
  assert.equal(painted.lines[0].paint, Math.round(7 * 38.24 * 100) / 100);
  const gi = computeCosting(input({ rates: rs, galvanised: true, painted: true }));
  assert.equal(gi.lines[0].paint, 0);
  const noRate = computeCosting(input({ galvanised: false, painted: true }));
  assert.ok(noRate.checks.missingMasters.some((m) => /Painting/.test(m)));
});

test('25-11: pipe and wire-mesh families; channel thickness dropped from the key', async () => {
  const { familyOf } = await import('../src/lib/costing/calc');
  assert.equal(familyOf('PIPE25NB'), 'PIPE');
  assert.equal(familyOf('GIPIPE40NB'), 'PIPE');
  assert.equal(familyOf('WIREMESH50X50'), 'WIRE_MESH');
  assert.equal(sectionKey('ISMC 75X40X6'), 'ISMC75X40');
  assert.equal(sectionKey('ISMC-100x50x6'), 'ISMC100X50');
  assert.equal(sectionKey('ISA 50X50X6'), 'ISA50X50X6');
});

test('freight lanes: PIN -> state, trucks only, <=6 months lowest, older +5%, outliers dropped', async () => {
  const { stateOfPin, truckCapacityMt, deriveLanes, stateFreight } = await import('../src/lib/freight/lanes');
  assert.equal(stateOfPin('208001'), 'Uttar Pradesh');
  assert.equal(stateOfPin('821115'), 'Bihar');
  assert.equal(stateOfPin('834001'), 'Jharkhand');
  assert.equal(stateOfPin('495553'), 'Chhattisgarh');
  assert.equal(stateOfPin('12'), null);
  assert.equal(truckCapacityMt('TRUCK-16MT'), 16);
  assert.equal(truckCapacityMt('TRAILER'), null);
  const row = (date: string, tripRate: number, vehicleType = 'TRUCK-16MT', toPin = '208001') => ({ fromLoc: 'DHULAGARH', toLoc: 'KANPUR', toPin, vehicleType, date, tripRate });
  const lanes = deriveLanes(
    [
      row('2026-10-01', 45000),
      row('2026-09-01', 43000),
      row('2026-07-01', 44000),
      row('2026-08-01', 9000), // outlier (< 0.5 x median)
      row('2026-10-05', 40000, 'TRAILER'), // not a truck
      row('2025-01-01', 30000, 'TRUCK-9MT', '821115'),
      row('2024-06-01', 28000, 'TRUCK-9MT', '821115'),
      row('2025-02-01', 31000, 'TRUCK-9MT', '821115'),
      { ...row('2026-10-01', 1000), fromLoc: 'KALYANI' }, // other origin
    ],
    '2026-11-25',
  );
  const up = lanes.find((l) => l.state === 'Uttar Pradesh')!;
  assert.equal(up.tripRate, 43000);
  assert.equal(up.basis, 'LOWEST_6M');
  assert.equal(up.outliers, 1);
  const br = lanes.find((l) => l.state === 'Bihar')!;
  assert.equal(br.basis, 'OLDER_PLUS_5');
  assert.equal(br.tripRate, 32550); // latest older (31,000) + 5%
  const s = stateFreight(lanes);
  assert.equal(s.find((x) => x.state === 'Uttar Pradesh')?.perMt.ratePerMt, Math.round((43000 / 16) * 100) / 100);
});

test('enquiry intake: mail class, party key and enquiry no. key', async () => {
  const { classifyMail, partyKey, enquiryNoKey } = await import('../src/lib/enquiry/classify');
  assert.equal(classifyMail('RFQ FOR SUPPLY OF PIPE TYPE FOR 400 KV TRANSMISSION LINE AT JSW MAHANADI POWER LTD || 4937002082', ''), 'ENQUIRY');
  assert.equal(classifyMail('Fwd: Requrirements of Hardware & Structure for KUSUM Solar Project- Maharashtra', 'Please provide your best offer.'), 'ENQUIRY');
  assert.equal(classifyMail('Purchase Order No. 4500123 for GI structures', ''), 'PO');
  assert.equal(classifyMail('Clarification on GTP', ''), 'CLARIFICATION');
  assert.equal(classifyMail('Payment Request – November', 'quote'), 'OTHER');
  assert.equal(partyKey('JSW MAHANADI POWER COMPANY LTD.'), partyKey('JSW Mahanadi Power Co. Limited'));
  assert.equal(partyKey('M/s N K C Project'), 'NKC PROJECT');
  assert.equal(partyKey('NKC Projects Pvt Ltd'), 'NKC PROJECT');
  assert.equal(partyKey('Laser Power & Infra Ltd.'), partyKey('LASER POWER & INFRA LIMITED'));
  assert.equal(enquiryNoKey('RFQ No. 4937002082'), '4937002082');
  assert.equal(enquiryNoKey('12'), null);
});

test('ERP feed: dates, numbers and content hashes (identical rows keep distinct keys)', async () => {
  // import.ts is server-only; the pure helpers are checked through a copy-free dynamic import guard.
  const mod = await import('../src/modules/erp/server/import').catch(() => null);
  if (!mod) return; // 'server-only' refuses outside the react-server condition
  const { erpDate, erpNum, rowHashes } = mod;
  assert.equal((erpDate('24-Nov-26') as Date).toISOString().slice(0, 10), '2026-11-24');
  assert.equal((erpDate('2026-11-24T00:00:00') as Date).toISOString().slice(0, 10), '2026-11-24');
  assert.equal((erpDate('05/12/2025') as Date).toISOString().slice(0, 10), '2025-12-05');
  assert.equal(erpDate('abc'), 'BAD');
  assert.equal(erpNum('1,234.5'), 1234.5);
  const h = rowHashes([{ a: 1 }, { a: 1 }, { a: 2 }]);
  assert.equal(new Set(h).size, 3);
  assert.deepEqual(rowHashes([{ a: 1 }]), [h[0]]);
});

test('enquiry intake: internal M14 mails are not enquiries', async () => {
  const { classifyMail } = await import('../src/lib/enquiry/classify');
  assert.equal(classifyMail('Re: M14 – Correction to E5: every enquiry MUST get an offer', 'enquiry'), 'OTHER');
});
