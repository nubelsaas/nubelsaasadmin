import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedRegionFields, hasFinancialHistory } from '../lib/regionLock.ts';

const current = { country_iso: 'CO', currency_code: 'COP', timezone: 'America/Bogota', phone_prefix: '+57', phone: '1' };

function fakeDb(counts, failTable = null) {
  return {
    from: table => {
      const query = {
        select: () => query,
        eq: () => query,
        then: resolve => resolve(table === failTable ? { error: {} } : { count: counts[table] ?? 0 }),
      };
      return query;
    },
  };
}

test('saving the same region values is not a change', () => {
  assert.deepEqual(changedRegionFields(current, { ...current }), []);
});

test('a real change is detected and other fields are ignored', () => {
  assert.deepEqual(changedRegionFields(current, { currency_code: 'USD', phone: '2' }), ['currency_code']);
});

test('any financial table counts as history', async () => {
  assert.equal(await hasFinancialHistory(fakeDb({}), 't'), false);
  assert.equal(await hasFinancialHistory(fakeDb({ expenses_purchases: 1 }), 't'), true);
});

test('it fails closed when history cannot be read', async () => {
  await assert.rejects(hasFinancialHistory(fakeDb({}, 'transactions'), 't'));
});
