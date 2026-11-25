import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailStatus, googleStatus, pushStatus, readableError, whatsappStatus, worstLevel } from '../lib/integrationRules.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const job = (over) => ({ notification_type: 'appointment_reminder_email_early', status: 'completed', attempt_count: 1, last_error: null, updated_at: '2026-11-20T00:00:00Z', ...over });

test('readableError reads Meta JSON errors and plain text', () => {
  assert.equal(readableError('{"error":{"message":"Authentication Error","code":190,"type":"OAuthException"}}'), 'Authentication Error (code 190)');
  assert.equal(readableError('timeout'), 'timeout');
  assert.equal(readableError(null), 'Unknown error');
  assert.ok(readableError('x'.repeat(500)).length <= 160);
});

test('email: sent reminders are ok', () => {
  const s = emailStatus({ remindersEnabled: true, contactEmail: 'a@b.co', jobs: [job({}), job({})] });
  assert.equal(s.level, 'ok');
  assert.match(s.summary, /2 reminders sent/);
});

test('email: a dead reminder is an error with its message; push jobs are ignored', () => {
  const s = emailStatus({
    remindersEnabled: true, contactEmail: 'a@b.co',
    jobs: [job({ status: 'dead', last_error: 'Resend 422' }), job({ notification_type: 'appointment_reminder', status: 'dead' })],
  });
  assert.equal(s.level, 'error');
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].message, 'Resend 422');
});

test('email: a reminder still retrying is a warning', () => {
  const s = emailStatus({ remindersEnabled: true, contactEmail: 'a@b.co', jobs: [job({ status: 'pending', attempt_count: 2, last_error: 'rate limited' })] });
  assert.equal(s.level, 'warning');
});

test('email: off when reminders are turned off; warns about the missing contact', () => {
  const s = emailStatus({ remindersEnabled: false, contactEmail: null, jobs: [] });
  assert.equal(s.level, 'off');
  assert.match(s.details[0], /No contact email/);
});

test('email: unavailable when the table is missing', () => {
  assert.equal(emailStatus({ remindersEnabled: true, contactEmail: 'a@b.co', jobs: null }).level, 'unavailable');
});

const conn = (over) => ({ display_phone: '+57 300', is_active: true, status: 'active', connection_type: 'business', ...over });
const msg = (status, created_at, last_error = null) => ({ status, created_at, last_error });

test('whatsapp: off with no connection, error when every connection is down', () => {
  assert.equal(whatsappStatus({ connections: [], messages: [] }).level, 'off');
  const down = whatsappStatus({ connections: [conn({ is_active: false, disconnect_reason: 'token revoked' })], messages: [] });
  assert.equal(down.level, 'error');
  assert.match(down.details[0], /token revoked/);
});

test('whatsapp: the last message failing is an error even if older ones worked', () => {
  const s = whatsappStatus({
    connections: [conn({})],
    messages: [msg('sent', '2026-11-20T00:00:00Z'), msg('failed', '2026-11-24T00:00:00Z', '{"error":{"message":"Authentication Error","code":190}}')],
  });
  assert.equal(s.level, 'error');
  assert.match(s.summary, /Authentication Error \(code 190\)/);
});

test('whatsapp: older failures with a later success are a warning', () => {
  const s = whatsappStatus({ connections: [conn({})], messages: [msg('failed', '2026-11-20T00:00:00Z', 'x'), msg('sent', '2026-11-24T00:00:00Z')] });
  assert.equal(s.level, 'warning');
  assert.match(s.summary, /1 message sent, 1 failed/);
});

test('whatsapp: works with PROD connections (no status column) and no message log', () => {
  const s = whatsappStatus({ connections: [{ display_phone: '+57 300', is_active: true }], messages: null });
  assert.equal(s.level, 'ok');
  assert.ok(s.details.some(d => /message log is not available/.test(d)));
});

const tok = (over) => ({ who: 'ana@salon.co', google_email: 'ana@gmail.com', token_expiry: '2026-11-25T11:00:00Z', hasRefresh: true, ...over });

test('google: refresh token keeps an expired access token healthy', () => {
  const s = googleStatus({ tokens: [tok({})], synced: 4, now: NOW });
  assert.equal(s.level, 'ok');
  assert.match(s.summary, /4 appointments synced/);
});

test('google: expired with no refresh token must reconnect; not yet expired is a warning', () => {
  assert.equal(googleStatus({ tokens: [tok({ hasRefresh: false })], synced: 0, now: NOW }).level, 'error');
  assert.equal(googleStatus({ tokens: [tok({ hasRefresh: false, token_expiry: '2026-11-25T13:00:00Z' })], synced: 0, now: NOW }).level, 'warning');
  assert.equal(googleStatus({ tokens: [], synced: 0, now: NOW }).level, 'off');
});

const dev = (over) => ({ who: 'ana@salon.co', status: 'active', platform: 'ios', last_seen_at: '2026-11-24T00:00:00Z', ...over });

test('push: active devices and deliveries are ok', () => {
  const s = pushStatus({ devices: [dev({}), dev({ status: 'expired' })], deliveries: [{ status: 'SENT', error_code: null, created_at: '2026-11-24T00:00:00Z' }], jobs: [], now: NOW });
  assert.equal(s.level, 'ok');
  assert.match(s.details[0], /1 active device, 1 expired/);
});

test('push: failed deliveries warn; a staff reminder that gave up is an error', () => {
  const failed = pushStatus({ devices: [dev({})], deliveries: [{ status: 'FAILED', error_code: '410', created_at: '2026-11-24T00:00:00Z' }], jobs: [], now: NOW });
  assert.equal(failed.level, 'warning');
  assert.equal(failed.errors[0].message, 'Delivery failed: 410');
  const dead = pushStatus({ devices: [dev({})], deliveries: [], jobs: [job({ notification_type: 'appointment_reminder', status: 'dead', last_error: 'no devices' })], now: NOW });
  assert.equal(dead.level, 'error');
});

test('push: only expired subscriptions means nobody is notified', () => {
  assert.equal(pushStatus({ devices: [dev({ status: 'expired' })], deliveries: [], jobs: [], now: NOW }).level, 'warning');
  assert.equal(pushStatus({ devices: [], deliveries: [], jobs: [], now: NOW }).level, 'off');
});

test('worstLevel', () => {
  assert.equal(worstLevel(['ok', 'off', 'warning']), 'warning');
  assert.equal(worstLevel(['off', 'error']), 'error');
  assert.equal(worstLevel(['off', 'unavailable']), 'off');
});

test('errors are newest first and capped', () => {
  const jobs = Array.from({ length: 8 }, (_, i) => job({ status: 'dead', last_error: `e${i}`, updated_at: `2026-11-1${i}T00:00:00Z` }));
  const s = emailStatus({ remindersEnabled: true, contactEmail: 'a@b.co', jobs });
  assert.equal(s.errors.length, 5);
  assert.equal(s.errors[0].message, 'e7');
});

test('quiet salons say so instead of "0 sent"', () => {
  assert.match(emailStatus({ remindersEnabled: true, contactEmail: 'a@b.co', jobs: [] }).summary, /^No reminder emails/);
  assert.match(pushStatus({ devices: [dev({})], deliveries: [], jobs: [], now: NOW }).summary, /No notifications in the last/);
});
