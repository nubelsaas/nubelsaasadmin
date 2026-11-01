import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { createAdminUserForTenant } from '@/lib/createAdminUser';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email, first_name, last_name, admin_name, password, require_new, additional } = await req.json();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const db = createAdminClient();

  // Verify tenant exists
  const { data: tenant } = await db.from('tenants').select('id').eq('id', params.id).single();
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

  // Reject if admin already exists for this tenant
  const { data: existing } = await db
    .from('users')
    .select('id, permissions')
    .eq('tenant_id', params.id);

  const hasAdmin = (existing ?? []).some(u => {
    const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions ?? {});
    return perms.can_do_everything === true;
  });

  // Si el dueño se fue y no hay más equipo, soporte agrega otro admin antes de desactivarlo.
  if (hasAdmin && additional !== true) return NextResponse.json({ error: 'This tenant already has an admin user' }, { status: 409 });

  const logged = await logAdminAction(session, 'tenant.admin_create', {
    tenantId: params.id,
    details: { email, mode: password ? 'manual' : 'invite' },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const resolvedName = admin_name || [first_name, last_name].filter(Boolean).join(' ');

  const result = await createAdminUserForTenant({
    tenantId: params.id,
    email,
    adminName: resolvedName,
    password:  password || undefined,
    requireNew: require_new === true,
  });

  if (!result.ok) {
    // require_new rejections are caller errors (email taken), not server faults.
    const status = result.error?.includes('ya está registrado') ? 409 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, userId: result.userId, roleId: result.roleId }, { status: 201 });
}
