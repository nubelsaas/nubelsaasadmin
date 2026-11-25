import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FILTERS, filterTenants, filtersFromParams, filtersToParams, matchesSearch, normalize, sortTenants,
} from '../lib/tenantFilters.ts';

const t = (over) => ({
  id: over.id, name: over.name ?? over.id, admin_email: null, created_at: '2026-01-01T00:00:00Z',
  country_iso: 'CO', suspended_at: null, plan_id: 'pro', ...over,
});

const tenants = [
  t({ id: 'a', name: 'Peluquería Ana', admin_email: 'ana@salon.co', created_at: '2026-03-01T00:00:00Z' }),
  t({ id: 'b', name: 'Barber Bob', country_iso: 'US', plan_id: 'basic', created_at: '2026-05-01T00:00:00Z' }),
  t({ id: 'c', name: 'Casa Clara', suspended_at: '2026-10-01T00:00:00Z', plan_id: null, country_iso: null }),
];
const ids = (list) => list.map(x => x.id);
const f = (over) => ({ ...DEFAULT_FILTERS, ...over });

test('normalize drops accents and case', () => assert.equal(normalize('  PeluquERÍA '), 'peluqueria'));

test('search matches name without accents, and the contact email', () => {
  assert.ok(matchesSearch(tenants[0], 'peluqueria'));
  assert.ok(matchesSearch(tenants[0], 'ana@salon'));
  assert.ok(!matchesSearch(tenants[1], 'peluqueria'));
});

test('every word must match, in any order', () => {
  assert.ok(matchesSearch(tenants[0], 'ana pelu'));
  assert.ok(!matchesSearch(tenants[0], 'ana barber'));
});

test('characters that are special in SQL LIKE are plain text', () => {
  assert.ok(!matchesSearch(tenants[0], '%'));
  assert.ok(!matchesSearch(tenants[0], '_'));
});

test('empty search keeps everything', () => assert.deepEqual(ids(filterTenants(tenants, f({ search: '  ' }))), ['a', 'b', 'c']));

test('plan filter, including salons without a plan', () => {
  assert.deepEqual(ids(filterTenants(tenants, f({ plan: 'basic' }))), ['b']);
  assert.deepEqual(ids(filterTenants(tenants, f({ plan: 'none' }))), ['c']);
});

test('status filter', () => {
  assert.deepEqual(ids(filterTenants(tenants, f({ status: 'suspended' }))), ['c']);
  assert.deepEqual(ids(filterTenants(tenants, f({ status: 'active' }))), ['a', 'b']);
});

test('country filter, including salons without a country', () => {
  assert.deepEqual(ids(filterTenants(tenants, f({ country: 'US' }))), ['b']);
  assert.deepEqual(ids(filterTenants(tenants, f({ country: 'none' }))), ['c']);
});

test('health filter uses the summary, and hides salons whose health is not loaded', () => {
  const health = {
    a: { status: 'active', needsAttention: false },
    b: { status: 'quiet', needsAttention: true },
  };
  assert.deepEqual(ids(filterTenants(tenants, f({ health: 'quiet' }), health)), ['b']);
  assert.deepEqual(ids(filterTenants(tenants, f({ health: 'attention' }), health)), ['b']);
  assert.deepEqual(ids(filterTenants(tenants, f({ health: 'active' }))), []);
});

test('setup filter: incomplete and stuck, hidden while not loaded', () => {
  const setup = { a: { complete: true, stuck: false }, b: { complete: false, stuck: false }, c: { complete: false, stuck: true } };
  assert.deepEqual(ids(filterTenants(tenants, f({ setup: 'incomplete' }), undefined, setup)), ['b', 'c']);
  assert.deepEqual(ids(filterTenants(tenants, f({ setup: 'stuck' }), undefined, setup)), ['c']);
  assert.deepEqual(ids(filterTenants(tenants, f({ setup: 'stuck' }))), []);
});

test('filters combine', () => {
  assert.deepEqual(ids(filterTenants(tenants, f({ country: 'CO', status: 'active' }))), ['a']);
});

test('sort by name ignores accents and case; by date with name as tie-break', () => {
  assert.deepEqual(ids(sortTenants(tenants, 'name')), ['b', 'c', 'a']);
  assert.deepEqual(ids(sortTenants(tenants, 'newest')), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortTenants(tenants, 'oldest')), ['c', 'a', 'b']);
});

test('sorting does not change the input', () => {
  const copy = [...tenants];
  sortTenants(tenants, 'newest');
  assert.deepEqual(tenants, copy);
});

test('URL round trip keeps only non-default values', () => {
  const filters = f({ search: 'ana', status: 'suspended', setup: 'stuck', sort: 'newest' });
  const query = filtersToParams(filters);
  assert.equal(query, 'q=ana&status=suspended&setup=stuck&sort=newest');
  assert.deepEqual(filtersFromParams(new URLSearchParams(query)), filters);
  assert.equal(filtersToParams(DEFAULT_FILTERS), '');
});

test('unknown URL values fall back to the default', () => {
  const parsed = filtersFromParams(new URLSearchParams('status=deleted&sort=random&health=great&setup=x'));
  assert.equal(parsed.setup, 'all');
  assert.equal(parsed.status, 'all');
  assert.equal(parsed.sort, 'name');
  assert.equal(parsed.health, 'all');
});
