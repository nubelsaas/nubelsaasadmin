// Descripciones al pasar el mouse (components/ui/Hint.tsx, textos en lib/fieldHelp.ts).
// Un salón desechable con su dueño; revisa hover, teclado, toque en el ícono en un teléfono,
// que la caja quede dentro de la pantalla y que se oculte al escribir. Usa Playwright
// (PLAYWRIGHT_DIR, CHROMIUM_PATH). SHOT=/ruta.png guarda una captura con una descripción abierta.
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
const BASICO = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';
const tag = randomUUID().slice(0, 8);
const T = { id: randomUUID(), name: `ZZ_HINT_${tag}`, plan_id: BASICO, country_iso: 'CO', admin_email: `zz-hint-owner-${tag}@example.com` };
const pw = randomUUID();
const authIds = [];
let adminId, browser, fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); };
const totp = s => {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const c of s.replace(/=+$/, '')) b += ALPHA.indexOf(c).toString(2).padStart(5, '0');
  const k = Buffer.from(b.match(/.{8}/g).map(x => parseInt(x, 2)));
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', k).update(m).digest();
  const f = h[19] & 15;
  return String((h.readUInt32BE(f) & 0x7fffffff) % 1e6).padStart(6, '0');
};

const tip = page => page.getByRole('tooltip');
/** La caja visible queda entera dentro de la ventana. */
async function insideViewport(page) {
  const box = await tip(page).boundingBox();
  const vp = page.viewportSize();
  return box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height;
}
async function waitTip(page, text, timeout = 3000) {
  try { await tip(page).filter({ hasText: text }).waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}
async function noTip(page, timeout = 2000) {
  try { await tip(page).waitFor({ state: 'detached', timeout }); return true; } catch { return false; }
}

try {
  const mail = `zz-hint-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  await db.from('tenants').insert(T).throwOnError();
  const roleId = randomUUID();
  await db.from('roles').insert({ id: roleId, tenant_id: T.id, name: 'Administrador', type: 'administrative' }).throwOnError();
  const ownerId = (await db.auth.admin.createUser({ email: T.admin_email, password: pw, email_confirm: true })).data.user.id;
  authIds.push(ownerId);
  await db.from('users').insert({
    id: ownerId, tenant_id: T.id, role_id: roleId, first_name: 'Owner', last_name: '', email: T.admin_email,
    permissions: { can_do_everything: true }, wage_type: 'monthly',
  }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookies = [...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' }));

  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── Escritorio ──
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desk.addCookies(cookies);
  const page = await desk.newPage();
  await page.goto(`${BASE}/tenants/${T.id}`);
  const country = page.locator('[data-hint="settings.country"] label');
  await country.waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  await country.hover();
  ok(await noTip(page, 200) || !(await tip(page).isVisible()), 'nothing shows before the delay');
  ok(await waitTip(page, 'Locked once the salon has sales'), 'hovering a label shows its description');
  ok(await insideViewport(page), 'the box stays inside the window');
  const lab = await country.boundingBox();
  const box = await tip(page).boundingBox();
  ok(box.y + box.height <= lab.y + 1, 'the box opens above the label, not over the field');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.mouse.move(5, 890);
  ok(await noTip(page), 'moving away hides it');

  await page.locator('[data-hint="settings.adminEmail"] input').hover();
  ok(await waitTip(page, 'Cash alerts go here'), 'hovering the field (not only the label) works');
  await page.mouse.move(5, 890);
  await noTip(page);

  await page.locator('[data-hint="settings.adminEmail"] input').click();
  await page.waitForTimeout(600);
  ok(!(await tip(page).isVisible().catch(() => false)), 'clicking into a field does not open it');
  await page.keyboard.press('Tab');
  ok(await waitTip(page, 'Sets currency, timezone'), 'tabbing into the next field opens its description');
  await page.keyboard.press('Escape');
  ok(await noTip(page), 'Escape closes it');

  await page.keyboard.press('Shift+Tab');
  ok(await waitTip(page, 'Cash alerts go here'), 'tabbing back opens it again');
  await page.keyboard.type('x');
  ok(await noTip(page), 'typing hides it');

  // Arriba de la pantalla: no hay lugar arriba, abre abajo.
  await page.evaluate(() => document.querySelector('[data-hint="stats.users"]')?.closest('.overflow-y-auto')?.scrollTo(0, 0));
  await page.locator('[data-hint="stats.customers"]').hover();
  ok(await waitTip(page, 'All customers'), 'stats tile description');
  ok(await insideViewport(page), 'near the top it still fits (flips below)');
  await page.mouse.move(5, 890);
  await noTip(page);

  // Cerca del borde derecho.
  await page.locator('[data-hint="link.openApp"]').hover();
  ok(await waitTip(page, 'your own session'), 'quick link description');
  ok(await insideViewport(page), 'near the edge it still fits');
  await page.mouse.move(5, 890);
  await noTip(page);

  // Una tarjeta.
  await page.locator('[data-hint="card.timeline"]').hover();
  ok(await waitTip(page, 'Opening it is logged'), 'card title description');
  await page.mouse.move(5, 890);
  await noTip(page);

  // Lista.
  await page.goto(`${BASE}/tenants?search=${encodeURIComponent(T.name)}`);
  const row = page.locator('a', { hasText: T.name });
  await row.waitFor({ timeout: 30_000 });
  const health = row.locator('[data-hint="health.new"]');
  await health.waitFor({ timeout: 30_000 });
  await health.hover();
  ok(await waitTip(page, 'Has never recorded a sale'), 'health badge description');
  await page.mouse.move(5, 890);
  await noTip(page);
  const setupBadge = row.locator('[data-hint="badge.setup"]');
  await setupBadge.waitFor({ timeout: 30_000 });   // llega con /api/tenants/onboarding, después de la lista
  await setupBadge.hover();
  ok(await waitTip(page, 'Next step:'), 'setup badge shows the next step');
  await page.mouse.move(5, 890);
  await noTip(page);
  await page.locator('[data-hint="list.health"]').hover();
  ok(await waitTip(page, 'Needs attention'), 'filter description');
  await page.mouse.move(5, 890);
  await noTip(page);

  await page.getByRole('button', { name: 'New' }).click();
  const createCountry = page.locator('[data-hint="create.country"] label');
  await createCountry.waitFor();
  await createCountry.hover();
  ok(await waitTip(page, 'locks once the salon records money'), 'New tenant form description');
  ok(await insideViewport(page), 'inside the window over the modal');
  const z = await tip(page).evaluate(el => getComputedStyle(el).zIndex);
  ok(Number(z) > 50, `drawn above the modal (z ${z})`);
  await page.mouse.move(5, 890);
  await noTip(page);
  await page.keyboard.press('Escape');

  // Usuarios.
  await page.goto(`${BASE}/tenants/${T.id}/users`);
  const adminBadge = page.locator('[data-hint="users.admin"]');
  await adminBadge.waitFor({ timeout: 30_000 });
  await adminBadge.hover();
  ok(await waitTip(page, 'full access'), 'users page badge description');
  await desk.close();

  // ── Teléfono ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await phone.addCookies(cookies);
  const m = await phone.newPage();
  await m.goto(`${BASE}/tenants/${T.id}`);
  const icon = m.locator('[data-hint="settings.adminEmail"] label button');
  await icon.waitFor({ timeout: 30_000 });
  await m.waitForLoadState('networkidle');
  await m.locator('[data-hint="settings.adminEmail"] input').tap();
  await m.waitForTimeout(600);
  ok(!(await tip(m).isVisible().catch(() => false)), 'tapping the field does not open it');
  await icon.scrollIntoViewIfNeeded();
  await icon.tap();
  ok(await waitTip(m, 'Cash alerts go here'), 'tapping ⓘ opens it on a phone');
  ok(await insideViewport(m), 'fits a phone screen');
  await icon.tap();
  ok(await noTip(m), 'tapping ⓘ again closes it');
  await icon.tap();
  await waitTip(m, 'Cash alerts go here');
  await m.locator('[data-hint="info.id"]').tap();
  ok(await noTip(m), 'tapping elsewhere closes it');

  const before = m.url();
  const usersIcon = m.locator('[data-hint="stats.users"] button');
  await usersIcon.scrollIntoViewIfNeeded();
  await usersIcon.tap();
  ok(await waitTip(m, 'Active users only'), 'ⓘ inside the Users tile opens the description');
  await m.waitForTimeout(500);
  ok(m.url() === before, 'and does not open the users page');
  await phone.close();
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  await db.from('tenants').delete().eq('id', T.id);
  for (const id of authIds) await db.auth.admin.deleteUser(id).catch(() => {});
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `ZZ_HINT_${tag}%`);
  console.log('leftovers:', left.count ?? 'unknown', 'tenants');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
