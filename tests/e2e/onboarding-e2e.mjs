// Checklist de arranque (Setup): un salón nuevo, uno atascado y uno completo, contra el portal en
// 3003 y con un navegador real. Usa Playwright como quickwins-e2e.mjs (PLAYWRIGHT_DIR, CHROMIUM_PATH).
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
const BASICO = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';   // Plan Básico: Scheduler encendido por plan
const tag = randomUUID().slice(0, 8);
const prefix = `ZZ_ONB_${tag}`;
const DAY = 86_400_000;
const NEW = { id: randomUUID(), name: `${prefix} New`, plan_id: BASICO, feature_overrides: { enableScheduler: false } };
const STUCK = { id: randomUUID(), name: `${prefix} Stuck`, plan_id: BASICO, feature_overrides: { enableScheduler: false }, created_at: new Date(Date.now() - 20 * DAY).toISOString() };
const DONE = { id: randomUUID(), name: `${prefix} Done`, plan_id: BASICO, feature_overrides: { enableScheduler: false }, created_at: new Date(Date.now() - 40 * DAY).toISOString() };
const pw = randomUUID();
const authIds = [];
let adminId, browser, fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); };
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

/** Dueño con login que ya entró una vez (Auth guarda last_sign_in_at). */
async function ownerFor(tenant, signIn) {
  const role = randomUUID();
  await db.from('roles').insert({ id: role, tenant_id: tenant.id, name: 'Administrador', type: 'administrative' }).throwOnError();
  const email = `zz-onb-${tenant.id.slice(0, 8)}@example.com`;
  const id = (await db.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user.id;
  authIds.push(id);
  await db.from('users').insert({ id, tenant_id: tenant.id, role_id: role, first_name: 'Owner', last_name: '', email, permissions: { can_do_everything: true }, wage_type: 'monthly' }).throwOnError();
  if (signIn) {
    const c = createClient(url, anon, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: pw });
    if (error) throw new Error(`owner sign-in: ${error.message}`);
  }
}

