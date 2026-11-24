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
    { description: 'GI material', hsn: '7308', unit: 'MT', qty: 100, unitRate: 78000, lineValue: 7_900_000, qtyVarPct: null, confidence: 'high' as const },
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
  // "AKS_Revised Price.pdf" is OUR revised offer, not the PO (GM review of intake 3).
  assert.deepEqual(aks.map((f) => f.kind), ['DRAWING', 'OFFER', 'PO', 'DRAWING', 'DRAWING', 'BOM']);

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

// ---------------------------------------------------------------- GM review of intake 3 (AKS / UPCL revised PO 14(A))

import { drawingNumbersOnly, ownCompanyHit, ownContactsFromEnv } from '../src/lib/po/normalise';
import { gstPctFor, hsnFor } from '../src/lib/po/hsn';
import { enrichExtraction } from '../src/lib/po/enrich';
import { parseUnitWeight } from '../src/lib/po/checks';
import { splitThread, threadForAi } from '../src/lib/mailThread';

const AKS_410: DocketCandidate['items'] = [
  { id: 2310, name: 'Rod type Earthing of pole by MS Rod with clamp 40x3 mm, bolt', uom: 'Nos', qty: '12', price: '1180', qtnUom: 'Nos' },
  { id: 2312, name: '11kv Danger board with clamp', uom: 'Nos', qty: '3', price: '300', qtnUom: 'Nos' },
  { id: 2318, name: '33 kv Danger board with clamp', uom: 'Nos', qty: '2', price: '550', qtnUom: 'PCS' },
];
const AKS_419: DocketCandidate['items'] = [
  { id: 15, name: '33 kV Danger board with clamp Bolts & Nuts [Weight: 3 KG/NO]', uom: 'NOS', qty: '2', price: '650', qtnUom: 'EA', wt: '3 KG/NO' },
  { id: 19, name: '11 kV Danger Board with Clamp with N&B  [Weight: 2.5 KG/NO]', uom: 'NOS', qty: '3', price: '550', qtnUom: 'EA', wt: '2.5 KG/NO' },
  { id: 25, name: 'Rod type earthing of pole by MS earthing rod with welded\nClamp', uom: 'NOS', qty: '12', price: '750', qtnUom: 'NOS', wt: '16 KG/NO' },
  { id: 27, name: 'Galvanised M.S. Channel 125x65x6 mm. (for frabrication of lid support)', uom: 'KG', qty: '1662.64', price: '87', qtnUom: 'KG', wt: '13.1 KG/Mtr' },
  { id: 32, name: 'Supply and installation of GI earth strip 25x6mm for\nconnection', uom: 'Mtr', qty: '3200', price: '87', qtnUom: 'KG', wt: '1.18 KG/Mtr' },
  { id: 36, name: '8 SWG GI wire [Weight: 0.40 KG/Mtr]', uom: 'KG', qty: '6', price: '89', qtnUom: 'KG', wt: '0.40 KG/Mtr' },
  { id: 8, name: '33 kV top channel 125x65x6mm 3.2 mtr. Long with all fixing\narrangement', uom: 'NOS', qty: '4', price: '87', qtnUom: 'KG', wt: '48 KG/NO' },
];
const line = (description: string, unit: string, qty: number, unitRate: number) => ({ description, hsn: null, unit, qty, unitRate, lineValue: Math.round(qty * unitRate), qtyVarPct: null, confidence: 'high' as const });

test('GM #1: our revised price offer is OFFER, the revised PO stays PO', () => {
  assert.equal(guessKind('AKS_Revised Price.pdf'), 'OFFER');
  assert.equal(guessKind('Ceebuild Revised_ 2PO-14(A).pdf'), 'PO');
  assert.equal(guessKind('Revised PO price.pdf'), 'PO');
  assert.equal(guessKind('Corporate profile.pdf'), 'PO'); // unnamed PDF stays PO ("rate" inside a word is not an offer)
});

test('GM #2: the thread goes to the AI in date order, latest marked, oldest dropped first', () => {
  const body = [
    '--- Message 1 From: Ceebuild Info <info@ceebuildcompany.com> ---',
    'Dear Sir, we are unable to accept the revised Purchase Order at the existing price.',
    '',
    '--- Message 2 From: "AKS VENTURES PVT. LTD" <buyer@example.com> ---',
    'Please find the revised PO 14(A) at your re-quoted rates.',
    'Thanks and Regards, Ravi Kumar 9000000001',
    '    On Monday, 28 September 2026 at 01:23:57 pm IST, Ceebuild Info <info@ceebuildcompany.com> wrote:',
    '> unable to accept',
    '',
    '--- Message 3 From: Ceebuild Info <info@ceebuildcompany.com> ---',
    'Sir, kindly confirm the drawing at the earliest.',
    'On Tue, Sep 29, 2026 at 11:00 AM AKS VENTURES PVT. LTD <buyer@example.com> wrote:',
    '> revised PO',
  ].join('\n');
  const msgs = splitThread(body, '2026-11-16 06:24:38', 3);
  assert.deepEqual(msgs.map((m) => m.date), ['2026-09-28', '2026-09-29', '2026-11-16']);
  assert.ok(!msgs[1].text.includes('unable to accept'), 'quoted text removed');
  const t = threadForAi(body, '2026-11-16 06:24:38', 3);
  assert.ok(t.indexOf('Message 1 of 3') < t.indexOf('Message 3 of 3 (LATEST) – 16-11-2026'));
  // Long thread: the newest message is always kept, the oldest go.
  const long = threadForAi(body.replace('Dear Sir,', 'Dear Sir, ' + 'x'.repeat(3000)), '2026-11-16', 3, 400);
  assert.ok(long.includes('(LATEST)') && !long.includes('Message 1 of 3'));
});

