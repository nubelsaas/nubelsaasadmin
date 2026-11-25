import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRequirements, diffSnapshots, parseSnapshot, summarize } from '../lib/schemaDiff.ts';

const col = (name, type = 'text', nullable = true, def = null) => ({ name, type, nullable, default: def });
const snap = (over = {}) => ({
  source: 'catalog', env: 'dev', project: 'x', generated_at: '',
  tables: {
    tenants: { rls: true, columns: [col('id', 'uuid', false, 'gen_random_uuid()'), col('name', 'text', false), col('suspended_at', 'timestamp with time zone')] },
    users: { rls: true, columns: [col('id', 'uuid', false)] },
  },
  views: ['v_sales'],
  functions: [{ name: 'f', args: 'p uuid', returns: 'void', security_definer: true, hash: 'a' }],
  triggers: [{ table: 'tenants', name: 'trg', enabled: true, hash: 't' }],
  policies: [{ schema: 'public', table: 'users', name: 'p', cmd: 'SELECT', permissive: 'PERMISSIVE', hash: 'p' }],
  indexes: [{ table: 'users', name: 'users_pkey', hash: 'i' }],
  enums: { level: ['a', 'b'] },
  extensions: { pg_trgm: '1.6' },
  ...over,
});
const keys = items => items.map(i => `${i.category}:${i.kind}:${i.name}`).sort();

test('identical snapshots have no differences', () => {
  assert.deepEqual(diffSnapshots(snap(), snap()), []);
});

test('missing table and column on each side', () => {
  const prod = snap({ tables: { tenants: { rls: true, columns: [col('id', 'uuid', false, 'gen_random_uuid()'), col('name', 'text', false)] } } });
  assert.deepEqual(keys(diffSnapshots(snap(), prod)), ['column:only_here:tenants.suspended_at', 'table:only_here:users']);
  assert.deepEqual(keys(diffSnapshots(prod, snap())), ['column:only_there:tenants.suspended_at', 'table:only_there:users']);
});

test('column type, nullability, default and RLS changes', () => {
  const other = snap();
  other.tables = structuredClone(other.tables);
  other.tables.tenants.columns[1] = col('name', 'character varying', false);
  other.tables.tenants.columns[2] = col('suspended_at', 'timestamp with time zone', false);
  other.tables.tenants.columns[0] = col('id', 'uuid', false, null);
  other.tables.users.rls = false;
  const d = diffSnapshots(snap(), other);
  assert.deepEqual(keys(d), ['column:changed:tenants.id', 'column:changed:tenants.name', 'column:changed:tenants.suspended_at', 'rls:changed:users']);
  assert.match(d.find(i => i.name === 'tenants.name').detail, /type text vs character varying/);
});

test('function body, security definer, overloads, triggers, policies, indexes, enums, extensions', () => {
  const other = snap({
    functions: [
      { name: 'f', args: 'p uuid', returns: 'void', security_definer: false, hash: 'a' },
      { name: 'f', args: 'p uuid, q int', returns: 'void', security_definer: true, hash: 'b' },
    ],
    triggers: [{ table: 'tenants', name: 'trg', enabled: false, hash: 't' }],
    policies: [{ schema: 'public', table: 'users', name: 'p', cmd: 'SELECT', permissive: 'PERMISSIVE', hash: 'changed' }],
    indexes: [],
    enums: { level: ['a', 'b', 'c'] },
    extensions: { pg_trgm: '1.5' },
    views: [],
  });
  assert.deepEqual(keys(diffSnapshots(snap(), other)), [
    'enum:changed:level', 'extension:changed:pg_trgm', 'function:changed:f(p uuid)', 'function:only_there:f(p uuid, q int)',
    'index:only_here:users.users_pkey', 'policy:changed:public.users: p', 'trigger:changed:tenants.trg', 'view:only_here:v_sales',
  ]);
});

test('against an API-only snapshot, only names are compared', () => {
  const api = snap({
    source: 'api', views: [], triggers: [], policies: [], indexes: [], enums: {}, extensions: {},
    functions: [{ name: 'f', args: '', returns: '', security_definer: false, hash: '' }, { name: 'g', args: '', returns: '', security_definer: false, hash: '' }],
  });
  api.tables = structuredClone(api.tables);
  api.tables.tenants.columns[1] = col('name', 'character varying', true);
  api.tables.users.rls = null;
  api.tables.v_sales = { rls: null, columns: [] };   // la API lista las vistas como tablas
  assert.deepEqual(keys(diffSnapshots(snap(), api)), ['function:only_there:g']);
});

test('against the API: views count as tables and trigger functions are skipped', () => {
  const cat = snap({ functions: [
    { name: 'f', args: 'p uuid', returns: 'void', security_definer: true, hash: 'a' },
    { name: 'trg_fn', args: '', returns: 'trigger', security_definer: false, hash: 'b' },
  ] });
  const api = snap({
    source: 'api', views: [], triggers: [], policies: [], indexes: [], enums: {}, extensions: {},
    functions: [{ name: 'f', args: '', returns: '', security_definer: false, hash: '' }],
  });
  api.tables = { ...structuredClone(api.tables), v_sales: { rls: null, columns: [] } };
  assert.deepEqual(keys(diffSnapshots(cat, api)), []);
});

test('summary counts by category', () => {
  const s = summarize([{ category: 'table', kind: 'only_here', name: 'a' }, { category: 'table', kind: 'changed', name: 'b' }]);
  assert.deepEqual(s.table, { only_here: 1, only_there: 0, changed: 1 });
  assert.deepEqual(s.policy, { only_here: 0, only_there: 0, changed: 0 });
});

test('portal requirements: tables, columns and functions', () => {
  const r = checkRequirements(snap(), [
    { kind: 'column', name: 'tenants.suspended_at', breaks: '', source: '' },
    { kind: 'column', name: 'tenants.plan_id', breaks: '', source: '' },
    { kind: 'table', name: 'admin_tenant_notes', breaks: '', source: '' },
    { kind: 'function', name: 'f', breaks: '', source: '' },
  ]);
  assert.deepEqual(r.map(x => x.ok), [true, false, false, true]);
});

test('uploaded file must look like a snapshot', () => {
  assert.equal(parseSnapshot('not json'), null);
  assert.equal(parseSnapshot('{"tables":{}}'), null);
  const s = parseSnapshot(JSON.stringify({ source: 'api', tables: {}, functions: [] }));
  assert.deepEqual(s.policies, []);
});
