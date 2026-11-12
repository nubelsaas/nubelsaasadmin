// Verifica salud y avisos en DEV con un cálculo independiente y fixtures desechables.
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { loadAlerts, loadTenantHealth } from '../../lib/tenantHealth.ts';

const req = createRequire(import.meta.url);
const { createClient } = req('@supabase/supabase-js');
const { createServerClient } = req('@supabase/ssr');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url.includes('pwssiwhraoednhqghowi')) throw new Error('not DEV');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const P = '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7';
const DAY = 86_400_000;
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
  const now = Date.now();
  const t0 = Date.now();
  const health = await loadTenantHealth(db, now);
  console.log(`   loaded ${health.length} tenants in ${Date.now() - t0}ms`);

  // Cálculo independiente, tenant por tenant, para comparar.
  const since30 = new Date(now - 30 * DAY).toISOString();
  const since60 = new Date(now - 60 * DAY).toISOString();
  let mismatches = [];
  for (const h of health) {
    const sum = async (from, to) => {
      let total = 0, n = 0, page = 0;
      while (true) {
        let q = db.from('transactions').select('total_sale_price').eq('tenant_id', h.id).neq('status', 'voided').gte('date_time', from);
        if (to) q = q.lt('date_time', to);
        const { data } = await q.order('id').range(page * 1000, page * 1000 + 999);
        data.forEach(r => { total += Number(r.total_sale_price || 0); n++; });
        if (data.length < 1000) return { total, n };
        page++;
      }
    };
    const a = await sum(since30);
    const b = await sum(since60, since30);
    const appts = (await db.from('appointments').select('id', { count: 'exact', head: true }).eq('tenant_id', h.id)
      .gte('start_time', since30).lte('start_time', new Date(now).toISOString()).not('status', 'in', '(cancelled,no_show)')).count;
    const staff = (await db.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', h.id).eq('is_active', true)).count;
    const diff = [
      a.n !== h.sales30 && `sales ${h.sales30}/${a.n}`,
      Math.round(a.total) !== Math.round(h.revenue30) && `rev ${h.revenue30}/${a.total}`,
      Math.round(b.total) !== Math.round(h.revenuePrev30) && `prev ${h.revenuePrev30}/${b.total}`,
      appts !== h.appointments30 && `appts ${h.appointments30}/${appts}`,
      staff !== h.activeStaff && `staff ${h.activeStaff}/${staff}`,
    ].filter(Boolean);
    if (diff.length) mismatches.push(`${h.name}: ${diff.join(' ')}`);
  }
  ok(mismatches.length === 0, `every tenant matches an independent count (${health.length})`, mismatches.join(' | '));
  const busiest = [...health].sort((x, y) => y.sales30 - x.sales30)[0];
  console.log(`   busiest: ${busiest.sales30} sales in 30 days, status ${busiest.status}`);
  ok(health.every(h => h.monthly.length === 6), 'six months of trend per tenant');

  // Fixture: audit apagado, sin dueño, salón callado.
  await db.from('tenants').insert({ id: tid, name: `ZZ_HEALTH_${tag}`, plan_id: P, is_audit_enabled: false }).throwOnError();
  const brid = randomUUID();
  await db.from('branches').insert({ id: brid, tenant_id: tid, name: 'B' }).throwOnError();
  await db.from('transactions').insert({ id: randomUUID(), tenant_id: tid, branch_id: brid, status: 'closed', total_sale_price: 100, date_time: new Date(now - 20 * DAY).toISOString() }).throwOnError();
  const h2 = await loadTenantHealth(db, now);
  const mine = h2.find(h => h.id === tid);
  ok(mine?.status === 'quiet', `last sale 20 days ago is quiet: ${mine?.status}`);
  const alerts = (await loadAlerts(db, h2, now)).filter(a => a.tenantId === tid).map(a => a.message);
  ok(alerts.some(m => m.includes('Audit log')), 'audit off alert');
  ok(alerts.some(m => m.includes('No active owner')), 'no owner alert');
  ok(alerts.some(m => m.includes('No sales')), 'quiet alert');

  // Impersonaciones: el aviso cuenta por admin en 24 horas.
  const spikeAdmin = `zz-spike-${tag}@example.com`;
  await db.from('admin_audit_logs').insert(Array.from({ length: 5 }, () => ({ admin_user_id: randomUUID(), admin_email: spikeAdmin, action: 'impersonate', tenant_id: tid, details: { email: 'x' } }))).throwOnError();
  const spike = (await loadAlerts(db, h2, now)).some(a => a.message.startsWith(spikeAdmin));
  ok(spike, 'impersonation spike alert');
  await db.from('admin_audit_logs').delete().eq('admin_email', spikeAdmin);

  // La página real con sesión y MFA.
  const mail = `zz-portal-${tag}@example.com`;
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();
  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email: mail, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const res = await fetch('http://localhost:3003/', { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const html = await res.text();
  ok(res.status === 200 && html.includes('Needs attention') && html.includes('Salon health') && html.includes('Est. monthly value'), `dashboard renders (${res.status})`);
  ok(html.includes(`ZZ_HEALTH_${tag}`) && html.includes('Audit log is turned off'), 'fixture alert shown on the page');
  ok(!html.includes('Could not load salon health'), 'no health error on the page');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await db.from('transactions').delete().eq('tenant_id', tid);
  await db.from('branches').delete().eq('tenant_id', tid);
  await db.from('tenants').delete().eq('id', tid);
  if (adminId) {
    await db.from('admin_superadmins').delete().eq('user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
  }
  console.log(`leftovers: tenants ${(await db.from('tenants').select('id', { count: 'exact', head: true }).like('name', 'ZZ_%')).count}`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
