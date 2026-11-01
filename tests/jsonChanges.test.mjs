import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyJsonChanges, diffJson, isJsonChanges } from '../lib/jsonChanges.ts';

test('only changed keys are sent', () => {
  assert.deepEqual(diffJson({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 2 }, c: 3 }), { set: { b: { x: 2 }, c: 3 }, remove: [] });
});

test('removed keys are listed', () => {
  assert.deepEqual(diffJson({ a: 1, b: 2 }, { a: 1 }), { set: {}, remove: ['b'] });
});

test('no changes produce an empty diff', () => {
  assert.deepEqual(diffJson(null, {}), { set: {}, remove: [] });
});

test('applying keeps keys someone else wrote', () => {
  const stored = { mine: false, theirs: ['x'], gone: true };
  assert.deepEqual(applyJsonChanges(stored, { set: { mine: true }, remove: ['gone'] }), { mine: true, theirs: ['x'] });
});

test('malformed changes are rejected', () => {
  assert.equal(isJsonChanges({ set: {}, remove: [] }), true);
  for (const value of [null, {}, { set: [], remove: [] }, { set: {}, remove: 'a' }, { set: {}, remove: [1] }]) assert.equal(isJsonChanges(value), false);
});
