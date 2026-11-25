import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

type Params = { params: { sessionId: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cierra una sesión de soporte: ya no se puede renovar y Auth la da por inexistente.
export async function POST(_req: Request, { params }: Params) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!UUID.test(params.sessionId)) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 });

  const db = createAdminClient();
  const { data: row } = await db
    .from('admin_impersonation_sessions')
    .select('tenant_id, admin_email, target_user_id')
    .eq('session_id', params.sessionId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not a support session' }, { status: 404 });

  const logged = await logAdminAction(session, 'impersonate.end', {
    tenantId: row.tenant_id,
    details: { session_id: params.sessionId, opened_by: row.admin_email, target_user_id: row.target_user_id },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { data: wasLive, error } = await db.rpc('admin_end_support_session', {
    p_session_id: params.sessionId,
    p_admin_email: session.user.email ?? '',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ended: true, wasLive: Boolean(wasLive) });
}
