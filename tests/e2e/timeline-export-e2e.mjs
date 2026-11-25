// Línea de tiempo del salón y exportación CSV del Audit Log. Un salón desechable con acciones del
// portal, una nota, una sesión de soporte y un anuncio; después la tarjeta y los CSV con filtros.
// Usa Playwright (PLAYWRIGHT_DIR, CHROMIUM_PATH).
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

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
const T = { id: randomUUID(), name: `ZZ_TL_${tag}`, plan_id: '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7', country_iso: 'CO', created_at: new Date(Date.now() - 86_400_000).toISOString() };
const pw = randomUUID();
const authIds = [];
let adminId, annId, browser, fails = 0;
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
/** CSV simple: celdas entre comillas con "" escapadas. */
const parseCsv = text => {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  return rows;
};

try {
  const mail = `zz-tl-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  await db.from('tenants').insert(T).throwOnError();
  const role = randomUUID();
  await db.from('roles').insert({ id: role, tenant_id: T.id, name: 'Administrador', type: 'administrative' }).throwOnError();
  const ownerMail = `zz-tl-owner-${tag}@example.com`;
  const ownerId = (await db.auth.admin.createUser({ email: ownerMail, password: pw, email_confirm: true })).data.user.id;
  authIds.push(ownerId);
  await db.from('users').insert({ id: ownerId, tenant_id: T.id, role_id: role, first_name: 'Owner', last_name: '', email: ownerMail, permissions: { can_do_everything: true }, wage_type: 'monthly' }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    // Bytes y no res.text(): text() se come el BOM.
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, bytes, text: bytes.toString('utf8') };
  };

  // Historia: suspender y reactivar, cambiar el nombre, una nota, una sesión de soporte, un anuncio.
  await call(`/api/tenants/${T.id}/suspension`, 'POST', { suspended: true, reason: `Prueba ${tag}, sin pago` });
  await call(`/api/tenants/${T.id}/suspension`, 'POST', { suspended: false, reason: 'Pagó, se reactiva' });
  await call(`/api/tenants/${T.id}`, 'PATCH', { name: `${T.name} renamed` });
  await call(`/api/tenants/${T.id}/notes`, 'POST', { body: 'Llamé a la dueña, quiere recordatorios.' });
  await db.from('admin_impersonation_sessions').insert({
    session_id: randomUUID(), admin_user_id: adminId, admin_email: mail, target_user_id: ownerId, tenant_id: T.id,
    reason: 'No le cuadra la caja', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  }).throwOnError();
  const ann = await call('/api/announcements', 'POST', { title: `${tag} Mantenimiento`, level: 'warning', tenant_ids: [T.id] });
  annId = JSON.parse(ann.text).id;
  await db.from('admin_announcement_receipts').insert({ announcement_id: annId, user_id: ownerId, tenant_id: T.id }).throwOnError();

  // ── Timeline ──
  const tl = await call(`/api/tenants/${T.id}/timeline`);
  const items = JSON.parse(tl.text).items;
  const titles = items.map(i => i.title);
  ok(tl.status === 200, 'timeline loads');
  ok(titles.at(-1) === 'Salon created', 'oldest is the creation');
  ok(titles.includes('Suspended') && titles.includes('Reactivated') && titles.includes('Settings changed'), 'portal actions');
  ok(items.find(i => i.title === 'Suspended').detail === `Reason: Prueba ${tag}, sin pago`, 'reason shown');
  ok(items.find(i => i.title === 'Settings changed').detail === 'name', 'which settings changed');
  ok(items.some(i => i.kind === 'note' && i.detail.startsWith('Llamé')), 'note');
  const sup = items.find(i => i.kind === 'support');
  ok(sup?.title === `Support session as ${ownerMail}` && /60-minute cap/.test(sup.detail), `support session (${sup?.detail})`);
  ok(items.some(i => i.kind === 'announcement' && /seen by 1, closed by 0/.test(i.detail)), 'announcement with this salon\'s reach');
  ok(!titles.some(t => t.startsWith('note.') || t.startsWith('view.')), 'no duplicate note or view rows');
  ok(items.every((x, i) => i === 0 || items[i - 1].at >= x.at), 'newest first');
  const viewLog = await db.from('admin_audit_logs').select('id').eq('admin_user_id', adminId).eq('action', 'view.timeline').eq('tenant_id', T.id);
  ok(viewLog.data?.length === 1, 'viewing it is recorded (view.timeline)');
  ok((await call(`/api/tenants/${randomUUID()}/timeline`)).status === 404, 'unknown salon is 404');

  // ── CSV: acciones del portal sobre este salón ──
  const csv = await call('/api/audit/export', 'POST', { view: 'admin', tenantId: T.id });
  ok(csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')), 'admin actions CSV');
  ok(/attachment; filename="audit-admin-actions-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.headers.get('content-disposition')), 'file name');
  ok(csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf, 'BOM for Excel');
  const rows = parseCsv(csv.text.slice(1));
  ok(rows[0].join() === 'created_at,admin_email,action,tenant_id,tenant_name,details', 'header');
  const actions = rows.slice(1).map(r => r[2]);
  ok(actions.includes('tenant.suspend') && actions.includes('note.create') && actions.includes('announcement.create') === false, `only this salon's rows (${actions.join(' ')})`);
  ok(!actions.some(a => a.startsWith('view.')), 'views left out like on screen');
  ok(rows.slice(1).every(r => r[4] === `${T.name} renamed`), 'salon name filled in');
  ok(rows.some(r => r[2] === 'tenant.suspend' && JSON.parse(r[5]).reason === `Prueba ${tag}, sin pago`), 'details as JSON in one cell');

  const withViews = parseCsv((await call('/api/audit/export', 'POST', { view: 'admin', tenantId: T.id, views: true })).text.slice(1));
  ok(withViews.slice(1).some(r => r[2] === 'view.timeline'), 'Include views adds them');
  const dated = parseCsv((await call('/api/audit/export', 'POST', { view: 'admin', tenantId: T.id, from: '2020-01-01', to: '2020-12-31' })).text.slice(1));
  ok(dated.length === 1, 'date filter (header only for 2020)');

  const exp = await db.from('admin_audit_logs').select('details').eq('admin_user_id', adminId).eq('action', 'audit.export');
  ok(exp.data?.length === 3 && exp.data.every(e => typeof e.details.rows === 'number' && e.details.view === 'admin'), 'every export is recorded with its filters and row count');
  ok((await fetch(`${BASE}/api/audit/export`, { method: 'POST', body: '{}' })).status === 403, 'no session, no export');

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, acceptDownloads: true });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/tenants/${T.id}`);
  await page.locator('[data-timeline="support"]').waitFor({ timeout: 30_000 });
  ok(await page.locator('[data-timeline]').count() >= 7, 'card lists the events');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  ok(await page.locator('[data-timeline]').count() === 1, 'kind filter');
  if (process.env.SHOT) await page.locator('text=Timeline').first().scrollIntoViewIfNeeded().then(() => page.screenshot({ path: process.env.SHOT }));

  await page.goto(`${BASE}/audit?tenant=${T.id}`);
  await page.getByRole('button', { name: 'Admin actions' }).click();
  const button = page.getByRole('button', { name: /Export CSV \(\d+\)/ });
  await button.waitFor({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const file = readFileSync(await download.path(), 'utf8');
  ok(download.suggestedFilename().startsWith('audit-admin-actions-') && file.includes('tenant.suspend'), `download from the page (${download.suggestedFilename()})`);
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  if (annId) await db.from('admin_announcements').delete().eq('id', annId);
  await db.from('admin_impersonation_sessions').delete().eq('tenant_id', T.id);
  await db.from('admin_tenant_notes').delete().eq('tenant_id', T.id);
  await db.from('tenants').delete().eq('id', T.id);
  for (const id of authIds) await db.auth.admin.deleteUser(id).catch(() => {});
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `ZZ_TL_${tag}%`);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
