import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IMPORT_FIELDS, pickFields } from '../lib/importFields.ts';

test('a CSV row cannot set ids or internal columns', () => {
  const row = { id: 'x', tenant_id: 'other', deleted_at: 'now', first_name: 'Ana' };
  assert.deepEqual(pickFields(row, IMPORT_FIELDS.clients), { first_name: 'Ana' });
});

test('catalog imports keep their fields', () => {
  const row = { name: 'Corte', type: 'service', price: 10, category_id: 'x' };
  assert.deepEqual(pickFields(row, IMPORT_FIELDS.services), { name: 'Corte', type: 'service', price: 10 });
});
