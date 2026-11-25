import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloneStepTotal, makeTracker, parseSse, progressPercent } from '../lib/cloneProgress.ts';

test('step totals per mode follow the tables actually included', () => {
  assert.equal(cloneStepTotal('onboarding', 10), 11);
  assert.equal(cloneStepTotal('onboarding', 7), 8, 'skipped tables are not counted');
  assert.equal(cloneStepTotal('demo', 11), 17);
  assert.equal(cloneStepTotal('rollback', 20), 20);
});

test('tracker counts up and never passes the total', () => {
  const seen = [];
  const step = makeTracker('onboarding', 2, p => seen.push(p));
  step('a'); step('b'); step('extra');
  assert.deepEqual(seen.map(p => `${p.done}/${p.total} ${p.label}`), ['0/2 Starting', '1/2 a', '2/2 b', '2/2 extra']);
});

test('percent', () => {
  assert.equal(progressPercent(null), 0);
  assert.equal(progressPercent({ phase: 'demo', done: 1, total: 3, label: '' }), 33);
  assert.equal(progressPercent({ phase: 'demo', done: 3, total: 3, label: '' }), 100);
});

test('SSE parsing keeps a half-received event for the next chunk', () => {
  const first = parseSse('data: line one\n\nevent: progress\ndata: {"done":1');
  assert.deepEqual(first.events, [{ event: 'message', data: 'line one' }]);
  const second = parseSse(first.rest + ',"total":4}\n\ndata: ✓  roles: 2 rows\n\n');
  assert.deepEqual(second.events, [{ event: 'progress', data: '{"done":1,"total":4}' }, { event: 'message', data: '✓  roles: 2 rows' }]);
  assert.equal(second.rest, '');
});

test('a log line that starts with a space keeps it after the one separator space', () => {
  assert.equal(parseSse('data:    ✓ 3 sales\n\n').events[0].data, '   ✓ 3 sales');
});
