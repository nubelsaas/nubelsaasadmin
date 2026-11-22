import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { openSupportSession } from '@/lib/impersonation';

export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email, reason } = await req.json();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: user } = await db.from('users').select('tenant_id').eq('email', email).maybeSingle();
  if (!user) return NextResponse.json({ error: 'Only tenant users can be impersonated' }, { status: 404 });

  // Entrar como otro admin del portal le daría sus permisos sin su MFA.
  const { data: portalAdmin } = await db.from('admin_superadmins').select('id').eq('email', email).maybeSingle();
  if (portalAdmin) return NextResponse.json({ error: 'Portal admins cannot be impersonated' }, { status: 403 });

  const logged = await logAdminAction(session, 'impersonate', { tenantId: user.tenant_id, details: { email, reason: reason.trim() } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  // Lo que el admin haga en esta sesión queda en audit_log del app con impersonated_by.
  const opened = await openSupportSession(db, {
    email,
    tenantId: user.tenant_id,
    reason: reason.trim(),
    admin: { id: session.user.id, email: session.user.email ?? '' },
    appUrl: process.env.MAIN_APP_URL ?? 'https://app.nubel.tech',
  });
  if ('error' in opened) return NextResponse.json({ error: opened.error }, { status: 500 });

  return NextResponse.json({ link: opened.link, expiresAt: opened.expiresAt });
}
