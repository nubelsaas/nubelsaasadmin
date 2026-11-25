// Recuperación de MFA: borra los factores TOTP de un superadmin que perdió su autenticador. Al
// volver a entrar con su contraseña, /mfa le muestra un QR nuevo. Ver docs/features/auth.md.
//
//   node scripts/reset-mfa.mjs <email> .env.dev.local     # DEV
//   node scripts/reset-mfa.mjs <email> .env.local         # PROD: pide escribir la referencia del proyecto
//
// Solo para usuarios de admin_superadmins. Queda en admin_audit_logs como admin.mfa_reset.
// Las claves nunca se imprimen.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';

const { createClient } = createRequire(import.meta.url)('@supabase/supabase-js');
const [email, envFile] = process.argv.slice(2);
if (!email || !envFile) {
  console.error('Usage: node scripts/reset-mfa.mjs <email> <.env file>');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = url?.match(/https:\/\/([a-z0-9]+)\./i)?.[1];
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY || !ref) throw new Error(`${envFile} has no Supabase URL or service key`);
const label = `${(env.NEXT_PUBLIC_NUBEL_ENV ?? '?').toUpperCase()} (${ref})`;

if (env.NEXT_PUBLIC_NUBEL_ENV !== 'dev' || process.env.RESET_MFA_CONFIRM) {
  const typed = process.env.RESET_MFA_CONFIRM ?? await (async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This resets MFA for ${email} on ${label}. Type the project ref to continue: `);
    rl.close();
    return answer;
  })();
  if (typed.trim() !== ref) {
    console.error('Project ref does not match. Nothing was changed.');
    process.exit(1);
  }
}

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: admin, error: adminError } = await db.from('admin_superadmins').select('user_id, email').ilike('email', email).maybeSingle();
if (adminError) throw new Error(adminError.message);
if (!admin) {
  console.error(`${email} is not a portal superadmin on ${label}. Nothing was changed.`);
  process.exit(1);
}

const { data: factors, error: listError } = await db.auth.admin.mfa.listFactors({ userId: admin.user_id });
if (listError) throw new Error(listError.message);
if (!factors.factors.length) {
  console.log(`${email} has no MFA factors on ${label}: they will be asked to enroll at the next sign-in.`);
  process.exit(0);
}

// Primero el registro: si no se puede registrar, no se toca nada (misma regla que el portal).
const { error: logError } = await db.from('admin_audit_logs').insert({
  admin_user_id: admin.user_id,
  admin_email: `script:${userInfo().username}`,
  action: 'admin.mfa_reset',
  tenant_id: null,
  details: { email: admin.email, factors: factors.factors.length },
});
if (logError) throw new Error(`Could not write the audit log, nothing was changed: ${logError.message}`);

for (const f of factors.factors) {
  const { error } = await db.auth.admin.mfa.deleteFactor({ id: f.id, userId: admin.user_id });
  if (error) throw new Error(`Could not delete factor ${f.id}: ${error.message}`);
}
console.log(`Removed ${factors.factors.length} MFA factor(s) for ${email} on ${label}.`);
console.log('Next sign-in with their password shows a new QR code at /mfa.');
