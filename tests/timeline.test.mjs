import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTimeline } from '../lib/timeline.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const base = { tenantCreatedAt: '2026-01-01T00:00:00Z', audit: [], notes: [], sessions: [], announcements: [], now: NOW };

test('a new salon has only its creation', () => {
  assert.deepEqual(buildTimeline(base).map(i => i.title), ['Salon created']);
});

test('merges every source, newest first', () => {
  const items = buildTimeline({
    ...base,
    audit: [{ id: '1', action: 'tenant.suspend', admin_email: 'a@x', details: { reason: 'No pago' }, created_at: '2026-11-20T00:00:00Z' }],
    notes: [{ id: 'n', body: 'Llamé a la dueña', author_email: 'b@x', pinned: true, created_at: '2026-11-22T00:00:00Z' }],
    sessions: [{ session_id: 's', admin_email: 'c@x', target_email: 'owner@salon', reason: 'Ayuda con caja', created_at: '2026-11-21T00:00:00Z', ended_at: null, ended_by_email: null }],
    announcements: [{ id: 'an', title: 'Mantenimiento', level: 'warning', starts_at: '2026-11-23T00:00:00Z', ends_at: null, ended_at: null, owners_only: true, seen: 2, dismissed: 1 }],
  });
  assert.deepEqual(items.map(i => i.kind), ['announcement', 'note', 'support', 'action', 'created']);
  assert.equal(items[0].detail, 'warning · seen by 2, closed by 1 · owners only');
  assert.equal(items[1].title, 'Note (pinned)');
  assert.equal(items[2].title, 'Support session as owner@salon');
  assert.match(items[2].detail, /closed at the 60-minute cap/);
  assert.equal(items[3].detail, 'Reason: No pago');
});

test('views, note and impersonate audit rows are not repeated', () => {
  const audit = ['view.tenant', 'note.create', 'impersonate', 'impersonate.end', 'user.deactivate'].map((action, i) => ({
    id: String(i), action, admin_email: 'a@x', details: { email: 'u@salon', reason: 'Se fue' }, created_at: `2026-11-0${i + 1}T00:00:00Z`,
  }));
  const items = buildTimeline({ ...base, audit });
  assert.deepEqual(items.map(i => i.title), ['User deactivated', 'Salon created']);
  assert.equal(items[0].detail, 'u@salon · Reason: Se fue');
});

test('settings changes list the fields; unknown actions show as is', () => {
  const items = buildTimeline({ ...base, audit: [
    { id: '1', action: 'tenant.update', admin_email: 'a', details: { changes: { name: 'X', feature_overrides_changes: {} } }, created_at: '2026-11-01T00:00:00Z' },
    { id: '2', action: 'something.new', admin_email: 'a', details: null, created_at: '2026-11-02T00:00:00Z' },
  ] });
  assert.equal(items.find(i => i.title === 'Settings changed').detail, 'name, feature_overrides');
  assert.ok(items.some(i => i.title === 'something.new' && i.detail === null));
});

test('session end: by hand, at the cap, or still open', () => {
  const s = over => buildTimeline({ ...base, sessions: [{ session_id: 's', admin_email: 'a', target_email: null, reason: 'r', created_at: '2026-11-25T11:30:00Z', ended_at: null, ended_by_email: null, ...over }] })[0].detail;
  assert.match(s({}), /still open/);
  assert.match(s({ ended_at: '2026-11-25T11:40:00Z', ended_by_email: 'b@x' }), /ended by b@x/);
  assert.match(s({ created_at: '2026-11-25T10:00:00Z' }), /60-minute cap/);
});

test('scheduled announcements are left out; long notes are cut', () => {
  const items = buildTimeline({ ...base,
    announcements: [{ id: 'a', title: 'Mañana', level: 'info', starts_at: '2026-11-26T00:00:00Z', ends_at: null, ended_at: null, owners_only: false, seen: 0, dismissed: 0 }],
    notes: [{ id: 'n', body: 'x'.repeat(400), author_email: 'a', pinned: false, created_at: '2026-11-01T00:00:00Z' }],
  });
  assert.ok(!items.some(i => i.kind === 'announcement'));
  assert.equal(items.find(i => i.kind === 'note').detail.length, 280);
});
