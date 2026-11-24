import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gstinCheckChar, normGstin, normUnit, normaliseExtraction, parseDate, parseMoney, parsePct, poKey } from '../src/lib/po/normalise';
import { compareRate, matchQuotedItems, nameSimilarity, rankDockets, runPoChecks, type DocketCandidate } from '../src/lib/po/checks';
import { PO_FIELDS, needsReview } from '../src/lib/po/fields';

test('parseDate reads Indian day-first and written dates', () => {
  assert.equal(parseDate('13-11-2026'), '2026-11-13');
  assert.equal(parseDate('13.11.26'), '2026-11-13');
  assert.equal(parseDate('13/11/2026'), '2026-11-13');
  assert.equal(parseDate('29th Sep 2026'), '2026-09-29');
  assert.equal(parseDate('29-Sept-2026'), '2026-09-29');
  assert.equal(parseDate('1 October, 2026'), '2026-10-01');
  assert.equal(parseDate('Nov 13, 2026'), '2026-11-13');
  assert.equal(parseDate('2026-11-13'), '2026-11-13');
  assert.equal(parseDate('31-02-2026'), null);
  assert.equal(parseDate('within 60 days'), null);
});

test('parseMoney handles Rs, commas, /-, lakh and crore', () => {
  assert.equal(parseMoney('Rs. 78,00,000.00/-'), 7800000);
  assert.equal(parseMoney('₹ 1,23,456.5'), 123456.5);
  assert.equal(parseMoney('78.5 Lakh'), 7850000);
  assert.equal(parseMoney('1.2 Cr'), 12000000);
  assert.equal(parseMoney('INR 500'), 500);
  assert.equal(parseMoney('as per actual'), null);
});

test('parsePct reads single and split GST and variation', () => {
  assert.equal(parsePct('18%'), 18);
  assert.equal(parsePct('IGST @ 18 %'), 18);
  assert.equal(parsePct('CGST 9% + SGST 9%'), 18);
  assert.equal(parsePct('±25%'), 25);
  assert.equal(parsePct('+/- 10'), 10);
  assert.equal(parsePct('150%'), null);
});

test('GSTIN check digit is verified', () => {
  const first14 = '19AABCC1234D1Z';
  const good = first14 + gstinCheckChar(first14);
  assert.equal(normGstin(good.toLowerCase()).valid, true);
  assert.equal(normGstin(good).value, good);
  const bad = first14 + (good[14] === 'A' ? 'B' : 'A');
  assert.equal(normGstin(bad).valid, false);
  assert.equal(normGstin('27AAPFU0939F1ZV').valid, true);
});

test('normUnit maps common units', () => {
  assert.equal(normUnit('MTs'), 'MT');
  assert.equal(normUnit('Nos.'), 'NOS');
  assert.equal(normUnit('Set'), 'SETS');
  assert.equal(normUnit('Kgs'), 'KG');
  assert.equal(normUnit('Rmt'), 'MTR');
});

test('normaliseExtraction cleans values and flags what it cannot read', () => {
  const e = normaliseExtraction(
    {
      documentType: 'PURCHASE_ORDER',
      fields: {
        customerName: { value: 'Lanarsy Infra Ltd', confidence: 'high' },
        customerGstin: { value: '36AAPFU0939F1ZV', confidence: 'high' }, // wrong check digit for 36
        poNumber: { value: 'LIL/SBPDCL/RDSS/GI Fabrication Material/2026-27/112', confidence: 'high' },
        poDate: { value: '13.11.2026', confidence: 'high' },
        basicValue: { value: 'Rs 78,00,000/-', confidence: 'high' },
        gstPct: { value: '18%', confidence: 'high' },
        completionDate: { value: 'within 60 days', confidence: 'medium' },
        state: { value: 'N/A', confidence: 'low' },
      },
      lines: [{ description: '11 kV GI fabrication material', unit: 'MT', qty: '100', unitRate: '78,000', lineValue: '78,00,000', qtyVariation: '±25%', confidence: 'high' }],
      bomPieces: [{ markNo: 'A1', section: 'ISA 50x50x6', lengthMm: '1200', qtyPerSet: '2', sets: '10' }],
      warnings: [],
    },
    'test-model',
  );
  assert.equal(e.fields.poDate.value, '2026-11-13');
  assert.equal(e.fields.basicValue.value, '7800000.00');
  assert.equal(e.fields.customerGstin.confidence, 'low');
  assert.equal(e.fields.completionDate.confidence, 'low');
  assert.equal(e.fields.gstAmount.value, '1404000.00');
  assert.equal(e.fields.gstAmount.confidence, 'low');
  assert.equal(e.fields.state.value, 'Telangana'); // from the GSTIN state code
  assert.equal(e.fields.amendmentNo.confidence, 'missing');
  assert.equal(needsReview(e.fields.amendmentNo), true);
  assert.equal(needsReview(e.fields.poNumber), false);
  assert.equal(e.lines[0].qtyVarPct, 25);
  assert.equal(e.bomPieces[0].totalQty, 20);
  assert.equal(Object.keys(e.fields).length, PO_FIELDS.length);
});

