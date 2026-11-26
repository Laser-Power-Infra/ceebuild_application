import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSIONED, parseFieldValue, valuesAsOn, withValidTo, todayIst, storeValue, fieldSpec } from '../src/lib/masters/versions';

const rows = [
  { id: 1, recordKey: 'ISA50X50X6', field: 'kgPerM', value: '4.5', validFrom: '2000-01-01' },
  { id: 2, recordKey: 'ISA50X50X6', field: 'kgPerM', value: '4.6', validFrom: '2026-11-01' },
  { id: 3, recordKey: 'ISA50X50X6', field: 'kgPerM', value: '4.7', validFrom: '2026-12-15' },
  { id: 4, recordKey: 'ISA50X50X6', field: 'grade', value: 'E250', validFrom: '2026-11-20' },
  { id: 5, recordKey: 'ISA50X50X6', field: 'kgPerM', value: '4.55', validFrom: '2026-11-01' },
];

test('as on: latest version on or before the date; later entry wins on the same date', () => {
  assert.equal(valuesAsOn(rows, '2026-10-31').get('ISA50X50X6')!.get('kgPerM'), '4.5');
  assert.equal(valuesAsOn(rows, '2026-11-01').get('ISA50X50X6')!.get('kgPerM'), '4.55');
  assert.equal(valuesAsOn(rows, '2026-12-14').get('ISA50X50X6')!.get('kgPerM'), '4.55');
  assert.equal(valuesAsOn(rows, '2026-12-15').get('ISA50X50X6')!.get('kgPerM'), '4.7');
  assert.equal(valuesAsOn(rows, '2026-11-19').get('ISA50X50X6')!.has('grade'), false);
  assert.equal(valuesAsOn(rows, '1999-01-01').size, 0);
});

test('valid to = day before the next version of the same field', () => {
  const v = withValidTo(rows);
  assert.equal(v.find((r) => r.id === 1)!.validTo, '2026-10-31');
  assert.equal(v.find((r) => r.id === 5)!.validTo, '2026-12-14');
  assert.equal(v.find((r) => r.id === 3)!.validTo, null);
  assert.equal(v.find((r) => r.id === 4)!.validTo, null);
});

test('field values are validated against the master limits', () => {
  const kgm = fieldSpec('section_master', 'kgPerM')!;
  assert.deepEqual(parseFieldValue(kgm, '4.65'), { value: '4.65' });
  assert.ok('error' in parseFieldValue(kgm, '0'));
  assert.ok('error' in parseFieldValue(fieldSpec('machines', 'shiftsPerDay')!, '1.5'));
  assert.deepEqual(parseFieldValue(fieldSpec('machines', 'active')!, 'No'), { value: 'false' });
  assert.deepEqual(parseFieldValue(fieldSpec('section_master', 'maxBarMm')!, ''), { value: null });
  assert.ok(VERSIONED.plan_settings.fields.some((f) => f.key === 'kerfMm'));
});

test('stored values and the plant day', () => {
  assert.equal(storeValue({ toNumber: () => 9.56 }), '9.56');
  assert.equal(storeValue(''), null);
  assert.equal(storeValue(true), 'true');
  assert.equal(todayIst(new Date('2026-11-26T20:00:00Z')), '2026-11-27');
});
