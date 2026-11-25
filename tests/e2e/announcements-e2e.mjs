// Anuncios: el portal los crea y el app los lee con get_my_announcements() / dismiss_announcement()
// (nubelsaas, docs/database/announcements.sql, que debe estar en DEV). Dos salones desechables con
// dueños y un empleado. Todo anuncio de la prueba va dirigido a esos salones, para que ningún
// usuario real de DEV lo vea. Usa Playwright (PLAYWRIGHT_DIR, CHROMIUM_PATH).
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
const A = { id: randomUUID(), name: `ZZ_ANN_${tag} A`, plan_id: BASICO, country_iso: 'CO' };
const B = { id: randomUUID(), name: `ZZ_ANN_${tag} B`, plan_id: BASICO, country_iso: 'MX' };
const pw = randomUUID();
const authIds = [];
const annIds = [];
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

/** Usuario del salón con sesión propia (anon key + su JWT), como en el app. */
async function salonUser(tenant, label, owner, role) {
  const email = `zz-ann-${label}-${tag}@example.com`;
  const id = (await db.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user.id;
  authIds.push(id);
  await db.from('users').insert({
    id, tenant_id: tenant.id, role_id: role, first_name: label, last_name: '', email,
    permissions: owner ? { can_do_everything: true } : {}, wage_type: 'monthly',
  }).throwOnError();
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`${label} sign-in: ${error.message}`);
  const mine = async () => {
    const { data, error: e } = await client.rpc('get_my_announcements');
    if (e) throw new Error(`${label} get_my_announcements: ${e.message}`);
    return data.map(a => a.id);
  };
  const dismiss = async annId => (await client.rpc('dismiss_announcement', { p_announcement_id: annId })).data;
  return { id, client, mine, dismiss };
}

async function role(tenant) {
  const id = randomUUID();
  await db.from('roles').insert({ id, tenant_id: tenant.id, name: 'Administrador', type: 'administrative' }).throwOnError();
  return id;
}

