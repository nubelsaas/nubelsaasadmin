import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCloneRun, getUndoStatus } from '../lib/cloneUndo.ts';

const T0 = Date.parse('2026-11-01T00:00:00Z');
const MIN = 60_000;

function fakeDb({ action = null, activity = 0, failTable = null, readError = false } = {}) {
  return {
    from(table) {
      const query = {
        select: () => query, eq: () => query, like: () => query, order: () => query, gt: () => query,
        limit: async () => readError
          ? { error: {} }
          : { data: action ? [{ action, created_at: new Date(T0).toISOString() }] : [] },
        then: resolve => resolve(table === failTable ? { error: {} } : { count: activity }),
      };
      return query;
    },
  };
}

test('no history or a finished rollback leaves nothing to undo', async () => {
  assert.equal((await getCloneRun(fakeDb(), 't', T0)).state, 'none');
  assert.equal((await getCloneRun(fakeDb({ action: 'clone.rollback_finished' }), 't', T0)).state, 'none');
});

test('a run without an end is running for 15 minutes, then interrupted', async () => {
  const db = fakeDb({ action: 'clone.onboarding' });
  assert.equal((await getCloneRun(db, 't', T0 + 14 * MIN)).state, 'running');
  assert.deepEqual(await getCloneRun(db, 't', T0 + 16 * MIN), { state: 'interrupted', since: T0 + 15 * MIN });
});

test('Undo stays closed while a rollback runs', async () => {
  assert.equal((await getUndoStatus(fakeDb({ action: 'clone.rollback' }), 't', T0 + MIN)).available, false);
});

test('a failed rollback can be retried right away', async () => {
  assert.equal((await getUndoStatus(fakeDb({ action: 'clone.rollback_failed' }), 't', T0 + 1)).available, true);
});

test('a finished clone can be undone for 1 hour', async () => {
  const db = fakeDb({ action: 'clone.finished' });
  assert.equal((await getUndoStatus(db, 't', T0 + 59 * MIN)).available, true);
  assert.equal((await getUndoStatus(db, 't', T0 + 61 * MIN)).available, false);
});

test('an interrupted clone has no time limit', async () => {
  const db = fakeDb({ action: 'clone.demo' });
  assert.equal((await getUndoStatus(db, 't', T0 + 3 * 1440 * MIN)).available, true);
});

test('new activity blocks Undo', async () => {
  assert.equal((await getUndoStatus(fakeDb({ action: 'clone.finished', activity: 2 }), 't', T0 + MIN)).available, false);
});

test('Undo fails closed when it cannot verify', async () => {
  await assert.rejects(getUndoStatus(fakeDb({ action: 'clone.finished', failTable: 'transactions' }), 't', T0 + MIN));
  await assert.rejects(getUndoStatus(fakeDb({ readError: true }), 't', T0 + MIN));
});
