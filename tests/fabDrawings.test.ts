import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_STANDARDS, SP6_GAUGES, boltDia, finishNote, gaugeFor, holeDia, meshTack, mergeStandards, minEdge, sectionGeom } from '../src/lib/fabdrawing/standards';
import { buildFabModel, itemCodeOf, type FabBom, type FabBomLine, type FabHeader } from '../src/lib/fabdrawing/model';
import { renderFabPdf, sheetPlan } from '../src/lib/fabdrawing/render';
import { safeText } from '../src/lib/fabdrawing/primitives';

const KESCO_BOM = 'docs/m14-rev2-reference/Ceebuild_BOM_KESCo_DTR_Fencing_24-11-2026.xlsx';

// ---------------------------------------------------------------- standards (pure rules)

test('hole dia = bolt dia + 1.5', () => {
  assert.equal(holeDia('M10'), 11.5);
  assert.equal(holeDia('M12'), 13.5);
  assert.equal(holeDia('M16X40'), 17.5);
  assert.equal(holeDia(20), 21.5);
  assert.equal(boltDia('M10 bolt + nut + lock nut + washer set, Gr 4.6'), 10);
  assert.equal(boltDia('GI nut & bolt (mixed sizes)'), null);
  // Master overrides the default clearance.
  const stds = mergeStandards([{ kind: 'HOLE', key: 'CLEARANCE', numValue: 2, textValue: null, unit: 'mm', note: null }]);
  assert.equal(holeDia('M10', stds), 12);
});

test('IS SP:6 gauges by angle leg', () => {
  const want: Record<number, number> = { 40: 22, 45: 25, 50: 28, 55: 30, 60: 35, 65: 35, 70: 40, 75: 40, 80: 45, 90: 50, 100: 55 };
  for (const [leg, g] of Object.entries(want)) assert.equal(gaugeFor(Number(leg)), g, `leg ${leg}`);
  assert.equal(gaugeFor(35), null);
});

test('edge distance: 1.5 x hole, 25 on 50 mm flats', () => {
  assert.equal(minEdge(11.5), 17.5); // 17.25 rounded up to 0.5
  assert.equal(minEdge(17.5), 26.5);
  assert.equal(minEdge(11.5, 50), 25);
  assert.equal(minEdge(17.5, 50), 26.5); // the larger rule wins
});

test('mesh tack weld and finish notes', () => {
  assert.deepEqual({ l: meshTack().lengthMm, p: meshTack().pitchMm }, { l: 25, p: 150 });
  assert.match(finishNote({ galvanised: true, painted: false }), /IS 2629/);
  assert.match(finishNote({ galvanised: false, painted: true }), /primer/);
});

test('section shapes', () => {
  assert.deepEqual(sectionGeom('ISA 40x40x5'), { shape: 'ANGLE', a: 40, b: 40, t: 5 });
  assert.deepEqual(sectionGeom('FL 50x6'), { shape: 'FLAT', a: 50, b: null, t: 6 });
  assert.equal(sectionGeom('ISMC 75X40').shape, 'CHANNEL');
  assert.equal(sectionGeom('RB 16').shape, 'ROUND');
  assert.equal(sectionGeom('PIPE 25NB').shape, 'PIPE');
});

test('migration seed = DEFAULT_STANDARDS', () => {
  const dir = readdirSync('prisma/migrations').find((d) => d.endsWith('_m14_drawing_standards'));
  assert.ok(dir, 'migration folder');
  const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8');
  for (const s of DEFAULT_STANDARDS) {
    assert.ok(sql.includes(`('${s.kind}', '${s.key}',`), `seed row ${s.kind} ${s.key}`);
  }
  for (const [leg, g] of SP6_GAUGES) assert.ok(sql.includes(`('GAUGE', 'LEG_${leg}', ${g},`), `gauge ${leg}`);
});

test('text outside WinAnsi is replaced, not thrown', () => {
  assert.equal(safeText('L ≥ 25 ✓ ± Ø × °'), 'L >= 25 OK ± Ø × °');
  assert.equal(safeText('漢'), '?');
});

// ---------------------------------------------------------------- KESCo Type A (BOM xlsx)

