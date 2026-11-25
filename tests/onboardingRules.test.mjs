import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onboardingSummary, STUCK_DAYS } from '../lib/onboardingRules.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 86_400_000;
const empty = {
  createdAt: new Date(NOW - 2 * DAY).toISOString(), schedulerOn: false, ownerLastSignIn: null,
  services: 0, paymentMethods: 0, activeUsers: 1, customers: 0, appointments: 0, publicServices: 0, sales: 0, firstSaleAt: null,
};
const full = { ...empty, ownerLastSignIn: '2026-11-24T00:00:00Z', services: 3, paymentMethods: 1, activeUsers: 1, customers: 5, sales: 1, firstSaleAt: '2026-11-24T10:00:00Z' };
const keys = s => s.steps.map(x => x.key);

test('a brand-new salon has done nothing and is not stuck yet', () => {
  const s = onboardingSummary(empty, NOW);
  assert.equal(s.done, 0);
  assert.equal(s.total, 5);
  assert.equal(s.complete, false);
  assert.equal(s.stuck, false);
  assert.equal(s.next, 'Owner signed in');
});

test('without the Scheduler there are no appointment or booking steps', () => {
  assert.deepEqual(keys(onboardingSummary(empty, NOW)), ['owner_signed_in', 'services', 'payment_methods', 'team', 'customers', 'first_sale']);
});

test('with the Scheduler, appointments and public booking count', () => {
  const s = onboardingSummary({ ...full, schedulerOn: true }, NOW);
  assert.equal(s.total, 7);
  assert.equal(s.done, 5);
  assert.equal(s.next, 'First appointment');
  assert.match(s.steps.find(x => x.key === 'public_booking').detail, /Salón no encontrado/);
});

test('the team step is optional: a one-person salon can be complete', () => {
  const s = onboardingSummary(full, NOW);
  assert.equal(s.complete, true);
  assert.equal(s.next, null);
  assert.equal(s.steps.find(x => x.key === 'team').done, false);
});

test('stuck means no first sale after the cutoff', () => {
  const old = new Date(NOW - STUCK_DAYS * DAY).toISOString();
  assert.equal(onboardingSummary({ ...empty, createdAt: old }, NOW).stuck, true);
  assert.equal(onboardingSummary({ ...full, createdAt: old }, NOW).stuck, false);
  // Vende pero no publicó la agenda: incompleto, no atascado.
  const selling = onboardingSummary({ ...full, createdAt: old, schedulerOn: true, appointments: 3 }, NOW);
  assert.equal(selling.complete, false);
  assert.equal(selling.stuck, false);
  assert.equal(onboardingSummary({ ...empty, createdAt: new Date(NOW - (STUCK_DAYS - 1) * DAY).toISOString() }, NOW).stuck, false);
});

test('details carry the counts and dates', () => {
  const s = onboardingSummary({ ...full, services: 1, customers: 470 }, NOW);
  assert.equal(s.steps.find(x => x.key === 'services').detail, '1 active service.');
  assert.equal(s.steps.find(x => x.key === 'customers').detail, '470 customers.');
  assert.equal(s.steps.find(x => x.key === 'first_sale').at, '2026-11-24T10:00:00Z');
});

test('the missing step tells what to do', () => {
  const s = onboardingSummary(empty, NOW);
  assert.match(s.steps.find(x => x.key === 'owner_signed_in').detail, /Resend the invite/);
  assert.match(s.steps.find(x => x.key === 'payment_methods').detail, /can't record a sale/);
});
