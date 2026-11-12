// Verifica 29 y 30 en DEV con fixtures desechables, contra el portal en 3003.
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';

const req = createRequire(import.meta.url);
const { createClient } = req('@supabase/supabase-js');
const { createServerClient } = req('@supabase/ssr');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('pwssiwhraoednhqghowi')) throw new Error('not DEV');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BASE = 'http://localhost:3003';
const P = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';
const tag = randomUUID().slice(0, 8);
const pw = randomUUID();
const tenants = [randomUUID(), randomUUID()];
const ids = [];
let fails = 0;
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
const mkUser = async (tenantId, roleId, key, perms) => {
  const email = `zz-c-${key}-${tag}@example.com`;
  const id = (await db.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user.id;
  ids.push(id);
  await db.from('users').insert({ id, tenant_id: tenantId, role_id: roleId, first_name: key, last_name: '', email, permissions: perms, wage_type: 'monthly' }).throwOnError();
  return { id, email };
};

try {
  const mail = `zz-portal-${tag}@example.com`;
  const adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  ids.push(adminId);
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const H = () => ({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' });
  const call = (path, method, body) => fetch(BASE + path, { method, headers: H(), body: body && JSON.stringify(body) });

  // Tenant A: dueño con contacto externo, como un salón real.
  const [ta, tb] = tenants;
  const ra = randomUUID();
  await db.from('tenants').insert({ id: ta, name: `ZZ_CA_${tag}`, plan_id: P, admin_email: `info-${tag}@salon.example` }).throwOnError();
  await db.from('roles').insert({ id: ra, tenant_id: ta, name: 'Administrador', type: 'administrative' }).throwOnError();
  const ownerA = await mkUser(ta, ra, 'ownera', { can_do_everything: true });

  let check = await (await call(`/api/clone/check-target?tenant_id=${ta}`, 'GET')).json();
  ok(check.empty === true, 'clone: tenant whose contact is not its login is still empty', JSON.stringify(check));

  const staffA = await mkUser(ta, ra, 'staffa', {});
  check = await (await call(`/api/clone/check-target?tenant_id=${ta}`, 'GET')).json();
  ok(check.empty === false && check.offendingTables.includes('users'), 'clone: a second user counts as data');
  await db.from('users').delete().eq('id', staffA.id);
  const ownerA2 = await mkUser(ta, ra, 'ownera2', { can_do_everything: true });
  check = await (await call(`/api/clone/check-target?tenant_id=${ta}`, 'GET')).json();
  ok(check.empty === false, 'clone: a second owner also counts, so rollback could never delete one');

  // Make owner no pisa el contacto.
  await db.from('users').update({ permissions: {} }).eq('id', ownerA2.id);
  let r = await call(`/api/tenants/${ta}/users/${ownerA2.id}/access`, 'POST', { action: 'make_owner', reason: 'support ticket' });
  ok(r.ok, `make owner ${r.status}`);
  const contact = async id => (await db.from('tenants').select('admin_email').eq('id', id).single()).data.admin_email;
  ok(await contact(ta) === `info-${tag}@salon.example`, 'make owner keeps the salon contact email');

  // Desactivar a quien no es el contacto no lo cambia.
  r = await call(`/api/tenants/${ta}/users/${ownerA.id}/access`, 'POST', { action: 'deactivate', reason: 'left salon' });
  ok(r.ok && await contact(ta) === `info-${tag}@salon.example`, 'deactivating someone else leaves the contact');

  // Tenant B: el contacto es el dueño que se va.
  const rb = randomUUID();
  await db.from('tenants').insert({ id: tb, name: `ZZ_CB_${tag}`, plan_id: P }).throwOnError();
  await db.from('roles').insert({ id: rb, tenant_id: tb, name: 'Administrador', type: 'administrative' }).throwOnError();
  const ownerB = await mkUser(tb, rb, 'ownerb', { can_do_everything: true });
  const ownerB2 = await mkUser(tb, rb, 'ownerb2', { can_do_everything: true });
  await db.from('tenants').update({ admin_email: ownerB.email.toUpperCase() }).eq('id', tb);
  r = await call(`/api/tenants/${tb}/users/${ownerB.id}/access`, 'POST', { action: 'deactivate', reason: 'owner left' });
  const j = await r.json();
  ok(r.ok && await contact(tb) === ownerB2.email && j.contactEmail === ownerB2.email, 'deactivating the contact moves it to another active owner (case-insensitive)', JSON.stringify(j));

  // Dashboard: contacto de un desactivado y sin contacto.
  await db.from('tenants').update({ admin_email: ownerB.email }).eq('id', tb);
  await db.from('tenants').update({ admin_email: null }).eq('id', ta);
  const html = await (await call('/', 'GET')).text();
  ok(html.includes('Contact email belongs to a deactivated user'), 'dashboard flags a contact that belongs to a deactivated user');
  ok(html.includes('No contact email'), 'dashboard flags a missing contact email');

  // 30: email que ya pertenece a otro salón.
  r = await call(`/api/tenants/${ta}/admin`, 'POST', { email: ownerB2.email, admin_name: 'X', password: randomUUID(), additional: true });
  const err = await r.json();
  ok(r.status === 409 && err.error.includes(`ZZ_CB_${tag}`), `email of another salon refused with its name: ${err.error}`);
  r = await call(`/api/tenants/${ta}/admin`, 'POST', { email: ownerA2.email.toUpperCase(), admin_name: 'X', password: randomUUID(), additional: true });
  ok(r.status === 409 && (await r.json()).error.includes('Make owner'), 'email already in this salon points to Make owner');
  const roles = (await db.from('roles').select('id', { count: 'exact', head: true }).eq('tenant_id', ta)).count;
  ok(roles === 1, 'no role was created for a refused admin');
  // "_" no debe actuar como comodín: zz-c-u_x no es zz-c-uyx.
  const under = await mkUser(tb, rb, 'u_x', {});
  const lookalike = under.email.replace('u_x', 'uyx');
  r = await call(`/api/tenants/${ta}/admin`, 'POST', { email: lookalike, admin_name: 'Look', password: randomUUID(), additional: true });
  const lj = await r.json();
  if (lj.userId) ids.push(lj.userId);
  ok(r.status === 201, `similar email with "_" is not treated as taken (${r.status} ${lj.error ?? ''})`);
  const created = await call('/api/tenants', 'POST', { name: `ZZ_CN_${tag}`, plan_id: P, admin_email: ownerB2.email, admin_name: 'Dup' });
  const cj = await created.json();
  ok(created.status === 409, `new tenant with a taken email refused: ${cj.error}`);
  ok(((await db.from('tenants').select('id').eq('name', `ZZ_CN_${tag}`)).data ?? []).length === 0, 'refused tenant is not left behind');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await db.from('admin_superadmins').delete().in('user_id', ids);
  for (const t of tenants) await db.from('tenants').delete().eq('id', t);
  await db.from('tenants').delete().like('name', `ZZ_CN_${tag}`);
  for (const id of ids) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`leftovers: tenants ${(await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', 'ZZ_%')).count}, zz users ${(await db.auth.admin.listUsers({ perPage: 1000 })).data.users.filter(u => u.email?.startsWith('zz-')).length}`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
