import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFeature, geometryByMark, parseFeature, parsePositions, type FabFeature } from '../src/lib/fabdrawing/geometry';
import { buildFabModel, type FabBom, type FabHeader } from '../src/lib/fabdrawing/model';
import { renderFabPdf } from '../src/lib/fabdrawing/render';

const header: FabHeader = { company: 'Ceebuild Company Pvt. Ltd.', project: 'Test', clientCode: 'KESCo', itemCode: 'FEN', rev: 0, date: '26-11-2026', basis: 'test', preparedBy: 'Minmoy', checkedBy: null, approvedBy: null, status: 'DRAFT' };
const bom: FabBom = {
  structureType: 'DTR fencing',
  drawingRef: null,
  galvanised: true,
  painted: false,
  fabType: 'WELDED',
  groups: [{ id: 1, name: 'Type A', drawingNo: null, sets: 262 }],
  lines: [
    { groupId: 1, rowNo: 1, markNo: 'P1', description: 'Post', section: 'ISA 50x50x6', lengthMm: 2800, qtyPerSet: 5, category: 'STRUCTURE', scope: 'IN_SCOPE', fabCat: null },
    { groupId: 1, rowNo: 2, markNo: 'R1', description: 'Rail', section: 'ISA 50x50x6', lengthMm: 3000, qtyPerSet: 6, category: 'STRUCTURE', scope: 'IN_SCOPE', fabCat: null },
    { groupId: 1, rowNo: 3, markNo: 'C1', description: 'Clamp', section: 'Flat 50x6', lengthMm: 400, qtyPerSet: 4, category: 'STRUCTURE', scope: 'IN_SCOPE', fabCat: 'CLAMP_40' },
    { groupId: 1, rowNo: 4, markNo: 'NB', description: 'M10 bolt + nut set', section: null, lengthMm: null, qtyPerSet: 20, category: 'NUTS_BOLTS', scope: 'IN_SCOPE', fabCat: null },
  ],
};
const f = (o: Partial<FabFeature>): FabFeature => ({ markNo: 'P1', kind: 'HOLE', positionsMm: [], diaMm: null, offsetMm: null, face: null, count: null, bendAngle: null, bendRadius: null, weldType: null, weldSize: null, weldLength: null, weldPitch: null, source: 'DRAWING', toConfirm: false, note: null, ...o });

test('positions parse and validation', () => {
  assert.deepEqual(parsePositions('50, 475; 1600 2775'), [50, 475, 1600, 2775]);
  assert.ok('error' in parseFeature({ markNo: 'P1', kind: 'HOLE', positions: '50, 3000' }, 2800));
  assert.ok('error' in parseFeature({ markNo: 'P1', kind: 'HOLE', positions: '' }, 2800));
  assert.ok('error' in parseFeature({ markNo: 'C1', kind: 'BEND', bendAngle: '200' }, 400));
  assert.ok('error' in parseFeature({ markNo: 'R1', kind: 'WELD', weldType: 'FILLET' }, 3000));
  const ok = parseFeature({ markNo: 'p1', kind: 'hole', positions: '1600, 475, 50', diaMm: '11.5', offsetMm: '28' }, 2800);
  assert.ok('feature' in ok && ok.feature.markNo === 'P1' && ok.feature.positionsMm.join() === '50,475,1600');
});

test('features describe and group per mark', () => {
  const fs = [f({ positionsMm: [475, 1600, 2775], diaMm: 11.5 }), f({ markNo: 'C1', kind: 'BEND', bendAngle: 90, bendRadius: 6, count: 2 }), f({ markNo: 'R1', kind: 'WELD', weldType: 'FILLET', weldSize: 4, weldLength: 50, weldPitch: 150, toConfirm: true })];
  assert.equal(describeFeature(fs[0]), '3 holes 11.5 dia at 475 / 1600 / 2775 from end A');
  assert.match(describeFeature(fs[2]), /fillet weld 4 mm x 50 long @ 150 c\/c – TO CONFIRM/);
  const g = geometryByMark(fs);
  assert.equal(g.get('P1')!.holeCount, 3);
  assert.equal(g.get('C1')!.bends, 2);
  assert.equal(g.get('C1')!.bendWeld, '2 bends');
  assert.equal(g.get('R1')!.toConfirm, true);
});

test('model uses the geometry: holes printed, bends defined, open points only where missing', async () => {
  const plain = buildFabModel({ bom, header });
  assert.ok(plain.toConfirm.some((t) => /Hole count and positions not defined for: P1, R1, C1/.test(t)));
  assert.ok(plain.toConfirm.some((t) => /Bend details .* C1/.test(t)));

  const geometry = [f({ positionsMm: [475, 1600, 2775], diaMm: 11.5 }), f({ markNo: 'R1', positionsMm: [25, 1500, 2975] }), f({ markNo: 'C1', kind: 'BEND', bendAngle: 90, count: 2 }), f({ markNo: 'C1', positionsMm: [25, 375] }), f({ markNo: 'R1', kind: 'WELD', weldType: 'FILLET', weldSize: 4, toConfirm: true })];
  const m = buildFabModel({ bom, header, geometry });
  assert.ok(!m.toConfirm.some((t) => /not defined/.test(t)), m.toConfirm.join('\n'));
  assert.ok(!m.toConfirm.some((t) => /Bend details/.test(t)));
  assert.ok(m.toConfirm.some((t) => /TO CONFIRM for: R1/.test(t)));
  const p1 = m.members.find((x) => x.markNo === 'P1')!;
  assert.deepEqual(p1.holes!.positionsMm, [475, 1600, 2775]);
  assert.equal(m.members.find((x) => x.markNo === 'C1')!.bendWeld, '2 bends');
  const row = m.cutting[0].rows.find((r) => r.markNo === 'P1')!;
  assert.equal(row.holes, '3 x 11.5');
  assert.equal(row.totalQty, 5 * 262);
  // Lengths never change.
  assert.deepEqual(m.cutting[0].rows.map((r) => r.lengthMm), plain.cutting[0].rows.map((r) => r.lengthMm));
  const pdf = await renderFabPdf(m);
  assert.ok(pdf.length > 1000);
});

test('unknown marks in the geometry are flagged', () => {
  const m = buildFabModel({ bom, header, geometry: [f({ markNo: 'X9', positionsMm: [10] })] });
  assert.ok(m.toConfirm.some((t) => /not in this BOM: X9/.test(t)));
});