try {
  const mail = `zz-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  for (const t of [NEW, STUCK, DONE]) await db.from('tenants').insert(t).throwOnError();

  // Atascado: el dueño entró, cargó un servicio y un medio de pago, y nada más en 20 días.
  await ownerFor(STUCK, true);
  await db.from('products_services').insert({ tenant_id: STUCK.id, name: 'Corte', type: 'service' }).throwOnError();
  await db.from('payment_accounts').insert({ tenant_id: STUCK.id, name: 'Caja', type: 'cash' }).throwOnError();

  // Completo: todos los pasos obligatorios, sin equipo (es opcional).
  await ownerFor(DONE, true);
  const branch = randomUUID();
  await db.from('branches').insert({ id: branch, tenant_id: DONE.id, name: 'Main' }).throwOnError();
  await db.from('products_services').insert({ tenant_id: DONE.id, name: 'Corte', type: 'service' }).throwOnError();
  await db.from('products_services').insert({ tenant_id: DONE.id, name: 'Shampoo', type: 'retail' }).throwOnError();
  await db.from('payment_accounts').insert({ tenant_id: DONE.id, name: 'Caja', type: 'cash' }).throwOnError();
  await db.from('customers').insert({ tenant_id: DONE.id, first_name: 'Ana' }).throwOnError();
  const firstSale = new Date(Date.now() - 30 * DAY).toISOString();
  await db.from('transactions').insert({ tenant_id: DONE.id, branch_id: branch, status: 'closed', total_sale_price: 50000, date_time: firstSale }).throwOnError();
  await db.from('transactions').insert({ tenant_id: DONE.id, branch_id: branch, status: 'voided', total_sale_price: 1, date_time: new Date(Date.now() - 35 * DAY).toISOString() }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const get = async p => (await fetch(BASE + p, { headers: { cookie } })).json();

  // ── API ──
  const all = await get('/api/tenants/onboarding');
  ok(all[NEW.id]?.done === 0 && all[NEW.id]?.total === 5 && !all[NEW.id].stuck, `new salon: 0/5, not stuck (${JSON.stringify(all[NEW.id])})`);
  ok(all[STUCK.id]?.done === 3 && all[STUCK.id]?.stuck && all[STUCK.id]?.next === 'Customers added', `stuck salon: 3/5, next is customers (${JSON.stringify(all[STUCK.id])})`);
  ok(all[DONE.id]?.complete && !all[DONE.id]?.stuck, `complete salon (${JSON.stringify(all[DONE.id])})`);

  const done = await get(`/api/tenants/${DONE.id}/onboarding`);
  const step = k => done.steps.find(s => s.key === k);
  ok(step('services').detail === '1 active service.', `only active services count, not retail (${step('services').detail})`);
  ok(step('first_sale').detail === '1 sale.' && step('first_sale').at?.slice(0, 10) === firstSale.slice(0, 10), `voided sales don't count; first sale date (${JSON.stringify(step('first_sale'))})`);
  ok(step('owner_signed_in').done && step('owner_signed_in').at, 'owner sign-in comes from Auth');
  ok(step('team').optional && !step('team').done, 'team is optional and not required for complete');

  await db.from('tenants').update({ feature_overrides: { enableScheduler: true } }).eq('id', DONE.id).throwOnError();
  const withScheduler = await get(`/api/tenants/${DONE.id}/onboarding`);
  ok(withScheduler.total === 7 && withScheduler.next === 'First appointment' && !withScheduler.stuck,
    `turning the Scheduler on adds 2 steps; selling salon is incomplete, not stuck (${withScheduler.done}/${withScheduler.total}, ${withScheduler.next})`);
  await db.from('tenants').update({ feature_overrides: {} }).eq('id', DONE.id).throwOnError();
  ok((await get(`/api/tenants/${DONE.id}/onboarding`)).total === 7, 'with no override the plan decides the Scheduler (Plan Básico: on)');
  await db.from('tenants').update({ feature_overrides: { enableScheduler: false } }).eq('id', DONE.id).throwOnError();

  ok((await fetch(`${BASE}/api/tenants/${randomUUID()}/onboarding`, { headers: { cookie } })).status === 404, 'unknown tenant is 404');
  ok((await fetch(`${BASE}/api/tenants/onboarding`)).status !== 200, 'no session, no data');

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  const row = t => page.locator(`a[href="/tenants/${t.id}"]`);

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}&setup=stuck`);
  await row(STUCK).waitFor({ timeout: 30_000 });
  ok(await row(NEW).count() === 0 && await row(DONE).count() === 0, 'Stuck filter shows only the stuck salon');
  ok(await row(STUCK).getByText('Stuck 3/5').isVisible(), 'list badge shows progress');

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}&setup=incomplete`);
  await row(NEW).waitFor({ timeout: 30_000 });
  ok(await row(STUCK).count() === 1 && await row(DONE).count() === 0, 'Setup incomplete filter');

  await page.goto(`${BASE}/tenants/${STUCK.id}`);
  await page.getByText(/still no first sale/).waitFor({ timeout: 30_000 });
  ok(await page.getByText('Next step: Customers added.').isVisible(), 'stuck card says what to do next');
  ok(await page.getByText('No payment methods').count() === 0 && await page.getByText('1 payment method.').isVisible(), 'done steps show what was found');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  await page.goto(`${BASE}/tenants/${DONE.id}`);
  await page.getByText('Complete', { exact: true }).waitFor({ timeout: 30_000 });
  ok(await page.getByText('First sale').count() === 0, 'a complete checklist starts collapsed');
  await page.getByRole('button', { name: /Setup/ }).click();
  ok(await page.getByText('First sale').isVisible(), 'and opens on click');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  const ids = [NEW.id, STUCK.id, DONE.id];
  for (const t of ['transactions', 'customers', 'payment_accounts', 'products_services']) await db.from(t).delete().in('tenant_id', ids);
  await db.from('tenants').delete().in('id', ids);
  for (const id of authIds) await db.auth.admin.deleteUser(id).catch(() => {});
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `${prefix}%`);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