/** BOM lines of one sheet of the KESCo BOM workbook, as the dashboard stores them. */
function kescoBom(sheet: 'BOM TYPE A' | 'BOM TYPE B'): { bom: FabBom; sets: number } {
  const wb = XLSX.readFile(KESCO_BOM);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.SUMMARY, { header: 1, raw: true, defval: null });
  const type = sheet.endsWith('A') ? 'A' : 'B';
  const sets = Number(summary.find((r) => r[0] === type)![5]);
  const lines: FabBomLine[] = [];
  let part: 'STEEL' | 'BO' | null = null;
  for (const r of rows) {
    if (r[0] === 'Sl' && r[3] === 'Section') part = 'STEEL';
    else if (r[0] === 'Sl' && r[3] === 'Unit') part = 'BO';
    else if (typeof r[0] === 'number' && part === 'STEEL') {
      lines.push({ groupId: 1, rowNo: lines.length + 1, markNo: String(r[1]), description: String(r[2]), section: String(r[3]), lengthMm: Number(r[4]), qtyPerSet: Number(r[5]), category: 'STRUCTURE', scope: 'IN_SCOPE', fabCat: 'WELDED' });
    } else if (typeof r[0] === 'number' && part === 'BO') {
      const desc = String(r[2]);
      lines.push({ groupId: 1, rowNo: lines.length + 1, markNo: String(r[1]), description: desc, section: null, lengthMm: null, qtyPerSet: Number(r[4]), category: /bolt/i.test(desc) ? 'NUTS_BOLTS' : 'BOUGHT_OUT', scope: 'IN_SCOPE', fabCat: null });
    }
  }
  return {
    sets,
    bom: {
      structureType: `DTR fencing Type ${type}`,
      drawingRef: 'Satwik approved drg (KESCo sign 19-09-2026); Ceebuild BOM 24-11-2026',
      galvanised: false,
      painted: true,
      fabType: 'WELDED',
      groups: [{ id: 1, name: `Type ${type} enclosure`, drawingNo: 'Satwik / KESCo 19-09-2026', sets }],
      lines,
    },
  };
}

const HEADER: FabHeader = {
  company: 'Ceebuild Company Pvt. Ltd.',
  project: 'KESCo (Kanpur) RDSS – DTR fencing Type A – Laser Power & Infra',
  clientCode: 'KESCo',
  itemCode: itemCodeOf('DTR fencing Type A'),
  rev: 0,
  date: '25-11-2026',
  basis: 'Satwik approved drg (KESCo sign 19-09-2026); Ceebuild BOM 24-11-2026',
  preparedBy: 'Puja Agarwal',
  checkedBy: null,
  approvedBy: null,
  status: 'DRAFT',
};

/** Text drawn on each page (pdf-lib writes Helvetica text as hex strings in Flate streams). */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(t[1], 'hex').toString('latin1'));
  }
  return out.join('\n');
}