test('runPoChecks flags line, GST, total and delivery mismatches and blocks duplicates', () => {
  const lines = [
    { description: 'GI material', hsn: null, unit: 'MT', qty: 100, unitRate: 78000, lineValue: 7_900_000, qtyVarPct: null, confidence: 'high' as const },
  ];
  const checks = runPoChecks({
    fields: { customerName: 'X', poNumber: 'P1', poDate: '2026-11-13', basicValue: '7800000', gstPct: '18', gstAmount: '1500000', totalValue: '9300000', completionDate: '2026-12-01' },
    lines,
    today: '2026-11-23',
    leadTimeDays: 45,
    duplicateOf: { poNumber: 'P1', orderId: 7 },
  });
  const codes = checks.map((c) => c.code).sort();
  assert.deepEqual(codes, ['BASIC_TOTAL', 'DELIVERY', 'DUPLICATE', 'GST', 'LINE_TOTAL']);
  assert.equal(checks.find((c) => c.code === 'DUPLICATE')?.level, 'block');

  const clean = runPoChecks({
    fields: { customerName: 'X', poNumber: 'P1', poDate: '2026-11-13', basicValue: '7800000', gstPct: '18', gstAmount: '1404000', totalValue: '9204000', completionDate: '2027-03-31' },
    lines: [{ ...lines[0], lineValue: 7_800_000 }],
    today: '2026-11-23',
    leadTimeDays: 45,
  });
  assert.deepEqual(clean, []);
});

test('rate comparison works across per-MT and per-kg quoting', () => {
  assert.deepEqual(compareRate({ unitRate: 78000, unit: 'MT', quotedRate: 77, quotedUom: 'MT' }), { diffPct: 1.3, basis: 'per kg' });
  assert.deepEqual(compareRate({ unitRate: 76, unit: 'KG', quotedRate: 77000, quotedUom: 'MT' }), { diffPct: -1.3, basis: 'per kg' });
  assert.deepEqual(compareRate({ unitRate: 1100, unit: 'NOS', quotedRate: 1000, quotedUom: 'NOS' }), { diffPct: 10, basis: 'per NOS' });
  assert.equal(compareRate({ unitRate: 1100, unit: 'NOS', quotedRate: null, quotedUom: null }), null);
});

test('company names match through Pvt/Ltd and typos', () => {
  assert.equal(nameSimilarity('AKS Ventures Pvt. Ltd', 'AKS VETURES PVT. LIMITED'), 1);
  assert.equal(nameSimilarity('LCC Engineering Ltd', 'LCC ENGINEERING PVT. LTD.'), 1);
  assert.ok(nameSimilarity('Lanarsy Infra Ltd', 'Konstelec Engineers Limited') < 0.2);
  assert.equal(poKey('Lanarsy Infra Ltd', 'LIL/112'), poKey('LANARSY INFRA LIMITED', 'lil-112'));
});

test('rankDockets prefers the same party, utility and quantity', () => {
  const d = (id: number, party: string, utility: string, items: DocketCandidate['items'], hasBom = false): DocketCandidate => ({ id, docketNo: `CEE-${id}`, party, utility, state: null, items, hasBom, orders: 0 });
  const ranked = rankDockets(
    { customer: 'Lanarsy Infra Ltd', endClient: 'SBPDCL', project: 'RDSS', lines: [{ description: '11 kV GI fabricated structures', qty: 100, unit: 'MT' }] },
    [
      d(70, 'LANARSY INFRA LIMITED', 'SBPDCL', [{ id: 1, name: 'Stay Set (Galvanised)', uom: 'NOS', qty: '18896', price: '1550' }]),
      d(394, 'LANARSY INFRA LIMITED', 'SBPDCL', [{ id: 2, name: 'GI Fabricated Structures', uom: 'KG', qty: '100000', price: '88' }], true),
      d(17, 'KONSTELEC ENGINEERS LIMITED', 'UPCL', []),
    ],
  );
  assert.equal(ranked[0].id, 394);
  assert.ok(!ranked.some((r) => r.id === 17));
});