test('GM #3: our own person / phone never fills the customer contact', () => {
  // Our people / phones come from the PO_OWN_CONTACTS server setting (personal data stays out of the code).
  const own = ownContactsFromEnv('Asha Sen; Asha Sharma Sen; 9000000099');
  assert.ok(ownCompanyHit('Miss Asha Sen', own));
  assert.ok(ownCompanyHit('Ms. ASHA SEN', own));
  assert.ok(ownCompanyHit('+91 90000 00099', own));
  assert.ok(ownCompanyHit('info@ceebuildcompany.com', own));
  assert.ok(ownCompanyHit('Ceebuild Company (P) Ltd', own));
  assert.equal(ownCompanyHit('Ravi Kumar', own), null);
  assert.equal(ownCompanyHit('Ashan Sena', own), null);
  process.env.PO_OWN_CONTACTS = 'Asha Sen; 9000000099';
  const e = normaliseExtraction(
    {
      documentType: 'PURCHASE_ORDER',
      fields: { contactPerson: { value: 'Miss Asha Sen', confidence: 'high' }, contactPhone: { value: '9000000099', confidence: 'high' }, contactEmail: { value: 'buyer@example.com', confidence: 'high' } },
      lines: [],
      bomPieces: [],
      warnings: [],
    },
    'test',
  );
  assert.equal(e.fields.contactPerson.value, null);
  assert.equal(e.fields.contactPerson.confidence, 'missing');
  assert.equal(e.fields.contactPhone.value, null);
  assert.equal(e.fields.contactEmail.value, 'buyer@example.com');
  delete process.env.PO_OWN_CONTACTS;
});

test('GM #4/#5: same-party dockets first, latest revision chosen, rates per offer price unit', () => {
  const ranked = rankDockets(
    { customer: 'AKS VENTURES PVT. LIMITED', endClient: 'Uttarakhand Power Corporation Limited (UPCL)', project: null, lines: [line('11 kV Danger Board with Clamp', 'NOS', 209, 650)] },
    [
      { id: 108, docketNo: 'CEE-000410', party: 'AKS VETURES PVT. LIMITED', utility: 'UPCL', state: null, items: AKS_410, hasBom: false, orders: 0 },
      { id: 117, docketNo: 'CEE-000419', party: 'AKS VETURES PVT. LIMITED', utility: 'UPCL', state: null, items: AKS_419, hasBom: false, orders: 0 },
      { id: 200, docketNo: 'CEE-000500', party: 'PIR PANCHAL CONSTRUCTION', utility: 'UPCL', state: null, items: AKS_419, hasBom: true, orders: 0 },
    ],
  );
  assert.deepEqual(
    ranked.map((r) => [r.docketNo, r.group]),
    [
      ['CEE-000419', 'SAME_PARTY'],
      ['CEE-000410', 'SAME_PARTY'],
      ['CEE-000500', 'OTHER'],
    ],
  );

  const priced = matchQuotedItems(
    [
      line('33 kV Danger board with clamp', 'NOS', 7, 650),
      line('11 kV Danger Board with Clamp', 'NOS', 209, 650),
      line('Rod type earthing of pole by Gl earthing rod 200x2500mm with welded Clamp', 'NOS', 751, 750),
      line('Galvanised M.S. Channel 125x65x6 mm. (for frabrication of lid support', 'KG', 1785.5, 96.5),
      line('8 SWG Gl wire', 'KG', 29, 96.5),
      line('Supply and installation of Gl earth strip 25x6mm for connection of earth', 'KG', 2244, 96.5),
      line('33 kV top channel 125x65x6mm 3.2 mtr. Long', 'NOS', 4, 4500),
      line('Polymer insulator 11 kV', 'NOS', 10, 900),
    ],
    AKS_419,
  );
  const pct = priced.map((l) => compareRate(l)?.diffPct ?? null);
  assert.deepEqual(pct.slice(0, 2), [0, 18.2]); // vs 650 / 550 of the revised offer, not 300 of CEE-000410
  assert.equal(pct[2], 0); // rod earthing 750 vs 750 (not 1180)
  assert.equal(pct[3], 10.9); // per kg: 96.5 vs 87
  assert.equal(priced[4].quotedRate, 89); // "Gl" = GI, matched
  assert.equal(compareRate(priced[5])?.basis, 'per KG'); // offer item counted in Mtr but priced per KG (uom_of_qtn)
  assert.equal(compareRate(priced[6])?.basis, 'per kg (unit wt 48 kg/NOS)'); // PO per NOS vs quote per KG
  assert.equal(compareRate(priced[6])?.poPerKg, 93.75);
  assert.equal(priced[7].quotedItemId, null);
  const checks = runPoChecks({ fields: { customerName: 'AKS', poNumber: 'P', poDate: '2026-09-29' }, lines: priced, today: '2026-11-24', leadTimeDays: 45, offer: { docketNo: 'CEE-000419', items: AKS_419.length } });
  assert.deepEqual(checks.filter((c) => c.code === 'NOT_IN_OFFER').map((c) => c.target), ['line:7']);
  assert.deepEqual(parseUnitWeight('68 KG/NO'), { kg: 68, per: 'NOS' });
});

