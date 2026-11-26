import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMailStatus, orderFileKind, orderNeeds, type OrderFacts } from '../src/lib/orders/mailCheck';

test('order mail attachments are typed from their names', () => {
  assert.equal(orderFileKind('A126Y-033_MFG_CLEARANCE_Ceebuild_Bongaigaon-17.37 MT.pdf'), 'MC');
  assert.equal(orderFileKind('BT26Y-035_DISP_INSTRUCTION_Bongaigaon_Ceebuild.pdf'), 'DI');
  assert.equal(orderFileKind('AIIB Drawings.rar'), 'DRAWING');
  assert.equal(orderFileKind('BD26Y-00022_PO_Bongaigaon-I_Ceebuild_MT-17.37.pdf'), 'PO');
  assert.equal(orderFileKind('Cutting BOM Type A.xlsx'), 'BOM');
  assert.equal(orderFileKind('image001.png'), 'SKIP');
});

const base: OrderFacts = {
  poNumber: 'BD26Y-00022', client: 'LASER POWER & INFRA LTD.', docketNo: 'CEE-000535', docketParty: 'LASER POWER & INFRA LTD.', docketUtility: null,
  endClient: 'APDCL', project: 'AIIB BONGAIGAON', deliveryDue: null, contractValue: 1785459, gstPct: 18, paymentTerms: '100% within 30 days',
  advancePct: null, contactPerson: 'X', contactEmail: null, contactPhone: null, deliveryAddress: 'Nalbari', customerGstin: '18AAACL4776D2ZG',
  drawingStatus: null, onHold: true, holdReason: 'Inspection call pending', jobStatus: 'ON_HOLD', jobNote: null, bomConfirmed: false, bomUploads: 0,
  documents: [{ kind: 'OTHER', fileName: 'A126Y-033_MFG_CLEARANCE_Ceebuild.pdf' }], sameDocketOrders: ['BG26Y-00007'],
};

test('checklist: docket doubts, missing PO data, MC from the file, drawing / BOM from the mails', () => {
  const m = normaliseMailStatus(
    { mc: { status: 'DONE', ref: 'A126Y-033' }, drawing: { status: 'DONE', date: '12-11-2026' }, bom: { status: 'PENDING', note: 'BOM awaited from Laser' }, pending: [{ item: 'Signed PO copy', who: 'Ceebuild' }], latest: '12-11-2026: DI issued.' },
    { model: 'm', at: 'now', threads: 1 },
  );
  const r = orderNeeds(base, m);
  const items = r.needs.map((n) => n.item);
  assert.ok(items.includes('Docket check'));
  assert.ok(items.includes('Same docket on other orders'));
  assert.ok(r.needs.find((n) => n.item.startsWith('PO details'))?.note.includes('delivery / completion date'));
  assert.ok(r.have.some((h) => h.startsWith('Manufacturing clearance')));
  assert.ok(r.have.some((h) => h.startsWith('Drawing / GTP approved')));
  assert.equal(r.needs.find((n) => n.item === 'BOM')?.from, 'Customer');
  assert.equal(r.needs.find((n) => n.item === 'Signed PO copy')?.from, 'Puja (Admin)');
  // Customer vs docket party mismatch (APDCL typed as the customer on a Laser docket).
  assert.ok(orderNeeds({ ...base, client: 'ASSAM POWER DISTRIBUTION COMPANY LTD.' }, m).needs.some((n) => n.item === 'Customer name vs docket'));
  // No mail read yet.
  assert.ok(orderNeeds(base, null).needs.some((n) => n.item === 'Mail check'));
});
