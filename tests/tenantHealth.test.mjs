import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, QUIET_DAYS } from '../lib/healthStatus.ts';

const NOW = Date.parse('2026-11-12T00:00:00Z');
const DAY = 86_400_000;
const base = { suspended: false, lastSale: new Date(NOW - DAY).toISOString(), revenue30: 100, revenuePrev30: 100 };

test('a selling salon is active', () => assert.equal(classify(base, NOW), 'active'));

test('a salon that never sold is new, not quiet', () => assert.equal(classify({ ...base, lastSale: null }, NOW), 'new'));

test('no sales for longer than the limit is quiet', () => {
  assert.equal(classify({ ...base, lastSale: new Date(NOW - (QUIET_DAYS + 1) * DAY).toISOString() }, NOW), 'quiet');
  assert.equal(classify({ ...base, lastSale: new Date(NOW - (QUIET_DAYS - 1) * DAY).toISOString() }, NOW), 'active');
});

test('revenue below half of the previous 30 days is declining', () => {
  assert.equal(classify({ ...base, revenue30: 40 }, NOW), 'declining');
  assert.equal(classify({ ...base, revenue30: 60 }, NOW), 'active');
  assert.equal(classify({ ...base, revenue30: 0, revenuePrev30: 0 }, NOW), 'active');
});

test('suspension wins over everything else', () => assert.equal(classify({ ...base, suspended: true, lastSale: null }, NOW), 'suspended'));