test('GM #7: drawing / GTP no. holds numbers only, never an item list', () => {
  const items = 'G.I. Wire 4.00 mm.; G.I. Wire 5.00 mm.; G.I. Stay Wire 7/3.15 mm.; SPIKE TYPE EARTHING WITH CLAMP; DANGER SIGN PLATE (11kV & 33kV)';
  assert.equal(drawingNumbersOnly(items).value, null);
  assert.equal(drawingNumbersOnly('UPCL/DRG/11KV/05 R1; GTP-AKS-03; G.I. Wire 4.00 mm').value, 'UPCL/DRG/11KV/05 R1; GTP-AKS-03');
});

test('GM #8/#9/#11: HSN from the item master, GST 18% as per law, proposed delivery date', () => {
  assert.equal(hsnFor('33 kV Danger board with clamp')?.hsn, '8310');
  assert.equal(hsnFor('Anti-Climbing Device (2.5mm dia (12SWG) galvanized barbed wire')?.hsn, '7313');
  assert.equal(hsnFor('8 SWG Gl wire')?.hsn, '7217');
  assert.equal(hsnFor('G.I. Stay Wire 7/3.15 mm')?.hsn, '7312');
  assert.equal(hsnFor('11 KV Cross bracing Set 50x50x6mm with Belting angle')?.hsn, '7308');
  assert.equal(gstPctFor('7308'), 18);
  const raw = normaliseExtraction(
    {
      documentType: 'REVISED_OR_AMENDED_PO',
      fields: { poDate: { value: '29-09-2026', confidence: 'high' }, basicValue: { value: '1929257', confidence: 'high' }, gstPct: { value: null, confidence: 'high', note: 'GST extra at actual' } },
      lines: [
        { description: '11 kV Danger Board with Clamp', unit: 'Nos', qty: '209', unitRate: '650', lineValue: '135850', confidence: 'high' },
        { description: 'Polymer thing', unit: 'Nos', qty: '1', unitRate: '1', lineValue: '1', confidence: 'high' },
      ],
      bomPieces: [],
      warnings: [],
    },
    'test',
  );
  const { extraction: e, proposedCompletion } = enrichExtraction(raw, { leadTimeDays: 45 });
  assert.deepEqual([e.lines[0].hsn, e.lines[0].hsnSource, e.lines[1].hsn], ['8310', 'MASTER', null]);
  assert.equal(e.fields.gstPct.value, '18');
  assert.equal(e.fields.gstPct.confidence, 'low');
  assert.ok(/as per law/.test(e.fields.gstPct.note ?? ''));
  assert.equal(e.fields.gstAmount.value, '347266.26');
  assert.equal(e.fields.totalValue.value, '2276523.26');
  assert.equal(e.fields.completionDate.value, null); // stays yellow until accepted
  assert.equal(proposedCompletion?.date, '2026-11-13');
  const hsn = runPoChecks({ fields: { customerName: 'A', poNumber: 'P', poDate: '2026-09-29' }, lines: e.lines, today: '2026-09-29', leadTimeDays: 45 }).filter((c) => c.code === 'HSN');
  assert.deepEqual(hsn.map((c) => c.target), ['line:1']);
});

test('Gemini schema stays at its size limit: document types / pending / latest come back as tagged warnings', () => {
  const e = normaliseExtraction(
    {
      documentType: 'REVISED_OR_AMENDED_PO',
      fields: {},
      lines: [],
      bomPieces: [],
      warnings: ['DOC: OFFER | Revised Price.pdf', 'DOC: PO | Buyer PO 14(A).pdf', 'PENDING: Drawing confirmation | 16-11-2026 | Buyer', 'LATEST: 16-11-2026: revised PO issued; drawing pending', 'Total differs by Rs 1'],
    },
    'test',
  );
  assert.deepEqual(e.documents?.map((d) => [d.type, d.name]), [['OFFER', 'Revised Price.pdf'], ['PO', 'Buyer PO 14(A).pdf']]);
  assert.deepEqual(e.pending, [{ item: 'Drawing confirmation', since: '2026-11-16', by: 'Buyer' }]);
  assert.equal(e.latestPosition, '16-11-2026: revised PO issued; drawing pending');
  assert.deepEqual(e.warnings, ['Total differs by Rs 1']);
});
