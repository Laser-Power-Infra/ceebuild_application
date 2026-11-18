import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoMapHeaders, findHeaderRow, parsePieces, sectionKey, toNum } from '../src/lib/bom/parse';
import { checkPieces, type SectionStd } from '../src/lib/bom/checks';

test('sectionKey normalises spacing, case, x and mm', () => {
  assert.equal(sectionKey('ISMC 100 x 50'), 'ISMC100X50');
  assert.equal(sectionKey('isa-50×50×6 mm'), 'ISA50X50X6');
  assert.equal(sectionKey('  '), null);
  assert.equal(sectionKey(null), null);
});

test('toNum reads commas and rejects text', () => {
  assert.equal(toNum('1,250.5'), 1250.5);
  assert.equal(toNum(12), 12);
  assert.equal(toNum(''), null);
  assert.equal(toNum('approx 5'), null);
});

test('autoMapHeaders maps common client headers', () => {
  const map = autoMapHeaders(['Sl No', 'Mark No.', 'Description', 'Section', 'Length (mm)', 'Qty/Set', 'No. of Sets', 'Total Qty', 'Unit Wt (kg/m)', 'Unit Wt (kg)', 'Total Wt']);
  assert.equal(map.markNo, 'Mark No.');
  assert.equal(map.section, 'Section');
  assert.equal(map.lengthMm, 'Length (mm)');
  assert.equal(map.qtyPerSet, 'Qty/Set');
  assert.equal(map.sets, 'No. of Sets');
  assert.equal(map.totalQty, 'Total Qty');
  assert.equal(map.kgPerM, 'Unit Wt (kg/m)');
  assert.equal(map.unitWtKg, 'Unit Wt (kg)');
  assert.equal(map.totalWtKg, 'Total Wt');
  assert.equal(map.description, 'Description');
});

const SHEET: unknown[][] = [
  ['SBPDCL 100 MT - BOM'],
  [],
  ['Mark', 'Section', 'Length', 'Qty/Set', 'Sets', 'kg/m'],
  ['A1', 'ISA 50x50x6', 2200, 2, 10, 4.5],
  ['A1', 'ISA 50x50x6', 2210, 1, 10, 4.5], // same mark, different length
  ['B2', 'ISMC 100x50', 1500, '', '', 9.56], // blank qty
  ['C3', 'ISA 65x65x6', 900, 4, 2.5, 5.8], // fractional sets
  ['D4', 'ISA 45x45x5', 600, 1, 10, 4.0], // kg/m 4.0 vs 3.4 std (+17.6%), and section not approved
  ['', '', '', '', '', ''],
  ['E5', 'XYZ 1', 300, 1, 1, 1], // unknown section
];

test('findHeaderRow skips title rows', () => {
  assert.equal(findHeaderRow(SHEET), 2);
});

test('parsePieces derives total qty and weight', () => {
  const map = autoMapHeaders(SHEET[2] as string[]);
  const pieces = parsePieces(SHEET, 2, map);
  assert.equal(pieces.length, 6, 'blank row skipped');
  assert.equal(pieces[0].rowNo, 4);
  assert.equal(pieces[0].totalQty, 20);
  assert.equal(pieces[0].totalWtKg, 198); // 4.5 kg/m x 2.2 m x 20
  assert.equal(pieces[2].totalQty, null);
});

test('length header in metres is converted to mm', () => {
  const cells = [['Mark', 'Section', 'Length (m)', 'Qty'], ['A', 'ISA 50x50x6', 2.2, 3]];
  const pieces = parsePieces(cells, 0, autoMapHeaders(cells[0] as string[]));
  assert.equal(pieces[0].lengthMm, 2200);
  assert.equal(pieces[0].totalQty, 3);
});

test('checkPieces raises each flag', () => {
  const pieces = parsePieces(SHEET, 2, autoMapHeaders(SHEET[2] as string[]));
  const master = new Map<string, SectionStd>([
    ['ISA50X50X6', { kgPerM: 4.5, approved: true }],
    ['ISMC100X50', { kgPerM: 9.56, approved: true }],
    ['ISA65X65X6', { kgPerM: 5.8, approved: true }],
    ['ISA45X45X5', { kgPerM: 3.4, approved: false }],
  ]);
  const f = checkPieces(pieces, master);
  assert.equal(f[0].flagMarkLength, true);
  assert.equal(f[1].flagMarkLength, true);
  assert.equal(f[2].flagBlankQty, true);
  assert.equal(f[3].flagFractionalSets, true);
  assert.equal(f[4].flagKgm, true);
  assert.equal(f[4].flagSection, true, 'not approved');
  assert.equal(f[5].flagSection, true, 'unknown section');
  assert.equal(f[0].flagKgm || f[0].flagSection || f[0].flagBlankQty || f[0].flagFractionalSets, false);
  assert.match(f[4].issues ?? '', /\+17\.6%/);
});

test('section checks are skipped while the section master is empty', () => {
  const pieces = parsePieces(SHEET, 2, autoMapHeaders(SHEET[2] as string[]));
  const f = checkPieces(pieces, new Map());
  assert.ok(f.every((x) => !x.flagKgm && !x.flagSection));
});

test('kg/m exactly at +5% passes; derived from unit weight when kg/m is blank', () => {
  const master = new Map<string, SectionStd>([['ISA50X50X6', { kgPerM: 4.0, approved: true }]]);
  const base = { markNo: 'A', sectionKey: 'ISA50X50X6', lengthMm: 1000, qtyPerSet: 1, sets: 1, totalQty: 1 };
  const [ok, bad] = checkPieces(
    [
      { ...base, kgPerM: 4.2, unitWtKg: null },
      { ...base, markNo: 'B', kgPerM: null, unitWtKg: 4.3 },
    ],
    master,
  );
  assert.equal(ok.flagKgm, false);
  assert.equal(bad.flagKgm, true);
});

test('sectionKey strips "mm" touching a digit', () => {
  assert.equal(sectionKey('ISA 50x50x6mm'), 'ISA50X50X6');
  assert.equal(sectionKey('ISA 50X50X6 MM'), 'ISA50X50X6');
});

test('"Length in millimetre" header is read as mm, not metres', () => {
  const cells = [['Mark', 'Section', 'Length in millimetre', 'Qty', 'kg/m'], ['A', 'ISA 50x50x6', 2200, 2, 4.5]];
  const pieces = parsePieces(cells, 0, autoMapHeaders(cells[0] as string[]));
  assert.equal(pieces[0].lengthMm, 2200);
  assert.equal(pieces[0].totalWtKg, 19.8); // 4.5 kg/m x 2.2 m x 2
});

test('TOTAL rows are not imported as pieces', () => {
  const cells = [
    ['Mark', 'Section', 'Length', 'Qty', 'Total Wt'],
    ['A', 'ISA 50x50x6', 2200, 2, 19.8],
    ['TOTAL', '', '', 2, 19.8],
    ['', 'Grand Total', '', '', 19.8],
  ];
  const pieces = parsePieces(cells, 0, autoMapHeaders(cells[0] as string[]));
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].markNo, 'A');
});

test('negative numbers are reported so the import can reject them', () => {
  const cells = [['Mark', 'Section', 'Length', 'Qty'], ['A', 'ISA 50x50x6', -2200, 2], ['B', 'ISA 50x50x6', 1000, 3]];
  const pieces = parsePieces(cells, 0, autoMapHeaders(cells[0] as string[]));
  assert.deepEqual(pieces[0].negative, ['lengthMm']);
  assert.deepEqual(pieces[1].negative, []);
});
