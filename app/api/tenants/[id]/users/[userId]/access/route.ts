import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

const AUDIT_ACTIONS = {
  deactivate: 'user.deactivate',
  reactivate: 'user.reactivate',
  make_owner: 'user.make_owner',
} as const;

// Sin ban, un usuario con is_active = false sigue entrando: la base de datos no revisa esa columna.
const BAN_FOREVER = '876000h';

export async function POST(req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action, reason } = await req.json().catch(() => ({ action: null, reason: null }));
  if (!(action in AUDIT_ACTIONS)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: user } = await db
    .from('users')
    .select('id, email, is_active, permissions')
    .eq('id', params.userId)
    .eq('tenant_id', params.id)
    .single();
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'deactivate') {
    const { data: portalAdmin } = await db.from('admin_superadmins').select('id').eq('user_id', user.id).maybeSingle();
    if (portalAdmin) return NextResponse.json({ error: 'Portal admins cannot be deactivated here' }, { status: 403 });
  }
  if (action === 'make_owner' && user.is_active === false) {
    return NextResponse.json({ error: 'Reactivate this user first' }, { status: 409 });
  }

  const logged = await logAdminAction(session, AUDIT_ACTIONS[action as keyof typeof AUDIT_ACTIONS], {
    tenantId: params.id,
    details: { email: user.email, reason: reason.trim() },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  if (action === 'make_owner') {
    const permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions ?? {});
    const { error } = await db.from('users').update({ permissions: { ...permissions, can_do_everything: true } }).eq('id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const deactivating = action === 'deactivate';
  const { error } = await db.from('users').update({ is_active: !deactivating }).eq('id', user.id);
  if (error?.message.includes('LAST_SUPERADMIN')) {
    return NextResponse.json({ error: 'This is the only owner. Make someone else the owner first.' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // El personal de un Demo Seed no tiene login: nada que bloquear.
  const { error: banError } = await db.auth.admin.updateUserById(user.id, { ban_duration: deactivating ? BAN_FOREVER : 'none' });
  if (banError && banError.status !== 404) {
    await db.from('users').update({ is_active: user.is_active }).eq('id', user.id);
    return NextResponse.json({ error: `Could not update the login: ${banError.message}` }, { status: 500 });
  }

  // admin_email es el correo de contacto (alertas de caja, invitaciones de citas): si era de quien se
  // desactiva, pasa a otro dueño activo para que esos correos no le sigan llegando.
  if (deactivating) {
    const { data: tenant } = await db.from('tenants').select('admin_email').eq('id', params.id).single();
    if (tenant?.admin_email?.toLowerCase() === user.email?.toLowerCase()) {
      const { data: owners } = await db.from('users').select('email, permissions').eq('tenant_id', params.id).eq('is_active', true);
      const next = (owners ?? []).find(o => {
        const perms = typeof o.permissions === 'string' ? JSON.parse(o.permissions) : (o.permissions ?? {});
        return perms.can_do_everything === true && o.email;
      });
      if (next) await db.from('tenants').update({ admin_email: next.email }).eq('id', params.id);
      return NextResponse.json({ ok: true, contactEmail: next?.email ?? null });
    }
  }
  return NextResponse.json({ ok: true });
}
