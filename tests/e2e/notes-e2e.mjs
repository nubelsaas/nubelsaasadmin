// Notas internas: dos superadmins sobre un salón desechable, por API y con un navegador real.
// Necesita supabase/migrations/20261125_admin_tenant_notes.sql en DEV. Usa Playwright (PLAYWRIGHT_DIR, CHROMIUM_PATH).
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
const tag = randomUUID().slice(0, 8);
const TENANT = { id: randomUUID(), name: `ZZ_NOTES_${tag}`, plan_id: '0afdfc73-a655-4cfc-9d8b-a19ff73a0df7' };
const pw = randomUUID();
const admins = [];
let browser, fails = 0;
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

/** Superadmin desechable con MFA; devuelve sus cookies y un fetch con ellas. */
async function portalAdmin(n) {
  const email = `zz-notes-${n}-${tag}@example.com`;
  const id = (await db.auth.admin.createUser({ email, password: pw, email_confirm: true })).data.user.id;
  admins.push(id);
  await db.from('admin_superadmins').insert({ user_id: id, email }).throwOnError();
  const jar = new Map();
  const c = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(x => jar.set(x.name, x.value)) } });
  await c.auth.signInWithPassword({ email, password: pw });
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'zz' });
  await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { id, email, jar, call };
}

try {
  const probe = await db.from('admin_tenant_notes').select('id', { head: true, count: 'exact' }).limit(1);
  if (probe.error) throw new Error(`admin_tenant_notes is missing on DEV: ${probe.error.message}`);

  await db.from('tenants').insert(TENANT).throwOnError();
  const a = await portalAdmin('a');
  const b = await portalAdmin('b');
  const notes = `/api/tenants/${TENANT.id}/notes`;

  // ── API ──
  ok((await a.call(notes, 'POST', { body: '   ' })).status === 400, 'empty note is rejected');
  ok((await a.call(notes, 'POST', { body: 'x'.repeat(5001) })).status === 400, 'too long note is rejected');
  ok((await a.call(`/api/tenants/${randomUUID()}/notes`, 'POST', { body: 'hi' })).status === 404, 'unknown salon is 404');

  const first = await a.call(notes, 'POST', { body: '  Called the owner, wants WhatsApp reminders.  ' });
  ok(first.status === 201 && first.json.body === 'Called the owner, wants WhatsApp reminders.' && first.json.author_email === a.email, 'note is created and trimmed');
  const second = await b.call(notes, 'POST', { body: 'Second note by B' });
  ok(second.status === 201, 'another admin adds a note');

  let list = await a.call(notes);
  ok(list.json.notes.map(n => n.id).join() === [second.json.id, first.json.id].join(), 'newest first');

  ok((await b.call(`${notes}/${first.json.id}`, 'PATCH', { pinned: true })).status === 200, 'any admin can pin');
  list = await a.call(notes);
  ok(list.json.notes[0].id === first.json.id && list.json.notes[0].pinned, 'pinned note goes first');
  ok(list.json.notes[0].updated_at === first.json.updated_at, 'pinning is not an edit');

  ok((await b.call(`${notes}/${first.json.id}`, 'PATCH', { body: 'hijack' })).status === 403, 'cannot edit someone else\'s note');
  ok((await b.call(`${notes}/${first.json.id}`, 'DELETE')).status === 403, 'cannot delete someone else\'s note');
  const edited = await a.call(`${notes}/${first.json.id}`, 'PATCH', { body: 'Called the owner. Reminders set up.' });
  ok(edited.status === 200 && edited.json.body === 'Called the owner. Reminders set up.', 'author edits');

  ok((await b.call(`${notes}/${second.json.id}`, 'DELETE')).status === 200, 'author deletes');
  list = await a.call(notes);
  ok(list.json.notes.length === 1, 'deleted note is hidden');
  const hidden = await db.from('admin_tenant_notes').select('body, deleted_at, deleted_by_email').eq('id', second.json.id).single();
  ok(hidden.data?.body === 'Second note by B' && hidden.data.deleted_at && hidden.data.deleted_by_email === b.email, 'deleted note keeps its text in the table');
  ok((await b.call(`${notes}/${second.json.id}`, 'PATCH', { pinned: true })).status === 404, 'deleted note cannot be changed');
  ok((await a.call(`/api/tenants/${randomUUID()}/notes/${first.json.id}`, 'PATCH', { pinned: false })).status === 404, 'note from another salon is 404');

  const logs = await db.from('admin_audit_logs').select('action, details').eq('tenant_id', TENANT.id).like('action', 'note.%');
  const actions = logs.data.map(l => l.action).sort().join();
  ok(actions === 'note.create,note.create,note.delete,note.pin,note.update', `every change is in the audit log (${actions})`);
  ok(logs.data.every(l => Object.keys(l.details).join() === 'note_id'), 'audit details carry only the note id');

  ok((await fetch(BASE + notes)).status !== 200, 'no session, no notes');
  ok((await db.from('admin_tenant_notes').select('id').eq('tenant_id', TENANT.id).then(r => r)).data.length === 2, 'service role sees both rows');
  const anonRead = await createClient(url, anon, { auth: { persistSession: false } }).from('admin_tenant_notes').select('id').eq('tenant_id', TENANT.id);
  ok(!anonRead.data?.length, 'anon key cannot read notes (RLS)');

  // ── Navegador ──
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await context.addCookies([...a.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await context.newPage();
  await page.goto(`${BASE}/tenants/${TENANT.id}`);
  await page.getByText('Called the owner. Reminders set up.').waitFor({ timeout: 30_000 });
  ok(await page.getByText('Pinned', { exact: true }).isVisible(), 'pinned label shows');

  await page.getByLabel('New note').fill('Added from the browser');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.locator('li[data-note]', { hasText: 'Added from the browser' }).waitFor({ timeout: 15_000 });
  const order = await page.locator('li[data-note] p.whitespace-pre-wrap').allTextContents();
  ok(order[0] === 'Called the owner. Reminders set up.' && order[1] === 'Added from the browser', `pinned stays above the new note (${order.join(' | ')})`);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  const added = page.locator('li[data-note]', { hasText: 'Added from the browser' });
  await added.getByLabel('Delete note').click();
  await added.getByRole('button', { name: 'Delete', exact: true }).click();
  await added.waitFor({ state: 'detached', timeout: 15_000 });
  ok(true, 'delete from the browser, with confirmation');

  // Las notas no bloquean borrar el salón (EMPTY_TENANT_TABLES) y se van con él.
  const del = await a.call(`/api/tenants/${TENANT.id}`, 'DELETE', { confirmName: TENANT.name });
  ok(del.status === 200, `a salon with notes can still be deleted (${del.status} ${JSON.stringify(del.json)})`);
  const orphan = await db.from('admin_tenant_notes').select('id').eq('tenant_id', TENANT.id);
  ok(orphan.data?.length === 0, 'notes go with the salon');
} catch (e) {
  fails++;
  console.log('ERROR', e.message ?? e);
} finally {
  await browser?.close();
  await db.from('admin_tenant_notes').delete().eq('tenant_id', TENANT.id);
  await db.from('tenants').delete().eq('id', TENANT.id);
  for (const id of admins) {
    await db.from('admin_audit_logs').delete().eq('admin_user_id', id);
    await db.from('admin_superadmins').delete().eq('user_id', id);
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  const left = await db.from('tenants').select('id', { count: 'exact', head: true }).eq('id', TENANT.id);
  console.log('leftovers:', left.count ?? 'unknown');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
}
