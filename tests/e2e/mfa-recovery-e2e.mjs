// Recuperación de MFA: un superadmin "pierde" su autenticador, scripts/reset-mfa.mjs borra el
// factor, entra con la contraseña, /mfa le muestra un QR nuevo y vuelve a entrar. Contra el
// portal en 3003 con un navegador real (PLAYWRIGHT_DIR, CHROMIUM_PATH).
import { createRequire } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
const mail = `zz-mfa-${tag}@example.com`;
const pw = randomUUID();
let adminId, browser, fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); };
const totp = (s, offset = 0) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let b = '';
  for (const c of s.replace(/=+$/, '')) b += A.indexOf(c).toString(2).padStart(5, '0');
  const k = Buffer.from(b.match(/.{8}/g).map(x => parseInt(x, 2)));
  const m = Buffer.alloc(8);
  m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', k).update(m).digest();
  const f = h[19] & 15;
  return String((h.readUInt32BE(f) & 0x7fffffff) % 1e6).padStart(6, '0');
};
const session = async () => {
  const jar = new Map();
  const client = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  const { error } = await client.auth.signInWithPassword({ email: mail, password: pw });
  if (error) throw new Error(`sign-in: ${error.message}`);
  return { jar, client, cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
};
const api = async cookie => (await fetch(`${BASE}/api/announcements`, { headers: { cookie } })).status;
const reset = (email, confirm) => spawnSync('node', ['scripts/reset-mfa.mjs', email, '.env.dev.local'], {
  encoding: 'utf8', env: { ...process.env, ...(confirm !== undefined && { RESET_MFA_CONFIRM: confirm }) },
});

try {
  adminId = (await db.auth.admin.createUser({ email: mail, password: pw, email_confirm: true })).data.user.id;
  await db.from('admin_superadmins').insert({ user_id: adminId, email: mail }).throwOnError();

  // Enrolado y adentro.
  const first = await session();
  const en = await first.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'phone' });
  const oldSecret = en.data.totp.secret;
  await first.client.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(oldSecret) });
  ok(await api(first.cookie()) === 200, 'enrolled admin can use the portal');

  // El script se niega a lo que no debe.
  const notAdmin = reset(`zz-nobody-${tag}@example.com`);
  ok(notAdmin.status === 1 && /not a portal superadmin/.test(notAdmin.stderr), 'refuses an email that is not a superadmin');
  const wrongRef = reset(mail, 'buhljsqrfhrrrfzowhgl');
  ok(wrongRef.status === 1 && /does not match/.test(wrongRef.stderr), 'a wrong project ref changes nothing');
  ok((await db.auth.admin.mfa.listFactors({ userId: adminId })).data.factors.length === 1, 'factor still there after refusals');

  // Pierde el teléfono: reset.
  const done = reset(mail);
  ok(done.status === 0 && /Removed 1 MFA factor/.test(done.stdout), `script removes the factor (${(done.stdout + done.stderr).trim().split('\n')[0]})`);
  ok((await db.auth.admin.mfa.listFactors({ userId: adminId })).data.factors.length === 0, 'no factors left');
  const log = await db.from('admin_audit_logs').select('admin_email, details').eq('action', 'admin.mfa_reset').eq('admin_user_id', adminId);
  ok(log.data?.length === 1 && log.data[0].admin_email.startsWith('script:') && log.data[0].details.email === mail, 'reset is in the audit log');
  ok(!JSON.stringify(done.stdout + done.stderr).includes(process.env.SUPABASE_SERVICE_ROLE_KEY), 'script prints no keys');
  const oldStatus = await api(first.cookie());
  console.log(`  (an existing aal2 session after the reset answers ${oldStatus})`);

  // Entra con la contraseña: sin MFA no hay portal, y /mfa enrola de nuevo.
  const fresh = await session();
  ok(await api(fresh.cookie()) === 403, 'password alone gets no data');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext();
  await context.addCookies([...fresh.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/tenants`);
  await page.waitForURL(/\/mfa/, { timeout: 30_000 });
  await page.getByAltText('Authenticator QR code').waitFor({ timeout: 30_000 });
  ok(true, 'portal pages send them to /mfa, which shows a new QR');
  const newSecret = (await page.locator('p.font-mono').innerText()).trim();
  ok(newSecret && newSecret !== oldSecret, 'new secret, not the lost one');
  await page.getByPlaceholder('123456').fill(totp(newSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/mfa'), { timeout: 30_000 });
  const cookies = (await context.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  ok(await api(cookies) === 200, 'after enrolling again, back in the portal');

  // El autenticador perdido ya no sirve.
  const third = await session();
  const factors = (await third.client.auth.mfa.listFactors()).data.totp;
  ok(factors.length === 1, 'exactly one factor now');
  const stale = await third.client.auth.mfa.challengeAndVerify({ factorId: factors[0].id, code: totp(oldSecret) });
  ok(Boolean(stale.error), 'a code from the lost authenticator is rejected');
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
