import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { planIndent, type CutSettings, type StockLot } from '../src/lib/planning/cutting';
import { buildIndentWorkbook, writeIndentXlsx, type BomLine } from '../src/lib/planning/indentExcel';
import { LANARSY_SECTIONS, REV2_SUBSTITUTE, lanarsyRev2Pieces, readLanarsyBom } from './fixtures/lanarsyBom';

// Settings the Rev 3 indent was made with (reference script + NOTES sheet): 6 m standard bars,
// custom max 6000 (ISMC 100x50 6600), no end allowance, no kerf, +0/+20, no buffer, custom length
// for a piece length needing >= 300 m with at least 2 pieces per bar.
const REV3: CutSettings = { stdBarMm: 6000, maxCustomMm: 6000, endAllowanceMm: 0, kerfMm: 0, tolPlusMm: 20, bufferPct: 0, minOffcutMm: 300, customMinBars: 5, customMinMetres: 300 };

// Store offcuts / full bars listed by Satya 23-11-2026 (OFFCUT USED tab of the Rev 3 workbook).
const STORE: StockLot[] = [
  { sectionKey: 'L50X50X6', lengthMm: 1850, nos: 9, forLengthMm: 1737 },
  { sectionKey: 'FL 50X8', lengthMm: 6000, nos: 10, forLengthMm: 761 },
  { sectionKey: 'ISMC 75X40', lengthMm: 1700, nos: 1, forLengthMm: 1476 },
  { sectionKey: 'FL 50X6', lengthMm: 6000, nos: 20, forLengthMm: 50 },
  { sectionKey: 'FL 30X3', lengthMm: 5000, nos: 12 },
  { sectionKey: 'ISMC 100X50', lengthMm: 2200, nos: 1, forLengthMm: 2200 },
  { sectionKey: 'ISMC 75X40', lengthMm: 385, nos: 1, forLengthMm: 385 },
  { sectionKey: 'ISMC 75X40', lengthMm: 400, nos: 1, forLengthMm: 385 },
  { sectionKey: 'ISMC 75X40', lengthMm: 550, nos: 3, forLengthMm: 385 },
];

const pieces = lanarsyRev2Pieces();
const bom: BomLine[] = readLanarsyBom().map((p) => ({ markNo: `${p.code || 'ROW'}-${p.row}`, sectionKey: REV2_SUBSTITUTE[p.sec] ?? p.sec, lengthMm: p.L, qty: p.qty, description: p.desc }));

test('Lanarsy SBPDCL Rev 2 (before store stock): 4,311 bars, 102.00 MT', () => {
  const plan = planIndent(pieces, LANARSY_SECTIONS, REV3, 'MIXED');
  assert.equal(plan.totals.bars + plan.totals.bufferBars, 4311);
  assert.equal((plan.totals.wtKg / 1000).toFixed(2), '102.00');
});