test('KESCo Type A: renders 5 sheets; cutting list = BOM (per set and x 262)', async () => {
  const { bom, sets } = kescoBom('BOM TYPE A');
  assert.equal(sets, 262);
  assert.equal(HEADER.itemCode, 'FEN');
  const model = buildFabModel({
    bom,
    header: HEADER,
    standards: DEFAULT_STANDARDS,
    // Post holes as on Rev 0 (hole levels to be confirmed by production).
    features: [{ markNo: 'FCA-1', positionsMm: [475, 1600, 2775], source: 'DRAWING', toConfirm: true }],
  });

  // Cutting list rows = every steel line of the BOM, same mark / section / length / qty per set.
  const steel = bom.lines.filter((l) => l.category === 'STRUCTURE');
  assert.equal(steel.length, 10);
  assert.equal(model.cutting.length, 1);
  assert.deepEqual(
    model.cutting[0].rows.map((r) => [r.markNo, r.section, r.lengthMm, r.qtyPerSet, r.totalQty]),
    steel.map((l) => [l.markNo, l.section, l.lengthMm, l.qtyPerSet, l.qtyPerSet! * 262]),
  );
  const perSet = model.cutting[0].rows.reduce((a, r) => a + r.qtyPerSet!, 0);
  const total = model.totals.reduce((a, r) => a + r.totalQty!, 0);
  assert.equal(perSet, 56); // 5 + 9 + 3 + 3 + 26 + 3 + 2 + 3 + 1 + 1
  assert.equal(total, 56 * 262);
  assert.equal(model.totals.find((r) => r.markNo === 'FCV-1')!.totalQty, 26 * 262);
  // Bought-out / hardware listed, not cut.
  assert.deepEqual(model.other.map((o) => o.markNo), ['WF-1', 'HW-1', 'LT-1']);
  assert.equal(model.boltDiaMm, 10);

  // Design decisions from the standards; open points honest.
  assert.ok(model.decisions.some((d) => d.includes('11.5 dia (M10 + 1.5')));
  assert.ok(model.decisions.some((d) => d.includes('gauge line 22 mm')));
  assert.ok(model.decisions.some((d) => d.includes('tack weld 25 mm long @ 150 mm c/c')));
  assert.ok(model.toConfirm.some((t) => t.includes('FCH-1') && t.includes('not defined')));
  assert.ok(model.toConfirm.some((t) => t.includes('FCA-1') && t.includes('TO CONFIRM')));

  const bytes = await renderFabPdf(model);
  const pdf = await PDFDocument.load(bytes);
  // 1 general + ceil(10 marks / 4) member sheets + 1 cutting list = 5.
  assert.deepEqual(sheetPlan(model), { memberSheets: 3, cutSheets: 1, total: 5 });
  assert.equal(pdf.getPageCount(), 5);
  const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
  assert.ok(Math.abs(w - 1190.55) < 0.1 && Math.abs(h - 841.89) < 0.1, 'A3 landscape');

  const text = pdfText(bytes);
  for (let i = 1; i <= 5; i++) assert.ok(text.includes(`Drg no. CB/KESCo/FEN/0${i}`), `sheet ${i} drawing no`);
  assert.ok(text.includes('CEEBUILD COMPANY PVT. LTD.'));
  assert.ok(text.includes('TO BE CONFIRMED BY PRODUCTION BEFORE CUTTING'));
  assert.ok(text.includes('CUTTING LIST'));
  // Cutting list row FCV-1: 2350, 26 per set, 262 sets, 6812 total; and the pieces total row.
  assert.ok(/FCV-1\n.*\nFL 40x5\n2350\n26\n262\n6812\n/.test(text), 'FCV-1 row');
  assert.ok(/Pieces\n56\n262\n14672\n/.test(text), 'pieces total row');
});

test('KESCo Type B: 96 strips per set, totals x 99', async () => {
  const { bom, sets } = kescoBom('BOM TYPE B');
  assert.equal(sets, 99);
  const model = buildFabModel({ bom, header: { ...HEADER, project: 'KESCo DTR fencing Type B' } });
  assert.equal(model.totals.find((r) => r.markNo === 'FCV-1')!.totalQty, 96 * 99);
  assert.equal(model.totals.reduce((a, r) => a + r.totalQty!, 0), 131 * 99);
  const pdf = await PDFDocument.load(await renderFabPdf(model));
  assert.equal(pdf.getPageCount(), 5);
});

test('mixed BOM: totals add the same mark over structures; no sets = to confirm', () => {
  const line = (groupId: number, markNo: string, qty: number): FabBomLine => ({ groupId, rowNo: 1, markNo, description: 'x', section: 'ISA 50x50x6', lengthMm: 1000, qtyPerSet: qty, category: 'STRUCTURE', scope: 'IN_SCOPE', fabCat: null });
  const model = buildFabModel({
    header: HEADER,
    bom: {
      structureType: 'Mixed',
      drawingRef: null,
      galvanised: true,
      painted: false,
      fabType: 'PLAIN_CUT',
      groups: [
        { id: 1, name: 'S1', drawingNo: null, sets: 2 },
        { id: 2, name: 'S2', drawingNo: null, sets: 3 },
        { id: 3, name: 'S3', drawingNo: null, sets: null },
      ],
      lines: [line(1, 'A1', 4), line(2, 'A1', 1), line(3, 'B1', 1)],
    },
  });
  assert.equal(model.totals.find((r) => r.markNo === 'A1')!.totalQty, 11);
  assert.equal(model.totals.find((r) => r.markNo === 'B1')!.totalQty, null);
  assert.ok(model.toConfirm.some((t) => t.includes('Set count not on the BOM for: S3')));
  assert.ok(model.decisions.some((d) => d.includes('no bolt size')));
});