try {
  const probe = await db.from('admin_announcements').select('id').limit(1);   // sin head: con head un 404 no trae mensaje
  if (probe.error) throw new Error(`admin_announcements is missing on DEV: ${probe.error.message}`);

  const mail = `zz-ann-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  for (const t of [A, B]) await db.from('tenants').insert(t).throwOnError();
  const [roleA, roleB] = [await role(A), await role(B)];
  const ownerA = await salonUser(A, 'owner-a', true, roleA);
  const staffA = await salonUser(A, 'staff-a', false, roleA);
  const ownerB = await salonUser(B, 'owner-b', true, roleB);

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const create = async body => {
    const r = await call('/api/announcements', 'POST', body);
    if (r.json?.id) annIds.push(r.json.id);
    return r;
  };
  const both = [A.id, B.id];

  // ── Portal: validación y alcance ──
  ok((await create({ title: 'x', level: 'info', link_url: 'http://nubel.tech', tenant_ids: both })).status === 400, 'http link is rejected');
  ok((await create({ title: 'x', level: 'info', starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z', tenant_ids: both })).status === 400, 'end before start is rejected');
  ok((await create({ title: ' ', level: 'info', tenant_ids: both })).status === 400, 'empty title is rejected');
  const reach = (await call('/api/announcements/reach', 'POST', { tenant_ids: both })).json;
  ok(reach?.salons === 2 && reach?.people === 3, `reach: 2 salons, 3 people (${JSON.stringify(reach)})`);
  const reachOwners = (await call('/api/announcements/reach', 'POST', { tenant_ids: both, owners_only: true })).json;
  ok(reachOwners?.people === 2, `owners only reaches the 2 owners (${JSON.stringify(reachOwners)})`);
  ok((await call('/api/announcements/reach', 'POST', { tenant_ids: both, countries: ['MX'] })).json?.salons === 1, 'filters combine');

  // ── Anuncios ──
  const everyone = (await create({ title: `${tag} Para todos`, body: 'Hola', level: 'info', link_url: 'https://nubel.tech', link_label: 'Ver', tenant_ids: both })).json;
  const owners = (await create({ title: `${tag} Solo dueños CO`, level: 'warning', owners_only: true, countries: ['CO'], tenant_ids: both })).json;
  const critical = (await create({ title: `${tag} Crítico B`, level: 'critical', tenant_ids: [B.id] })).json;
  const later = (await create({ title: `${tag} Mañana`, level: 'info', starts_at: new Date(Date.now() + 86_400_000).toISOString(), tenant_ids: both })).json;
  ok(everyone?.id && owners?.id && critical?.id && later?.id, 'four announcements created');

  // ── App: quién ve qué ──
  ok(JSON.stringify(await staffA.mine()) === JSON.stringify([everyone.id]), 'staff sees the general one only');
  const aSees = await ownerA.mine();
  ok(aSees.length === 2 && aSees.includes(everyone.id) && aSees.includes(owners.id), 'owner in CO also sees the owners-only one');
  ok(JSON.stringify(await ownerB.mine()) === JSON.stringify([critical.id, everyone.id]), 'critical first; MX owner does not get the CO one');
  ok(!(await staffA.mine()).includes(later.id), 'scheduled one is not shown yet');

  ok(await staffA.dismiss(everyone.id) === true, 'staff closes the general one');
  ok((await staffA.mine()).length === 0, 'and stops seeing it');
  ok((await ownerA.mine()).includes(everyone.id), 'closing is per person: the owner still sees it');
  ok(await ownerB.dismiss(critical.id) === false && (await ownerB.mine()).includes(critical.id), 'critical cannot be closed');
  ok(await staffA.dismiss(owners.id) === false, 'cannot close one that is not for you');
  ok(await staffA.dismiss(later.id) === false, 'cannot close a scheduled one');

  const direct = await staffA.client.from('admin_announcements').select('id').in('id', annIds);
  ok(!direct.data?.length, 'salon users cannot read the table directly');
  const receipts = await staffA.client.from('admin_announcement_receipts').select('user_id');
  ok(!receipts.data?.length, 'nor the receipts');
  const signedOut = await createClient(url, anon, { auth: { persistSession: false } }).rpc('get_my_announcements');
  ok(signedOut.error || !signedOut.data?.length, 'signed out gets nothing');

  // ── Portal: lista, edición, fin ──
  const list = (await call('/api/announcements')).json;
  const row = id => list.find(a => a.id === id);
  ok(row(everyone.id)?.status === 'live' && row(everyone.id).seen === 3 && row(everyone.id).dismissed === 1, `seen 3, closed 1 (${JSON.stringify({ s: row(everyone.id)?.seen, d: row(everyone.id)?.dismissed })})`);
  ok(row(later.id)?.status === 'scheduled', 'scheduled status');

  ok((await call(`/api/announcements/${everyone.id}`, 'PATCH', { title: 'changed', level: 'info', tenant_ids: both })).status === 409, 'live one cannot be edited');
  const edited = await call(`/api/announcements/${later.id}`, 'PATCH', { title: `${tag} Mañana (editado)`, level: 'warning', starts_at: later.starts_at, tenant_ids: [A.id] });
  ok(edited.status === 200 && edited.json.title.endsWith('(editado)') && edited.json.tenant_ids.length === 1, 'scheduled one can be edited');

  ok((await call(`/api/announcements/${everyone.id}/end`, 'POST')).status === 200, 'end a live one');
  ok(!(await ownerA.mine()).includes(everyone.id), 'ended one disappears from the app');
  ok((await call(`/api/announcements/${everyone.id}/end`, 'POST')).status === 409, 'ending twice is refused');
  ok((await call(`/api/announcements/${randomUUID()}/end`, 'POST')).status === 404, 'unknown is 404');
  ok((await fetch(`${BASE}/api/announcements`)).status !== 200, 'no session, no list');

  // Usuario desactivado: deja de recibir (el empleado: el único dueño no se puede desactivar).
  const forA = (await create({ title: `${tag} Para A`, level: 'info', tenant_ids: [A.id] })).json;
  ok((await staffA.mine()).includes(forA.id), 'staff sees a new one');
  await db.from('users').update({ is_active: false }).eq('id', staffA.id).throwOnError();
  const inactive = await staffA.client.rpc('get_my_announcements');
  ok(inactive.error || inactive.data.length === 0, 'a deactivated user gets nothing');

  const logs = await db.from('admin_audit_logs').select('action, details').eq('admin_user_id', adminId).like('action', 'announcement.%');
  const counts = logs.data.reduce((m, l) => ({ ...m, [l.action]: (m[l.action] ?? 0) + 1 }), {});
  ok(counts['announcement.create'] === 5 && counts['announcement.update'] === 1 && counts['announcement.end'] === 1, `audit log (${JSON.stringify(counts)})`);

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/announcements`);
  await page.getByText(`${tag} Crítico B`).waitFor({ timeout: 30_000 });
  ok(await page.getByRole('link', { name: 'Announcements' }).first().isVisible(), 'sidebar link');
  await page.getByLabel('Title').fill('Vista previa');
  ok(await page.getByText('Vista previa', { exact: true }).count() === 1, 'preview follows the title');
  await page.getByLabel('Search salons').fill(`ZZ_ANN_${tag} B`);
  await page.getByRole('button', { name: B.name }).click();
  await page.getByText('Reaches 1 salon, 1 person.').waitFor({ timeout: 10_000 });
  ok(true, 'picking a salon updates the reach');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  // Un salón con anuncios vistos se puede borrar igual (EMPTY_TENANT_TABLES).
  const del = await call(`/api/tenants/${B.id}`, 'DELETE', { confirmName: B.name });
  ok(del.status === 200, `a salon with announcement receipts can be deleted (${del.status} ${JSON.stringify(del.json)})`);
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  if (annIds.length) await db.from('admin_announcements').delete().in('id', annIds);
  await db.from('tenants').delete().in('id', [A.id, B.id]);
  for (const id of authIds) await db.auth.admin.deleteUser(id).catch(() => {});
  if (adminId) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', adminId);
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  const left = await db.from('admin_announcements').select('id', { count: 'exact', head: true }).like('title', `${tag}%`);
  const leftTenants = await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', `ZZ_ANN_${tag}%`);
  console.log('leftovers:', left.count ?? 'unknown', 'announcements,', leftTenants.count ?? 'unknown', 'tenants');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