test('Lanarsy SBPDCL Rev 3 workbook: 4,267 bars, 101.40 MT, every line as in the reference', () => {
  const before = planIndent(pieces, LANARSY_SECTIONS, REV3, 'MIXED');
  const plan = planIndent(pieces, LANARSY_SECTIONS, REV3, 'MIXED', STORE);
  assert.deepEqual(plan.warnings, []);
  const book = buildIndentWorkbook({
    orderLine: 'Order: Lanarsy Infra Ltd PO No. LIL/SBPDCL/RDSS/GI Fabrication Material/2026-27/112 dt 13-11-2026',
    revisionLine: 'REV 3 · Indent date: 23-11-2026 · Supersedes Rev 1 & Rev 2',
    plan,
    planBeforeStock: before,
    settings: REV3,
    sections: LANARSY_SECTIONS,
    bom,
    materialSpec: 'IS 2062 E250A',
    changes: [
      { fromSection: 'Flat 40x5', toSectionKey: 'FL 45X5', basis: 'Lanarsy mail 21-11-2026' },
      { fromSection: 'Angle 65x65x6', toSectionKey: 'L75X75X6', basis: 'Lanarsy mail 21-11-2026' },
    ],
  });
  assert.equal(book.totals.bars, 4267);
  assert.equal(book.totals.mt.toFixed(2), '101.40');

  // Read the written file back.
  const wb = XLSX.read(writeIndentXlsx(book, 'buffer'));
  assert.deepEqual(wb.SheetNames, ['INDENT', 'SECTION SUMMARY', 'CHANGES-HOLD', 'OFFCUT USED', 'NOTES']);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.INDENT, { header: 1, defval: null });
  const total = rows.find((r) => r[1] === 'TOTAL')!;
  assert.equal(total[8], 4267);
  assert.equal((Number(total[11])).toFixed(2), '101.40');
  assert.equal(wb.Sheets.INDENT[XLSX.utils.encode_cell({ r: rows.indexOf(total), c: 8 })].f, `SUM(I6:I${rows.indexOf(total)})`);

  // Same lines as the reference Rev 3 INDENT (section, order length, bars).
  const reference = XLSX.readFile('docs/m14-rev2-reference/Ceebuild_RM_Indent_SBPDCL_100MT_Rev3_23-11-2026.xlsx');
  const refRows = XLSX.utils.sheet_to_json<unknown[]>(reference.Sheets.INDENT, { header: 1, defval: null }).filter((r) => typeof r[0] === 'number');
  const key = (r: unknown[]) => `${r[2]}|${r[3]}|${r[4]}|${r[8]}`;
  assert.deepEqual(rows.filter((r) => typeof r[0] === 'number').map(key).sort(), refRows.map(key).sort());

  // OFFCUT USED: 44 bars saved over the five lines that changed.
  const off = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['OFFCUT USED'], { header: 1, defval: null });
  const saved = off.slice(1).filter((r) => typeof r[4] === 'number').reduce((a, r) => a + Number(r[4]) - Number(r[5]), 0);
  assert.equal(saved, 44);
  const cut = rows.find((r) => r[2] === 'L50X50X6' && r[4] === 5211)!;
  assert.equal(cut[12], '3 × 1737 mm – BELTING ANGLE-A (+1 more)');
  assert.match(String(cut[13]), /Use 9 offcuts of 1850 mm in store \(9 pcs × 1737\) – order reduced by 3 bars/);
});

test('default per-mark rule (customMinBars 5) on the same BOM gives 4,313 bars / 101.99 MT before stock', () => {
  // Kept as a record of the gap: marks are planned one by one, so low-volume marks get their own
  // custom bars (5+ bars) and a 6000 mm exact multiple is nested instead of ordered as custom.
  const { customMinMetres: _unused, ...perMark } = REV3;
  void _unused;
  const plan = planIndent(pieces, LANARSY_SECTIONS, perMark, 'MIXED');
  assert.equal(plan.totals.bars, 4313);
  assert.equal((plan.totals.wtKg / 1000).toFixed(2), '101.99');
});

test('store stock: offcuts for a length cut the requirement; nested stock bars are filled first', () => {
  const sec = { A: { label: 'A', kgPerM: 1, maxBarMm: null } };
  const S = { ...REV3, customMinMetres: 1 };
  const p = [{ markNo: 'M1', sectionKey: 'A', lengthMm: 1000, qty: 12 }];
  const plan = planIndent(p, sec, S, 'MIXED', [{ sectionKey: 'A', lengthMm: 2100, nos: 1, forLengthMm: 1000 }]);
  assert.equal(plan.lines[0].bars, 1); // 12 - 2 = 10 -> 1 custom bar of 6 x 1000 + 4 nested
  assert.equal(plan.stock![0].pieces, 2);
  const nest = planIndent([{ markNo: 'M2', sectionKey: 'A', lengthMm: 700, qty: 3 }], sec, S, 'STANDARD', [{ sectionKey: 'A', lengthMm: 1500, nos: 1 }]);
  assert.equal(nest.totals.bars, 1);
  assert.equal(nest.stock![0].pieces, 2);
  assert.ok(nest.patterns.some((x) => x.lineType === 'STOCK' && x.cuts.length === 2));
});
