import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCosting, pickRate, setsFromItem, wastageFromPlan, type CostInput, type CostLineInput, type RateRow } from '../src/lib/costing/calc';
import { cleanLines, guessCategory, nbSize, parseAiLines, rankDrawings } from '../src/lib/costing/drawings';
import { isMixedBom, parseMixedBom, resolveSection } from '../src/lib/costing/mixedBom';
import { sectionKey } from '../src/lib/bom/parse';

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
  ...over,
});

const input = (over: Partial<CostInput> = {}): CostInput => ({
  lines: [line()],
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
  assert.equal(l.blackWtKg, 38.24); // 2 x 2.0 m x 9.56, per set
  assert.equal(l.galvWtKg, 40.152);
  assert.equal(l.wastageSource, 'CUTTING_PLAN');
  const cost = 38.24 * 55 * 1.04 + 38.24 * 6 + 38.24 * 21 + (40.152 / 1000) * 2000;
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
  rs.push(rate('INTEREST_PCT', 12, '%'), rate('CREDIT_DAYS', 73, 'days'));
  const r = computeCosting(input({ rates: rs, lines: [line({ rowNo: 3, markNo: null, description: 'Bolt', section: null, sectionKey: null, lengthMm: null, qtyPerSet: 10, category: 'NUTS_BOLTS', rateKey: 'M16X40', unitWtKg: 0.1 })] }));
  assert.ok(Math.abs(r.lines[0].commercial - 10 * 0.1 * 110 * 0.12 * 0.2) < 0.01);
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
