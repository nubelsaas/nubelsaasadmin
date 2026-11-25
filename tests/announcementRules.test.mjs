import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcementStatus, audienceReach, isOwner, matchesAudience, validateAnnouncement } from '../lib/announcementRules.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const base = { title: '  Mantenimiento  ', body: 'Hoy a las 10 pm.\r\n', level: 'warning' };

test('valid announcement is cleaned; no start means now', () => {
  const r = validateAnnouncement({ ...base, plan_ids: [], countries: ['co', 'co'], tenant_ids: ['', 't1'] }, NOW);
  assert.ok('value' in r);
  assert.equal(r.value.title, 'Mantenimiento');
  assert.equal(r.value.body, 'Hoy a las 10 pm.');
  assert.equal(r.value.starts_at, new Date(NOW).toISOString());
  assert.equal(r.value.plan_ids, null, 'empty list means everyone');
  assert.deepEqual(r.value.countries, ['CO']);
  assert.deepEqual(r.value.tenant_ids, ['t1']);
  assert.equal(r.value.owners_only, false);
});

test('rejects a missing title, unknown level and long text', () => {
  assert.ok('error' in validateAnnouncement({ ...base, title: ' ' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, level: 'urgent' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, title: 'x'.repeat(121) }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, body: 'x'.repeat(1001) }, NOW));
});

test('links must be https; a label needs a link', () => {
  assert.ok('value' in validateAnnouncement({ ...base, link_url: 'https://nubel.tech/x', link_label: 'Ver' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, link_url: 'http://nubel.tech' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, link_url: 'javascript:alert(1)' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, link_label: 'Ver' }, NOW));
});

test('the end must be after the start and in the future', () => {
  assert.ok('error' in validateAnnouncement({ ...base, starts_at: '2026-11-26T00:00:00Z', ends_at: '2026-11-25T23:00:00Z' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-02T00:00:00Z' }, NOW));
  assert.ok('error' in validateAnnouncement({ ...base, starts_at: 'tomorrow' }, NOW));
  assert.ok('value' in validateAnnouncement({ ...base, ends_at: '2026-12-01T00:00:00Z' }, NOW));
});

test('status: scheduled, live, ended by date or by hand', () => {
  assert.equal(announcementStatus({ starts_at: '2026-11-26T00:00:00Z', ends_at: null, ended_at: null }, NOW), 'scheduled');
  assert.equal(announcementStatus({ starts_at: '2026-11-24T00:00:00Z', ends_at: null, ended_at: null }, NOW), 'live');
  assert.equal(announcementStatus({ starts_at: '2026-11-20T00:00:00Z', ends_at: '2026-11-25T00:00:00Z', ended_at: null }, NOW), 'ended');
  assert.equal(announcementStatus({ starts_at: '2026-11-24T00:00:00Z', ends_at: null, ended_at: '2026-11-25T00:00:00Z' }, NOW), 'ended');
});

const tenants = [
  { id: 'a', plan_id: 'pro', country_iso: 'CO' },
  { id: 'b', plan_id: 'basic', country_iso: 'CO' },
  { id: 'c', plan_id: 'pro', country_iso: 'MX' },
];
const all = { plan_ids: null, countries: null, tenant_ids: null, owners_only: false };

test('audience: every filter with a value must match', () => {
  const ids = (a) => tenants.filter(t => matchesAudience(a, t)).map(t => t.id);
  assert.deepEqual(ids(all), ['a', 'b', 'c']);
  assert.deepEqual(ids({ ...all, plan_ids: ['pro'] }), ['a', 'c']);
  assert.deepEqual(ids({ ...all, plan_ids: ['pro'], countries: ['CO'] }), ['a']);
  assert.deepEqual(ids({ ...all, tenant_ids: ['b', 'c'], countries: ['MX'] }), ['c']);
});

test('reach counts salons and active people; owners only counts owners', () => {
  const users = [{ tenant_id: 'a', is_owner: true }, { tenant_id: 'a', is_owner: false }, { tenant_id: 'c', is_owner: true }];
  assert.deepEqual(audienceReach({ ...all, plan_ids: ['pro'] }, tenants, users), { salons: 2, people: 3 });
  assert.deepEqual(audienceReach({ ...all, plan_ids: ['pro'], owners_only: true }, tenants, users), { salons: 2, people: 2 });
});

test('owner check accepts permissions stored as JSON text', () => {
  assert.ok(isOwner({ can_do_everything: true }));
  assert.ok(isOwner('{"can_do_everything":true}'));
  assert.ok(!isOwner({ can_do_everything: 'true' }));
  assert.ok(!isOwner('nope'));
  assert.ok(!isOwner(null));
});
