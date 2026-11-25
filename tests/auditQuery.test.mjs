import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAuditFilters, compactDetails, exportFileName, readAuditFilters } from '../lib/auditQuery.ts';

/** Builder falso que anota cada filtro. */
const builder = () => {
  const calls = [];
  const q = new Proxy({}, { get: (_, op) => (...args) => { calls.push(`${String(op)}(${args.join(',')})`); return q; } });
  return { q, calls };
};
const params = obj => name => obj[name];

test('reads filters and ignores malformed dates', () => {
  const f = readAuditFilters(params({ tenantId: ' t1 ', action: '', from: '2026-11-01', to: '11/30/2026', views: '1' }));
  assert.deepEqual(f, { tenantId: 't1', action: null, table: null, from: '2026-11-01', to: null, views: true });
});

test('tenant view filters on timestamp and table', () => {
  const { q, calls } = builder();
  applyAuditFilters(q, 'tenant', { tenantId: 't', action: 'UPDATE', table: 'sales', from: '2026-11-01', to: '2026-11-30', views: false });
  assert.deepEqual(calls, ['eq(tenant_id,t)', 'ilike(action,%UPDATE%)', 'ilike(table_name,%sales%)', 'gte(timestamp,2026-11-01)', 'lte(timestamp,2026-11-30T23:59:59Z)']);
});

test('admin view hides views unless asked or filtering by action', () => {
  const run = f => { const { q, calls } = builder(); applyAuditFilters(q, 'admin', { tenantId: null, action: null, table: 'x', from: null, to: null, views: false, ...f }); return calls; };
  assert.deepEqual(run({}), ['not(action,like,view.%)'], 'table filter does not apply to admin view');
  assert.deepEqual(run({ views: true }), []);
  assert.deepEqual(run({ action: 'view.tenant' }), ['ilike(action,%view.tenant%)']);
  assert.deepEqual(run({ from: '2026-11-01' }).at(-1), 'gte(created_at,2026-11-01)');
});

test('import ids become a count', () => {
  assert.deepEqual(compactDetails({ entity: 'customers', ids: ['a', 'b', 'c'] }), { entity: 'customers', ids: 3 });
  assert.deepEqual(compactDetails({ reason: 'x' }), { reason: 'x' });
  assert.equal(compactDetails(null), null);
});

test('file name says which view and dates', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  assert.equal(exportFileName('admin', { from: null, to: null }, now), 'audit-admin-actions-2026-11-25.csv');
  assert.equal(exportFileName('tenant', { from: '2026-11-01', to: null }, now), 'audit-tenant-activity-2026-11-01_to_now-2026-11-25.csv');
});
