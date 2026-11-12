// Verifica el registro de lecturas en DEV con fixtures desechables, contra el portal en 3003.
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
const tid = randomUUID();
const tag = tid.slice(0, 8);
const pw = randomUUID();
let fails = 0;
let adminId;
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
  const mail = `zz-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  await db.from('tenants').insert({ id: tid, name: `ZZ_VIEW_${tag}`, plan_id: P }).throwOnError();

  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const get = p => fetch(BASE + p, { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const views = async (action, tenant = tid) => {
    let q = db.from('admin_audit_logs').select('id', { count: 'exact', head: true }).eq('admin_user_id', adminId).eq('action', action);
    q = tenant ? q.eq('tenant_id', tenant) : q.is('tenant_id', null);
    return (await q).count;
  };

  ok((await get(`/api/tenants/${tid}`)).ok, 'tenant detail returns data');
  ok(await views('view.tenant') === 1, 'detail view logged');
  await get(`/api/tenants/${tid}`);
  await get(`/api/tenants/${tid}`);
  ok(await views('view.tenant') === 1, 'reloads within the hour add no entries');

  ok((await get(`/api/tenants/${tid}/users`)).ok, 'staff list returns data');
  ok(await views('view.staff') === 1, 'staff view logged');

  ok((await get(`/api/audit?tenantId=${tid}`)).ok, 'tenant activity returns data');
  ok(await views('view.activity') === 1, 'activity view logged for that tenant');
  ok((await get('/api/audit')).ok && await views('view.activity', null) === 1, 'activity of all tenants logged without a tenant');

  // Pasada la hora vuelve a registrar.
  await db.from('admin_audit_logs').update({ created_at: new Date(Date.now() - 2 * 3600e3).toISOString() }).eq('admin_user_id', adminId).eq('action', 'view.tenant');
  await get(`/api/tenants/${tid}`);
  ok(await views('view.tenant') === 2, 'a view after the hour is logged again');

  const hidden = await (await get(`/api/audit/admin?tenantId=${tid}`)).json();
  ok(!hidden.rows.some(r => r.action.startsWith('view.')), 'admin actions hide views by default');
  const shown = await (await get(`/api/audit/admin?tenantId=${tid}&views=1`)).json();
  ok(shown.rows.some(r => r.action === 'view.staff'), 'Include views shows them');
  const filtered = await (await get(`/api/audit/admin?tenantId=${tid}&action=view.tenant`)).json();
  ok(filtered.rows.length === 2, 'filtering by action shows views');

  const other = await db.from('admin_audit_logs').select('id', { count: 'exact', head: true }).eq('admin_user_id', adminId).not('action', 'like', 'view.%');
  ok(other.count === 0, 'reading logs no other action');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await db.from('tenants').delete().eq('id', tid);
  if (adminId) {
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
