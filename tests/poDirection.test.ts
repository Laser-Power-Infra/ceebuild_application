import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerFromSender, issuedByUs, mailSkipReason, senderFromWarnings } from '../src/lib/po/direction';
import { guardOwnFields } from '../src/lib/po/normalise';
import { PO_FIELD_KEYS, type PoFieldKey, type PoFieldValue } from '../src/lib/po/fields';

const po = (o: Partial<{ poNumber: string; customerName: string; deliveryAddress: string; endClient: string; project: string }>) => ({
  poNumber: o.poNumber ?? null,
  customerName: o.customerName ?? null,
  deliveryAddress: o.deliveryAddress ?? null,
  endClient: o.endClient ?? null,
  project: o.project ?? null,
});

test('our own POs to suppliers and bounces are not received POs', () => {
  assert.ok(mailSkipReason('P.O-125/Durga Trading Company/FLAT AND SQUARE BAR/5-11-26').skip);
  assert.ok(mailSkipReason('Re: CEEBUILD-P.O REQUIRED-DURGA TRADING-5-11-26').skip);
  assert.ok(mailSkipReason('Delivery Status Notification (Failure)', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>').skip);
  assert.ok(!mailSkipReason('Re: Purchase Order for 100 MT of 11 kV GI Fabrication Materials – SBPDCL-RDSS Project').skip);
  assert.ok(!mailSkipReason('Fwd: Purchase order & Manufacturing Clearance for supply of GI line structural items AIIB').skip);
  assert.ok(!mailSkipReason('RE: Order Confirmation Mail for Galvanized steel structure for Chelligada').skip);

  assert.match(issuedByUs(po({ poNumber: 'CB-PO/125/2026-27', customerName: 'DURGA TRADING COMPANY' })) ?? '', /our own PO number/);
  assert.match(issuedByUs(po({ poNumber: 'X1', customerName: 'Durga', deliveryAddress: 'CLIPCON COMPLEX, NH-6, DHULAGORE, SANKRAIL HOWRAH' })) ?? '', /our own works/);
  // A customer PO for a project is received even if an address mentions our works.
  assert.equal(issuedByUs(po({ poNumber: 'LIL/SBPDCL/RDSS/112', customerName: 'Lanarsy', deliveryAddress: 'Site, Dhulagarh', project: 'SBPDCL-RDSS' })), null);
  assert.equal(issuedByUs(po({ poNumber: 'BD26Y-00022', customerName: 'LASER POWER & INFRA LTD.', deliveryAddress: 'Nalbari, Assam', endClient: 'APDCL' })), null);
});

test('customer from the mail sender (company display names only, never ours)', () => {
  assert.equal(customerFromSender('Lanarsy Infra Limited <anup@lanarsy.com>'), 'Lanarsy Infra Limited');
  assert.equal(customerFromSender('Bivas Mondal <bivas@laserpowerinfra.com>'), null);
  assert.equal(customerFromSender('Ramakrishna Kintada <rk@lanarsy.com>'), null);
  assert.equal(senderFromWarnings(['x', 'Read by n8n from the mail "Re: PO" (Lanarsy Infra Limited <a@lanarsy.com>).']), 'Lanarsy Infra Limited <a@lanarsy.com>');
});

test('Laser Power & Infra can be the buyer; Ceebuild (and "Cee Bulid") never', () => {
  const blank = () => Object.fromEntries(PO_FIELD_KEYS.map((k) => [k, { value: null, confidence: 'missing' }])) as unknown as Record<PoFieldKey, PoFieldValue>;
  const f = blank();
  f.customerName = { value: 'LASER POWER & INFRA LTD.', confidence: 'high' };
  f.contactEmail = { value: 'someone@laserpowerinfra.com', confidence: 'high' };
  guardOwnFields(f, { people: [], phones: [] });
  assert.equal(f.customerName.value, 'LASER POWER & INFRA LTD.');
  assert.equal(f.contactEmail.value, null);

  const g = blank();
  g.customerName = { value: 'M/s. Cee Bulid company Pvt.Ltd.', confidence: 'high' };
  guardOwnFields(g, { people: [], phones: [] });
  assert.equal(g.customerName.value, null);

  // Older readings blanked Laser: the value comes back from the note.
  const h = blank();
  h.customerName = { value: null, confidence: 'missing', note: 'AI read "LASER POWER & INFRA LTD." – that is our own company; enter the customer\'s own' };
  guardOwnFields(h, { people: [], phones: [] });
  assert.equal(h.customerName.value, 'LASER POWER & INFRA LTD.');
});

import { autoDocketPick, type DocketMatch } from '../src/lib/po/checks';

const dm = (id: number, no: string, utility: string | null, reasons: string[], group: 'SAME_PARTY' | 'OTHER' = 'SAME_PARTY'): DocketMatch => ({
  id, docketNo: no, party: 'X', utility, score: 0, reasons, hasBom: false, orders: 0, group, relevant: group === 'SAME_PARTY',
});

test('orders are made automatically only with an unambiguous docket', () => {
  // Latest revision with (about) the best item match: picked (AKS 419 vs 410).
  const aks = [dm(2, 'CEE-000419', 'UPCL', ['utility UPCL', 'items match 98%']), dm(1, 'CEE-000410', 'UPCL', ['utility UPCL', 'items match 100%'])];
  assert.equal(autoDocketPick(aks, { endClient: 'UPCL', project: null }).pick?.docketNo, 'CEE-000419');
  // Several offers for the utility and no clear item match: a person chooses.
  const laser = [dm(5, 'CEE-000535', null, ['items match 62%']), dm(4, 'CEE-000530', 'AIIB Project APDCL', ['utility AIIB Project APDCL']), dm(3, 'CEE-000529', 'AIIB Project APDCL', ['utility AIIB Project APDCL'])];
  const l = autoDocketPick(laser, { endClient: 'APDCL', project: null });
  assert.equal(l.pick, null);
  // A newer offer with no utility may be the revision: no automatic pick.
  const lcc = [dm(9, 'CEE-000523', null, ['items match 74%']), dm(8, 'CEE-000512', 'Chheligada', ['utility Chheligada'])];
  assert.equal(autoDocketPick(lcc, { endClient: null, project: 'CHELLIGADA' }).pick, null);
  // Offers made long after the PO date are not what it answers.
  const dates = new Map([[2, '2026-11-17'], [1, '2026-08-26']]);
  assert.equal(autoDocketPick(aks, { endClient: 'UPCL', project: null, poDate: '2026-08-25' }, dates).pick?.docketNo, 'CEE-000410');
  assert.equal(autoDocketPick([dm(7, 'CEE-1', 'X', [], 'OTHER')], { endClient: null, project: null }).pick, null);
});

test('exact PO rates name the offer; bulk-load docket dates are not offer dates', () => {
  const r = (id: number, no: string, utility: string | null, exact: number, lines: number, reasons: string[] = []): DocketMatch => ({ ...dm(id, no, utility, reasons), rateExact: exact, rateLines: lines });
  // UPCL second lot (26-11): only CEE-000414 has the PO's rates; newer Laser offers for other utilities do not.
  const laser = [r(30, 'CEE-000524', 'AIIB Project APDCL', 0, 12, ['items match 72%']), r(20, 'CEE-000422', 'DHBVN', 1, 12), r(12, 'CEE-000414', 'UPCL', 7, 12, ['utility UPCL'])];
  const dates = new Map([[30, '2026-09-20'], [20, '2026-08-26'], [12, '2026-08-26']]);
  const p = autoDocketPick(laser, { endClient: 'UPCL', project: null, poDate: '2026-05-16' }, dates);
  assert.equal(p.pick?.docketNo, 'CEE-000414');
  assert.match(p.why, /7 of 12/);
  // Two offers with the same rates: a person chooses.
  const tie = [r(2, 'CEE-2', 'UPCL', 4, 10), r(1, 'CEE-1', 'UPCL', 3, 10)];
  assert.equal(autoDocketPick(tie, { endClient: 'UPCL', project: null }).pick?.docketNo ?? null, null);
  // One-line POs (one rate) are not enough on their own.
  const one = [r(2, 'CEE-2', null, 1, 1, ['items match 40%']), r(1, 'CEE-1', null, 1, 1, ['items match 40%'])];
  assert.equal(autoDocketPick(one, { endClient: null, project: null }).pick, null);
  // A known (after 01-09-2026) docket date long after the PO still rules the offer out.
  const late = [r(9, 'CEE-000530', 'UPCL', 5, 6)];
  assert.equal(autoDocketPick(late, { endClient: 'UPCL', project: null, poDate: '2026-08-01' }, new Map([[9, '2026-10-30']])).pick, null);
});
