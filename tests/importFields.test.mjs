import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMPORT_FIELDS, pickFields, splitDuplicates } from '../lib/importFields.ts';

test('a CSV row cannot set ids or internal columns', () => {
  const row = { id: 'x', tenant_id: 'other', deleted_at: 'now', first_name: 'Ana' };
  assert.deepEqual(pickFields(row, IMPORT_FIELDS.clients), { first_name: 'Ana' });
});

test('catalog imports keep their fields', () => {
  const row = { name: 'Corte', type: 'service', price: 10, category_id: 'x' };
  assert.deepEqual(pickFields(row, IMPORT_FIELDS.services), { name: 'Corte', type: 'service', price: 10 });
});

test('a client matching by document, email or phone is a duplicate', () => {
  const existing = [{ document_number: '123', email: 'a@b.co', phone: '+57 300 111 2233' }];
  const { fresh, duplicates } = splitDuplicates('clients', [
    { first_name: 'A', document_number: ' 123 ' },
    { first_name: 'B', email: 'A@B.CO' },
    { first_name: 'C', phone: '57-300-111-2233' },
    { first_name: 'D', email: 'd@b.co' },
  ], existing);
  assert.equal(duplicates, 3);
  assert.deepEqual(fresh.map(r => r.first_name), ['D']);
});

test('repeats inside the same file are dropped', () => {
  const { fresh } = splitDuplicates('clients', [{ first_name: 'A', email: 'x@y.co' }, { first_name: 'B', email: 'x@y.co' }], []);
  assert.equal(fresh.length, 1);
});

test('name-only clients are never treated as duplicates', () => {
  const { fresh } = splitDuplicates('clients', [{ first_name: 'Ana' }, { first_name: 'Ana' }], [{ email: null }]);
  assert.equal(fresh.length, 2);
});

test('catalog items match by sku or by name and type', () => {
  const existing = [{ name: 'Corte', type: 'service', sku: 'S1' }];
  const { fresh } = splitDuplicates('services', [
    { name: 'Otro', type: 'service', sku: 's1' },
    { name: ' corte ', type: 'service' },
    { name: 'Corte', type: 'retail' },
  ], existing);
  assert.deepEqual(fresh.map(r => r.type), ['retail']);
});

test('categories match by name and type', () => {
  const { duplicates } = splitDuplicates('categories', [{ name: 'CABELLO' }, { name: 'Cabello', type: 'retail' }], [{ name: 'cabello', type: 'service' }]);
  assert.equal(duplicates, 1);
});
