// Barra de progreso del clone: pasos exactos del servidor (evento SSE "progress"). Un salón
// plantilla desechable con un catálogo mínimo se clona a un salón vacío; después se deshace desde
// la página con un navegador real. Usa Playwright (PLAYWRIGHT_DIR, CHROMIUM_PATH).
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { parseSse } from '../../lib/cloneProgress.ts';

const req = createRequire(import.meta.url);
const { createClient } = req('@supabase/supabase-js');
const { createServerClient } = req('@supabase/ssr');
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'node_modules', 'x.js'))('playwright');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('pwssiwhraoednhqghowi')) throw new Error('not DEV');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = 'http://localhost:3003';
const BASICO = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';
const tag = randomUUID().slice(0, 8);
const SRC = { id: randomUUID(), name: `ZZ_CLONEP_${tag} Template`, plan_id: BASICO, feature_overrides: { cloneTemplate: true } };
const TGT = { id: randomUUID(), name: `ZZ_CLONEP_${tag} Target`, plan_id: BASICO };
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

/** Lee el stream completo: líneas del log y eventos de progreso. */
async function stream(cookie, body) {
  const res = await fetch(`${BASE}/api/clone/stream`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`stream ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  const lines = [], progress = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSse(buffer + dec.decode(value, { stream: true }));
    buffer = parsed.rest;
    for (const e of parsed.events) (e.event === 'progress' ? progress.push(JSON.parse(e.data)) : lines.push(e.data));
  }
  return { lines, progress };
}

try {
  const mail = `zz-clonep-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  for (const t of [SRC, TGT]) await db.from('tenants').insert(t).throwOnError();
  await db.from('branches').insert({ tenant_id: SRC.id, name: 'Sede' }).throwOnError();
  await db.from('roles').insert({ tenant_id: SRC.id, name: 'Estilista', type: 'operative' }).throwOnError();
  for (const name of ['Corte', 'Color']) await db.from('products_services').insert({ tenant_id: SRC.id, name, type: 'service' }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  // ── Onboarding con una tabla omitida: 1 (mapas de ids) + 7 tablas = 8 pasos ──
  const run = await stream(cookie, { source: SRC.id, target: TGT.id, mode: 'onboarding', exclude: 'distributors' });
  const p = run.progress;
  ok(run.lines.some(l => l.startsWith('✅')), 'clone finished', run.lines.slice(-3).join(' | '));
  ok(p.length > 0 && p.every(x => x.total === 8 && x.phase === 'onboarding'), `8 steps, skipped table not counted (${p[0]?.total})`);
  ok(p[0].done === 0 && p.at(-1).done === 8, 'goes from 0 to 8');
  ok(p.every((x, i) => i === 0 || x.done === p[i - 1].done + 1), 'one step at a time');
  ok(p.some(x => x.label === 'products_services') && !p.some(x => x.label === 'distributors'), 'labels name the table');
  ok(run.lines.some(l => l.startsWith('   ') || l.startsWith('✓')), 'log lines still arrive');
  const cloned = await db.from('products_services').select('id', { count: 'exact', head: true }).eq('tenant_id', TGT.id);
  ok(cloned.count === 2, `catalog cloned (${cloned.count})`);

  // ── Undo desde la página ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/clone`);
  await page.getByPlaceholder('Search existing or type a new name…').fill(TGT.name);
  await page.getByRole('button', { name: new RegExp(TGT.name) }).click();
  await page.getByRole('button', { name: 'Undo clone' }).click();
  await page.getByPlaceholder(TGT.name).fill(TGT.name);
  await page.getByRole('dialog').getByRole('button', { name: 'Undo clone' }).click();
  await page.getByText(/Rollback complete/).waitFor({ timeout: 120_000 });
  const stepText = await page.getByTestId('clone-step').innerText();
  ok(/^Step 28 of 28/.test(stepText), `rollback shows its own steps (${stepText})`);
  ok(await page.getByRole('progressbar', { name: 'Clone progress' }).getAttribute('aria-valuenow') === '100', 'bar at 100%');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const left = await db.from('products_services').select('id', { count: 'exact', head: true }).eq('tenant_id', TGT.id);
  ok(left.count === 0, 'undo emptied the target');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  for (const t of ['products_services', 'roles', 'branches']) await db.from(t).delete().in('tenant_id', [SRC.id, TGT.id]);
  await db.from('tenants').delete().in('id', [SRC.id, TGT.id]);
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `ZZ_CLONEP_${tag}%`);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