test('matchQuotedItems attaches our rate to the closest item', () => {
  const out = matchQuotedItems(
    [{ description: 'GI fabricated structure material', hsn: null, unit: 'MT', qty: 100, unitRate: 78000, lineValue: 7800000, qtyVarPct: null, confidence: 'high' }],
    [
      { id: 5, name: 'Stay set', uom: 'NOS', qty: '10', price: '1550' },
      { id: 6, name: 'GI Fabricated Structures', uom: 'MT', qty: '101.24', price: '77' },
    ],
  );
  assert.equal(out[0].quotedItemId, 6);
  assert.equal(out[0].quotedRate, 77);
  assert.equal(out[0].quotedUom, 'MT');
});

// ---------------------------------------------------------------- mail archive attachments (n8n intake)
import { guessKind, pairFiles } from '../src/lib/mailFiles';

test('mail archive: names pair with Drive links, kinds guessed (real threads)', () => {
  // AKS revised PO thread: one name contains ", " ("Pkg-C, GA Drawings ...").
  const aks = pairFiles(
    'GTP-AKS-Ceebuild-GI Wire (1).pdf, AKS_Revised Price.pdf, Ceebuild Revised_ 2PO-14(A).pdf, CEEBUILD APPROVED DRAWING.pdf, Pkg-C, GA Drawings (DP Structure).pdf, CLARIFICATION_ENQ-2627-0008_BOM-2627-0003.xlsx',
    'https://drive.google.com/file/d/1MPsvYQBEm5AY7E8Q6jkgcjr6A-hcPL53/view?usp=drivesdk, https://drive.google.com/file/d/1uGgGVFaKRksM8wT9Ul5v0YOVCF55vhx7/view?usp=drivesdk, https://drive.google.com/file/d/1XtGupIyTxIkQxI-OrCKhfNY0YBY2-01e/view?usp=drivesdk, https://drive.google.com/file/d/1wihWDKiWS2_0sDorY_-6yyL04G_iSEKQ/view?usp=drivesdk, https://drive.google.com/file/d/1KjX3_nYt_9EsrotIgComNZplLWF6SjCi/view?usp=drivesdk, https://docs.google.com/spreadsheets/d/120FYWj05jsintr4qAEaILU1o-udewsA5/edit?usp=drivesdk&ouid=117778473744408507379&rtpof=true&sd=true',
  );
  assert.equal(aks.length, 6);
  assert.equal(aks[4].name, 'Pkg-C, GA Drawings (DP Structure).pdf');
  assert.equal(aks[4].driveId, '1KjX3_nYt_9EsrotIgComNZplLWF6SjCi');
  assert.equal(aks[5].driveId, '120FYWj05jsintr4qAEaILU1o-udewsA5');
  assert.deepEqual(aks.map((f) => f.kind), ['DRAWING', 'PO', 'PO', 'DRAWING', 'DRAWING', 'BOM']);

  // Lanarsy: PO + BOM; the mail's icons are skipped.
  const lan = pairFiles(
    'Cee Build PO.pdf, icon.png, warning_triangle.png, Cee Build BOM 11Kv Fab SBPDCL.xlsx',
    'https://drive.google.com/file/d/1vw2H_3ywHki0im2oYtOkDOKLtifbtgdW/view?usp=drivesdk, https://drive.google.com/file/d/1VRfnJFTl8rO-AT0u0Z-uYB9NjPlO7LFp/view?usp=drivesdk, https://drive.google.com/file/d/1G_dFOGGjEBiYS7-c-j2koMWRSL2Jf6jd/view?usp=drivesdk, https://docs.google.com/spreadsheets/d/1-d-1R--7IMaUhSzlnVnBlZqPK1APJxfC/edit?usp=drivesdk&ouid=1&rtpof=true&sd=true',
  );
  assert.deepEqual(lan.map((f) => f.kind), ['PO', 'SKIP', 'SKIP', 'BOM']);
  assert.equal(lan[0].driveId, '1vw2H_3ywHki0im2oYtOkDOKLtifbtgdW');

  // LCC: PO named only by number; drawing; BOM workbook; screenshots are not POs.
  assert.equal(guessKind('42008150 - CEEBUILD COMPANY PVT LTD - 7100..pdf'), 'PO');
  assert.equal(guessKind('CIP Approved MSDSS Supporting Structures Drawings.pdf'), 'DRAWING');
  assert.equal(guessKind('MSDSS_Detailed_BOM_Rev1_with_Junction_Boxes.xlsx'), 'BOM');
  assert.equal(guessKind('image.png'), 'SKIP');
  assert.equal(guessKind('Screenshot 2026-10-07 164904.png'), 'OTHER');
  assert.equal(guessKind('Re: Bills.eml'), 'SKIP');
  assert.deepEqual(pairFiles('[No Attachments]', ''), []);
});
