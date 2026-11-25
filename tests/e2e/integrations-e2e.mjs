// Panel de integraciones del salón (GET /api/tenants/[id]/integrations y la tarjeta del detalle),
// con un salón desechable que tiene una falla conocida en cada integración. Usa Playwright
// como quickwins-e2e.mjs (PLAYWRIGHT_DIR, CHROMIUM_PATH).
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { join } from 'node:path';

const req = createRequire(import.meta.url);
const { createClient } = req('@supabase/supabase-js');
const { createServerClient } = req('@supabase/ssr');
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'node_modules', 'x.js'))('playwright');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('pwssiwhraoednhqghowi')) throw new Error('not DEV');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = 'http://localhost:3003';
const PLAN = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';
const tag = randomUUID().slice(0, 8);
const T = randomUUID(), QUIET = randomUUID(), BRANCH = randomUUID(), ROLE = randomUUID(), APPT = randomUUID();
const pw = randomUUID();
const authIds = [];
let adminId, browser, fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); };
const ago = h => new Date(Date.now() - h * 3600_000).toISOString();
const totp = s => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const c of s.replace(/=+$/, '')) b += A.indexOf(c).toString(2).padStart(5, '0');
  const k = Buffer.from(b.match(/.{8}/g).map(x => parseInt(x, 2)));
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', k).update(m).digest();
  const f = h[19] & 15;
  return String((h.readUInt32BE(f) & 0x7fffffff) % 1e6).padStart(6, '0');
};
const staff = async (label) => {
  const email = `zz-int-${label}-${tag}@example.com`;
  const id = (await db.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user.id;
  authIds.push(id);
  await db.from('users').insert({ id, tenant_id: T, role_id: ROLE, first_name: label, last_name: '', email, permissions: { can_do_everything: true }, wage_type: 'monthly' }).throwOnError();
  return { id, email };
};

try {
  const mail = `zz-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();

  await db.from('tenants').insert({ id: T, name: `ZZ_INT_${tag}`, plan_id: PLAN, admin_email: `zz-int-owner-${tag}@example.com` }).throwOnError();
  await db.from('tenants').insert({ id: QUIET, name: `ZZ_INT_QUIET_${tag}`, plan_id: PLAN }).throwOnError();
  await db.from('branches').insert({ id: BRANCH, tenant_id: T, name: 'Main' }).throwOnError();
  await db.from('roles').insert({ id: ROLE, tenant_id: T, name: 'Administrador', type: 'administrative' }).throwOnError();
  const owner = await staff('owner');
  const stylist = await staff('stylist');

  await db.from('appointments').insert({ id: APPT, tenant_id: T, branch_id: BRANCH, start_time: ago(24), end_time: ago(23) }).throwOnError();
  await db.from('notification_jobs').insert({
    tenant_id: T, appointment_id: APPT, notification_type: 'appointment_reminder_email_early',
    scheduled_for: ago(30), due_at: ago(30), next_attempt_at: ago(30), status: 'dead', attempt_count: 3, last_error: 'Resend 422: invalid recipient',
  }).throwOnError();

  await db.from('whatsapp_integrations').insert({
    tenant_id: T, branch_id: BRANCH, phone_number_id: `zz-${tag}`, display_phone: '+57 300 000 0000',
    access_token: 'SECRET-ZZ-WA-TOKEN', verify_token: 'SECRET-ZZ-VERIFY',
  }).throwOnError();
  // En DEV cada respuesta debe venir de un mensaje recibido (whatsapp_outbound_messages_source_check).
  // Y cada mensaje recibido tiene a lo sumo una respuesta (inbound_id único).
  const received = async n => (await db.from('whatsapp_inbound_messages').insert({
    tenant_id: T, phone_number_id: `zz-${tag}`, wa_message_id: `zz-${tag}-${n}`, from_phone: '+570', message_type: 'text', body: 'hola',
  }).select('id').single().throwOnError()).data.id;
  await db.from('whatsapp_outbound_messages').insert({ tenant_id: T, inbound_id: await received(1), phone_number_id: `zz-${tag}`, to_phone: '+570', body: 'hola', status: 'sent', created_at: ago(5) }).throwOnError();
  await db.from('whatsapp_outbound_messages').insert({
    tenant_id: T, inbound_id: await received(2), phone_number_id: `zz-${tag}`, to_phone: '+570', body: 'hola', status: 'failed', created_at: ago(1),
    last_error: '{"error":{"message":"Authentication Error","code":190,"type":"OAuthException"}}',
  }).throwOnError();

  await db.from('user_google_tokens').insert({
    tenant_id: T, user_id: stylist.id, access_token: 'SECRET-ZZ-GOOGLE', refresh_token: null, token_expiry: ago(2), google_email: `zz-${tag}@gmail.com`,
  }).throwOnError();

  const { data: device } = await db.from('push_devices').insert({
    tenant_id: T, user_id: owner.id, endpoint: `https://push.example.com/zz-${tag}`, p256dh_key: 'SECRET-ZZ-P256', auth_key: 'SECRET-ZZ-AUTH', platform: 'ios', status: 'active',
  }).select('id').single().throwOnError();
  await db.from('notification_delivery_log').insert({
    tenant_id: T, user_id: owner.id, device_id: device.id, event_type: 'appointment_reminder', tag: `zz:${tag}`, status: 'FAILED', error_code: '410',
  }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  // ── API ──
  const res = await fetch(`${BASE}/api/tenants/${T}/integrations`, { headers: { cookie } });
  const raw = await res.text();
  ok(res.ok, `integrations load (${res.status})`, raw.slice(0, 200));
  const report = JSON.parse(raw);
  const by = Object.fromEntries(report.integrations.map(i => [i.key, i]));
  ok(!raw.includes('SECRET-ZZ'), 'no token or key reaches the browser');
  ok(report.level === 'error', `overall level is the worst one (${report.level})`);
  ok(by.email.level === 'error' && by.email.errors[0]?.message === 'Resend 422: invalid recipient', `email: dead reminder (${JSON.stringify(by.email)})`);
  ok(by.whatsapp.level === 'error' && /Authentication Error \(code 190\)/.test(by.whatsapp.summary), `whatsapp: last message failed (${by.whatsapp.summary})`);
  ok(by.google.level === 'error' && by.google.errors[0]?.who === stylist.email, `google: expired with no refresh token (${JSON.stringify(by.google.errors)})`);
  ok(by.push.level === 'warning' && by.push.errors[0]?.message === 'Delivery failed: 410', `push: failed delivery (${JSON.stringify(by.push.errors)})`);
  ok(by.push.details.some(d => d.includes(owner.email)), 'push lists who receives notifications');

  const quiet = await (await fetch(`${BASE}/api/tenants/${QUIET}/integrations`, { headers: { cookie } })).json();
  ok(quiet.integrations.map(i => i.level).join() === 'ok,off,off,off', `a salon with nothing set up (${quiet.integrations.map(i => i.level).join()})`);
  ok(/No contact email/.test(quiet.integrations[0].details[0]), 'missing contact email is called out');

  const views = await db.from('admin_audit_logs').select('id', { count: 'exact', head: true }).eq('admin_user_id', adminId).eq('action', 'view.integrations').eq('tenant_id', T);
  ok(views.count === 1, `reading integrations is logged (${views.count})`);
  ok((await fetch(`${BASE}/api/tenants/${randomUUID()}/integrations`, { headers: { cookie } })).status === 404, 'unknown tenant is 404');
  ok((await fetch(`${BASE}/api/tenants/${T}/integrations`)).status !== 200, 'no session, no data');

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/tenants/${T}`);
  await page.getByText('Recent errors').waitFor({ timeout: 30_000 });
  ok(await page.getByText('Resend 422: invalid recipient').isVisible(), 'card opens the first failing integration with its error');
  ok(await page.getByText('Failing').count() >= 4, 'card shows the overall and per-integration badges');
  await page.getByRole('button', { name: /Google Calendar/ }).click();
  ok(await page.getByText(/must reconnect/).isVisible() && await page.getByText(/needs to reconnect/).isVisible(), 'expanding Google shows who must reconnect');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  await db.from('notification_delivery_log').delete().eq('tenant_id', T);
  await db.from('push_devices').delete().eq('tenant_id', T);
  await db.from('notification_jobs').delete().eq('tenant_id', T);
  await db.from('appointments').delete().eq('tenant_id', T);
  // Lo llena un trigger de appointments; bloquea el borrado del tenant (FK sin cascada).
  await db.from('local_agenda_invalidation_state').delete().eq('tenant_id', T);
  await db.from('whatsapp_outbound_messages').delete().eq('tenant_id', T);
  await db.from('whatsapp_inbound_messages').delete().eq('tenant_id', T);
  await db.from('whatsapp_integrations').delete().eq('tenant_id', T);
  await db.from('user_google_tokens').delete().eq('tenant_id', T);
  await db.from('tenants').delete().in('id', [T, QUIET]);
  for (const id of authIds) await db.auth.admin.deleteUser(id).catch(() => {});
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `ZZ_INT_%${tag}`);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
