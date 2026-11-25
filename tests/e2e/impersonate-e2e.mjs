// Sesión de soporte (Impersonate): lo hecho en ella queda en audit_log del app con el admin
// que la abrió (impersonated_by). También: tope de 60 minutos, lista de sesiones activas y End. Necesita en DEV docs/database/audit_impersonation.sql del
// repo nubelsaas y el portal en 3003.
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
const tenant = randomUUID();
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
const auditFor = async recordId =>
  (await db.from('audit_log').select('user_id, impersonated_by, impersonated_by_email').eq('table_name', 'customers').eq('record_id', recordId)).data ?? [];
const addCustomer = async (client, name) => {
  const id = randomUUID();
  const { error } = await client.from('customers').insert({ id, tenant_id: tenant, first_name: name, messaging_consent: false });
  return { id, error };
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
  const call = body => fetch(BASE + '/api/impersonate', { method: 'POST', headers: H(), body: JSON.stringify(body) });

  const role = randomUUID();
  await db.from('tenants').insert({ id: tenant, name: `ZZ_IMP_${tag}`, plan_id: P }).throwOnError();
  await db.from('roles').insert({ id: role, tenant_id: tenant, name: 'Administrador', type: 'administrative' }).throwOnError();
  const ownerEmail = `zz-i-owner-${tag}@example.com`;
  const ownerId = (await db.auth.admin.createUser({ email: ownerEmail, password: pw, email_confirm: true })).data.user.id;
  ids.push(ownerId);
  await db.from('users').insert({ id: ownerId, tenant_id: tenant, role_id: role, first_name: 'Owner', last_name: '', email: ownerEmail, permissions: { can_do_everything: true }, wage_type: 'monthly' }).throwOnError();

  let r = await call({ email: ownerEmail });
  ok(r.status === 400, `no reason, no session (${r.status})`);
  r = await call({ email: mail, reason: 'probar soporte' });
  ok(r.status === 404 || r.status === 403, `a portal admin cannot be impersonated (${r.status})`);

  r = await call({ email: ownerEmail, reason: 'probar atribución' });
  const j = await r.json();
  ok(r.ok && typeof j.link === 'string', `support session opened (${r.status} ${j.error ?? ''})`);
  const hash = new URLSearchParams(new URL(j.link).hash.slice(1));
  const access = hash.get('access_token'), refresh = hash.get('refresh_token');
  ok(!!access && !!refresh && hash.get('token_type') === 'bearer', 'link carries the session in the # fragment');
  const sessionId = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).session_id;
  const { data: rec } = await db.from('admin_impersonation_sessions').select('*').eq('session_id', sessionId).maybeSingle();
  ok(rec && rec.admin_user_id === adminId && rec.admin_email === mail && rec.target_user_id === ownerId && rec.tenant_id === tenant && rec.reason === 'probar atribución',
    `support session recorded before the link is handed over (${JSON.stringify(rec)})`);
  const { count: logged } = await db.from('admin_audit_logs').select('id', { count: 'exact', head: true }).eq('admin_user_id', adminId).eq('action', 'impersonate');
  ok(logged === 1, `portal audit log has the impersonate entry (${logged})`);

  // Lo que se hace en la sesión de soporte queda a nombre del dueño, marcado con el admin.
  const support = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const set = await support.auth.setSession({ access_token: access, refresh_token: refresh });
  ok(!set.error && set.data.user?.id === ownerId, `the link signs in as the salon user ${set.error?.message ?? ''}`);
  const a = await addCustomer(support, 'Hecho por soporte');
  ok(!a.error, `support session can work in the salon ${a.error?.message ?? ''}`);
  let rows = await auditFor(a.id);
  ok(rows.length === 1 && rows[0].user_id === ownerId && rows[0].impersonated_by === adminId && rows[0].impersonated_by_email === mail,
    `audit row marked with the admin (${JSON.stringify(rows)})`);

  // El dueño en su propia sesión: sin marca.
  const own = createClient(url, anon, { auth: { persistSession: false } });
  await own.auth.signInWithPassword({ email: ownerEmail, password: pw });
  const b = await addCustomer(own, 'Hecho por el dueño');
  rows = await auditFor(b.id);
  ok(rows.length === 1 && rows[0].user_id === ownerId && rows[0].impersonated_by === null, `owner's own session is not marked (${JSON.stringify(rows)})`);

  // Nadie puede escribir la marca a mano: el trigger la sobrescribe.
  const forged = randomUUID();
  await db.from('audit_log').insert({ tenant_id: tenant, user_id: ownerId, action: 'UPDATE', table_name: 'zz_forged', record_id: forged, impersonated_by: randomUUID(), impersonated_by_email: 'fake@x.co' });
  const { data: f } = await db.from('audit_log').select('impersonated_by, impersonated_by_email').eq('record_id', forged).maybeSingle();
  ok(f && f.impersonated_by === null && f.impersonated_by_email === null, `a forged mark is cleared (${JSON.stringify(f)})`);

  // ── Duración y cierre: admin_cap / admin_end / admin_support_session_status ──
  const exp = j.expiresAt * 1000;
  ok(Math.abs(exp - (Date.now() + 60 * 60_000)) < 5 * 60_000, `session capped at 60 minutes (${new Date(exp).toISOString()})`);
  const list = async () => (await fetch(BASE + '/api/impersonate/sessions', { headers: H() })).json();
  let listed = await list();
  ok(Array.isArray(listed) && listed.some(s => s.sessionId === sessionId && s.expiresAt && s.targetEmail === ownerEmail && s.tenantName === `ZZ_IMP_${tag}`),
    `active session listed with its end time (${JSON.stringify(listed).slice(0, 200)})`);

  const outsider = createClient(url, anon, { auth: { persistSession: false } });
  for (const [fn, args] of [
    ['admin_support_session_status', { p_session_ids: [sessionId] }],
    ['admin_cap_support_session', { p_session_id: sessionId, p_minutes: 480 }],
    ['admin_end_support_session', { p_session_id: sessionId, p_admin_email: 'x@x.co' }],
  ]) {
    const [r1, r2] = [await outsider.rpc(fn, args), await own.rpc(fn, args)];
    ok(!!r1.error && !!r2.error, `${fn} refused to anon and to salon users`);
  }

  const ownSession = JSON.parse(Buffer.from((await own.auth.getSession()).data.session.access_token.split('.')[1], 'base64url').toString()).session_id;
  const capOther = await db.rpc('admin_cap_support_session', { p_session_id: ownSession, p_minutes: 1 });
  ok(capOther.error?.message?.includes('NOT_A_SUPPORT_SESSION'), `cannot cap a normal user session (${capOther.error?.message})`);
  r = await fetch(`${BASE}/api/impersonate/sessions/${ownSession}/end`, { method: 'POST', headers: H() });
  ok(r.status === 404, `End refuses a normal user session (${r.status})`);
  ok(!(await own.auth.getUser()).error, "the owner's own session is untouched");

  const renewed = await support.auth.refreshSession();
  ok(!renewed.error, `support session renews before End ${renewed.error?.message ?? ''}`);
  const live = renewed.data.session;
  const before = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(live.access_token);
  ok(before.data.user?.id === ownerId, `Auth accepts the support token before End ${before.error?.message ?? ''}`);

  r = await fetch(`${BASE}/api/impersonate/sessions/${sessionId}/end`, { method: 'POST', headers: H() });
  const ended = await r.json();
  ok(r.ok && ended.wasLive === true, `End closes the live session (${JSON.stringify(ended)})`);
  const fresh = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const afterEnd = await fresh.auth.refreshSession({ refresh_token: live.refresh_token });
  ok(!!afterEnd.error, `ended session cannot renew (${afterEnd.error?.message})`);
  const who = await fresh.auth.getUser(live.access_token);
  ok(!!who.error, `Auth rejects the ended session's token (${who.error?.message})`);
  listed = await list();
  ok(!listed.some(s => s.sessionId === sessionId), 'ended session leaves the list');
  const { data: endRow } = await db.from('admin_impersonation_sessions').select('ended_at, ended_by_email').eq('session_id', sessionId).single();
  ok(endRow.ended_at && endRow.ended_by_email === mail, `end time and admin recorded (${JSON.stringify(endRow)})`);
  const { count: endLogged } = await db.from('admin_audit_logs').select('id', { count: 'exact', head: true }).eq('admin_user_id', adminId).eq('action', 'impersonate.end');
  ok(endLogged === 1, `portal audit log has impersonate.end (${endLogged})`);
  r = await fetch(`${BASE}/api/impersonate/sessions/${sessionId}/end`, { method: 'POST', headers: H() });
  ok(r.ok && (await r.json()).wasLive === false, 'ending twice is harmless');

  // El tope lo aplica Auth: una sesión con not_after vencido no se renueva.
  r = await call({ email: ownerEmail, reason: 'probar vencimiento' });
  const j2 = await r.json();
  const h2 = new URLSearchParams(new URL(j2.link).hash.slice(1));
  const s2 = JSON.parse(Buffer.from(h2.get('access_token').split('.')[1], 'base64url').toString()).session_id;
  await db.rpc('admin_cap_support_session', { p_session_id: s2, p_minutes: 1 }).throwOnError();
  console.log('     waiting 65 s for the 1-minute cap to pass…');
  await new Promise(done => setTimeout(done, 65_000));
  const expired = await fresh.auth.refreshSession({ refresh_token: h2.get('refresh_token') });
  ok(!!expired.error, `Auth refuses to renew past the cap (${expired.error?.message})`);
  listed = await list();
  ok(!listed.some(s => s.sessionId === s2), 'expired session leaves the list');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await db.from('audit_log').delete().eq('tenant_id', tenant);
  await db.from('admin_impersonation_sessions').delete().eq('tenant_id', tenant);
  await db.from('customers').delete().eq('tenant_id', tenant);
  await db.from('admin_audit_logs').delete().in('admin_user_id', ids);
  await db.from('admin_superadmins').delete().in('user_id', ids);
  await db.from('tenants').delete().eq('id', tenant);
  for (const id of ids) await db.auth.admin.deleteUser(id).catch(() => {});
  console.log(`leftovers: tenants ${(await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', 'ZZ_%')).count}, zz users ${(await db.auth.admin.listUsers({ perPage: 1000 })).data.users.filter(u => u.email?.startsWith('zz-')).length}`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
