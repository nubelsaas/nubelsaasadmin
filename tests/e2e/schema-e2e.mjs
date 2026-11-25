// Página Schema: lee la base DEV (sin filas), el chequeo de lo que necesita el portal y la
// comparación con un snapshot subido. El "otro entorno" es una copia del snapshot de DEV con
// cambios conocidos. No crea datos de salones. Usa Playwright (PLAYWRIGHT_DIR, CHROMIUM_PATH).
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const req = createRequire(import.meta.url);
const { createClient } = req('@supabase/supabase-js');
const { createServerClient } = req('@supabase/ssr');
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'node_modules', 'x.js'))('playwright');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('pwssiwhraoednhqghowi')) throw new Error('not DEV');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = 'http://localhost:3003';
const tag = randomUUID().slice(0, 8);
const pw = randomUUID();
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

try {
  const mail = `zz-schema-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  // ── API ──
  ok((await fetch(`${BASE}/api/schema`)).status !== 200, 'no session, no schema');
  const snap = await (await fetch(`${BASE}/api/schema`, { headers: { cookie } })).json();
  const catalog = snap.source === 'catalog';
  console.log(`  (source: ${snap.source})`);
  ok(snap.project === 'pwssiwhraoednhqghowi' && snap.env === 'dev', 'snapshot names the database');
  ok(snap.tables.tenants?.columns.some(col => col.name === 'suspended_at'), 'reads tables and columns');
  ok(snap.tables.admin_tenant_notes && snap.functions.some(f => f.name === 'get_my_announcements'), 'sees portal tables and app functions');
  ok(!JSON.stringify(snap).includes('@example.com') && !JSON.stringify(snap).includes(process.env.SUPABASE_SERVICE_ROLE_KEY), 'no rows and no keys in the snapshot');
  if (catalog) {
    ok(snap.policies.length > 0 && snap.triggers.length > 0 && snap.indexes.length > 0, 'catalog: policies, triggers and indexes');
    ok(snap.tables.tenants.rls === true, 'catalog: RLS flag');
    const leak = await createClient(url, anon, { auth: { persistSession: false } }).rpc('admin_schema_snapshot');
    ok(leak.error, 'the browser key cannot call admin_schema_snapshot()');
  }

  // "Otro entorno": sin la tabla de notas, una columna distinta y una función que DEV no tiene.
  const other = structuredClone(snap);
  other.env = 'prod';
  other.project = 'zzotherproject';
  delete other.tables.admin_tenant_notes;
  other.tables.tenants.columns = other.tables.tenants.columns.filter(col => col.name !== 'suspended_at');
  other.functions.push({ name: `zz_only_prod_${tag}`, args: '', returns: 'void', security_definer: false, hash: 'x' });
  if (catalog) {
    const fn = other.functions.find(f => f.name === 'get_my_announcements');
    fn.hash = 'changed';
  }
  const file = join(tmpdir(), `schema-other-${tag}.json`);
  writeFileSync(file, JSON.stringify(other));

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/schema`);
  await page.getByText('Portal readiness').waitFor({ timeout: 30_000 });
  ok(await page.getByText('DEV · pwssiwhraoednhqghowi').first().isVisible(), 'page shows which database');
  ok(await page.locator('[data-requirement="tenants.suspended_at"] svg.text-emerald-500').count() === 1, 'readiness lists what is present');
  ok(await page.locator('[data-requirement="admin_schema_snapshot"] svg.text-emerald-500').count() === (catalog ? 1 : 0), 'readiness knows whether the snapshot function is installed');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download snapshot/ }).click()]);
  const saved = JSON.parse(readFileSync(await download.path(), 'utf8'));
  ok(saved.project === 'pwssiwhraoednhqghowi' && saved.tables.tenants, `download is the snapshot (${download.suggestedFilename()})`);

  await page.getByLabel('Upload snapshot').setInputFiles(file);
  await page.getByTestId('diff-summary').waitFor({ timeout: 10_000 });
  const only = await page.locator('[data-group="only_here"]').innerText();
  ok(only.includes('admin_tenant_notes') && only.includes('tenants.suspended_at'), 'shows what the other side is missing');
  ok((await page.locator('[data-group="only_there"]').innerText()).includes(`zz_only_prod_${tag}`), 'shows what only the other side has');
  if (catalog) ok((await page.locator('[data-group="changed"]').innerText()).includes('get_my_announcements'), 'shows a changed function body');
  ok(!only.includes('admin_tenant_notes.id'), 'a missing table is one line, not one per column');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  await page.getByRole('button', { name: /^Tables / }).click();
  ok(!(await page.locator('[data-group="only_there"]').count()), 'category filter');

  writeFileSync(file, '{"nope":1}');
  await page.getByLabel('Upload snapshot').setInputFiles(file);
  ok(await page.getByText('That file is not a schema snapshot.', { exact: false }).isVisible(), 'rejects a file that is not a snapshot');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
