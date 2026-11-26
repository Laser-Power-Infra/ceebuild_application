import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveDate, threadHandled } from '../src/lib/po/threadHandled';

const at = (s: string) => new Date(s);

test('archive date without zone is read as UTC', () => {
  assert.equal(archiveDate('2026-11-26 05:43:03')?.toISOString(), '2026-11-26T05:43:03.000Z');
  assert.equal(archiveDate(''), null);
  assert.equal(archiveDate('junk'), null);
});

test('new thread is read; read / confirmed threads are not', () => {
  assert.equal(threadHandled([], at('2026-11-26T05:00:00Z')), false);
  assert.equal(threadHandled([{ status: 'EXTRACTED', createdAt: at('2026-11-20T00:00:00Z') }], at('2026-11-26T05:00:00Z')), true);
  assert.equal(threadHandled([{ status: 'CONFIRMED', createdAt: at('2026-11-20T00:00:00Z') }], null), true);
});

test('discarded thread opens again only on a newer message (UPCL second lot after a bounce)', () => {
  const bounce = [{ status: 'DISCARDED', createdAt: at('2026-11-25T13:04:29Z') }];
  assert.equal(threadHandled(bounce, at('2026-11-25T12:00:00Z')), true);
  assert.equal(threadHandled(bounce, at('2026-11-26T05:43:03Z')), false);
  assert.equal(threadHandled(bounce, null), true);
  const three = [1, 2, 3].map((d) => ({ status: 'DISCARDED', createdAt: at(`2026-11-2${d}T00:00:00Z`) }));
  assert.equal(threadHandled(three, at('2026-11-30T00:00:00Z')), true);
});

test('failed readings retried until three fails', () => {
  const f = (n: number) => Array.from({ length: n }, () => ({ status: 'FAILED', createdAt: at('2026-11-25T00:00:00Z') }));
  assert.equal(threadHandled(f(2), at('2026-11-24T00:00:00Z')), false);
  assert.equal(threadHandled(f(3), at('2026-11-26T00:00:00Z')), true);
});
