// Verifica en DEV, con un navegador real, la lista de tenants (búsqueda, filtros, orden, URL),
// la salud por salón, la sección del plan en Flags y el diálogo de motivos (AskDialog).
// Playwright no es dependencia del portal: PLAYWRIGHT_DIR apunta a un node_modules que lo tenga.
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
const BASIC = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';   // Plan Básico en DEV
const PRO = 'c02e54cc-f1f3-4758-bc17-e5f09796de6e';     // Plan Pro en DEV
const tag = randomUUID().slice(0, 8);
const prefix = `ZZ_QW_${tag}`;
const A = { id: randomUUID(), name: `${prefix} Peluquería Ána`, admin_email: `zz-qw-${tag}@example.com`, plan_id: BASIC, country_iso: 'CO' };
const B = { id: randomUUID(), name: `${prefix} Barbería`, plan_id: PRO, country_iso: 'US', suspended_at: new Date().toISOString() };
const C = { id: randomUUID(), name: `${prefix} Clara`, plan_id: BASIC, country_iso: 'CO', is_audit_enabled: false };
const pw = randomUUID();
let fails = 0;
let adminId;
let browser;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); };
const totp = s => {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const ch of s.replace(/=+$/, '')) b += ALPHA.indexOf(ch).toString(2).padStart(5, '0');
  const k = Buffer.from(b.match(/.{8}/g).map(x => parseInt(x, 2)));
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', k).update(m).digest();
  const f = h[19] & 15;
  return String((h.readUInt32BE(f) & 0x7fffffff) % 1e6).padStart(6, '0');
};

try {
  const mail = `zz-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  // Uno por uno: en un insert múltiple, las claves que faltan en una fila van como null.
  for (const t of [A, B, C]) await db.from('tenants').insert(t).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const getJson = async p => (await fetch(BASE + p, { headers: { cookie } })).json();

  // ── API ──
  const found = async q => (await getJson(`/api/tenants?search=${encodeURIComponent(q)}`)).map(t => t.id);
  ok((await found(`${prefix} peluqueria ana`)).join() === A.id, 'search ignores accents and needs every word');
  ok((await found(`zz-qw-${tag}@example`)).join() === A.id, 'search finds the contact email');
  ok(!(await found('%')).some(id => [A.id, B.id, C.id].includes(id)), '"%" is plain text, not a wildcard');

  const health = await getJson('/api/tenants/health');
  ok(health[A.id]?.status === 'new' && health[A.id]?.needsAttention === true, 'salon with no owner needs attention', JSON.stringify(health[A.id]));
  ok(health[B.id]?.status === 'suspended' && health[B.id]?.needsAttention === false, 'suspended salon is not flagged for no owner', JSON.stringify(health[B.id]));
  ok(health[C.id]?.needsAttention === true, 'audit off needs attention');

  // ── Navegador ──
  // CHROMIUM_PATH: un Chromium ya descargado, si la versión de Playwright pide otro.
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext();
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  const row = t => page.locator(`a[href="/tenants/${t.id}"]`);
  const visible = async t => (await row(t).count()) > 0;

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}`);
  await row(A).waitFor();
  ok(await visible(A) && await visible(B) && await visible(C), 'list search from the URL shows the three salons');
  ok(await page.getByText(/^3 of \d+ tenants$/).isVisible(), 'counter shows "3 of N"');
  ok(await row(A).getByText('Plan Básico').isVisible(), 'row shows the plan name');
  await row(A).getByText('Needs attention').waitFor({ timeout: 60_000 });
  ok(true, 'health badges appear after loading');

  await page.getByLabel('Status').selectOption('suspended');
  await page.waitForURL(/status=suspended/);
  ok(await visible(B) && !(await visible(A)) && !(await visible(C)), 'status filter keeps only the suspended salon');

  await row(B).click();
  await page.waitForURL(`${BASE}/tenants/${B.id}`);
  await page.goBack();
  await row(B).waitFor();
  ok(page.url().includes('status=suspended') && !(await visible(A)), 'filters survive opening a salon and going back');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForURL(`${BASE}/tenants`);
  ok(await page.getByPlaceholder('Search by name or contact email...').inputValue() === '', 'Clear filters empties search and URL');

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}&health=attention`);
  await row(A).waitFor({ timeout: 60_000 });
  ok(await visible(C) && !(await visible(B)), 'Needs attention filter');

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}&country=US`);
  await row(B).waitFor();
  ok(!(await visible(A)) && !(await visible(C)), 'country filter');

  await page.goto(`${BASE}/tenants?q=${encodeURIComponent(prefix)}&sort=newest&plan=${BASIC}`);
  await row(A).waitFor();
  ok(!(await visible(B)) && await visible(C), 'plan filter');

  await page.goto(`${BASE}/tenants`);
  await page.getByPlaceholder('Search by name or contact email...').fill(`${prefix} peluqueria`);
  await page.waitForURL(/q=/);
  await row(A).waitFor();
  ok(!(await visible(C)), 'typing in the search box filters and writes the URL');

  // ── Flags: sección del plan ──
  await page.goto(`${BASE}/flags`);
  await page.getByPlaceholder('Search tenant...').fill(prefix);
  await page.getByRole('button', { name: A.name }).click();
  await page.getByText('Plan: Plan Básico').waitFor();
  ok(await page.getByText('· no effect yet').count() === 4, 'Flags marks the 4 plan features with no effect');

  // ── Diálogo de motivo (suspender) ──
  await page.goto(`${BASE}/tenants/${A.id}`);
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const confirm = dialog.getByRole('button', { name: 'Suspend', exact: true });
  await dialog.locator('textarea').fill('abc');
  ok(await confirm.isDisabled(), 'confirm is disabled under 5 characters');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  const afterCancel = await db.from('tenants').select('suspended_at').eq('id', A.id).single();
  ok(afterCancel.data.suspended_at === null, 'Escape cancels without suspending');

  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await dialog.locator('textarea').fill('e2e quick wins check');
  await confirm.click();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).waitFor();
  const suspended = await db.from('tenants').select('suspended_at').eq('id', A.id).single();
  const log = await db.from('admin_audit_logs').select('details').eq('admin_user_id', adminId).eq('action', 'tenant.suspend').eq('tenant_id', A.id).maybeSingle();
  ok(suspended.data.suspended_at !== null && log.data?.details?.reason === 'e2e quick wins check', 'dialog reason suspends and is logged', JSON.stringify(log.data));

  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached' });
  ok((await db.from('tenants').select('suspended_at').eq('id', A.id).single()).data.suspended_at !== null, 'Cancel keeps it suspended');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  await db.from('tenants').delete().in('id', [A.id, B.id, C.id]);
  if (adminId) {
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `${prefix}%`);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
