import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { EXPORT_SPECS, buildExportZip, readAllRows, toCsv } from '../lib/tenantExport.ts';

const SPEC = { file: 'x', table: 'x', description: '', columns: ['id'] };

function fakeDb(total, { pageLimit = 1000, error = null } = {}) {
  return {
    from: () => {
      const query = {
        select: () => query, eq: () => query, is: () => query, order: () => query,
        range: async (from, to) => ({
          error,
          count: total,
          data: Array.from({ length: Math.max(0, Math.min(to + 1, from + pageLimit, total) - from) }, (_, i) => ({ id: from + i })),
        }),
      };
      return query;
    },
  };
}

const cell = value => toCsv(['a'], [{ a: value }]).split('\r\n')[1];

test('values with commas, quotes and line breaks stay in one cell', () => {
  assert.equal(cell('Pérez, "Ana"'), '"Pérez, ""Ana"""');
  assert.equal(toCsv(['a'], [{ a: 'x\ny' }]).split('\r\n').length, 3);
});

test('text that Excel would run as a formula is neutralized', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1']) assert.ok(cell(value).startsWith("'") || cell(value).startsWith(`"'`), value);
});

test('phones and numbers are left alone', () => {
  assert.equal(cell('+57 300 123 4567'), '+57 300 123 4567');
  assert.equal(cell(-500), '-500');
  assert.equal(cell(null), '');
  assert.equal(cell(true), 'true');
});

test('CSV starts with a BOM for Excel', () => {
  assert.equal(toCsv(['a'], []).charCodeAt(0), 0xfeff);
});

test('every page of a large table is read', async () => {
  assert.equal((await readAllRows(fakeDb(2500), SPEC, 't')).length, 2500);
  assert.equal((await readAllRows(fakeDb(0), SPEC, 't')).length, 0);
});

test('a server limit below the page size still reads everything', async () => {
  assert.equal((await readAllRows(fakeDb(450, { pageLimit: 100 }), SPEC, 't')).length, 450);
});

test('a read error fails the export instead of skipping the table', async () => {
  await assert.rejects(readAllRows(fakeDb(5, { error: { message: 'x' } }), SPEC, 't'));
});

test('the allowed list never includes a sensitive column', () => {
  const banned = /pos_pin|payout|permissions|token|password|secret|authorization|search_normalized|photo|attachments/;
  for (const spec of EXPORT_SPECS) for (const column of spec.columns) assert.doesNotMatch(column, banned, `${spec.table}.${column}`);
  assert.ok(!EXPORT_SPECS.find(s => s.table === 'users').columns.includes('document_number'));
});

test('the ZIP has one CSV per table plus the readme', () => {
  const tables = Object.fromEntries(EXPORT_SPECS.map(spec => [spec.file, []]));
  tables.clientes = [{ id: '1', first_name: 'Ana' }];
  const { counts, zip } = buildExportZip('Salón', tables);
  const files = unzipSync(zip);

  assert.equal(counts.clientes, 1);
  assert.equal(Object.keys(files).length, EXPORT_SPECS.length + 1);
  assert.match(strFromU8(files['clientes.csv']), /Ana/);
  assert.match(strFromU8(files['LEEME.txt']), /clientes\.csv \(1 filas\)/);
});
