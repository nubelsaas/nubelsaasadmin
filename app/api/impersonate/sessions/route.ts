import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

export type ActiveSupportSession = {
  sessionId: string;
  adminEmail: string;
  tenantId: string | null;
  tenantName: string | null;
  targetEmail: string | null;
  reason: string;
  openedAt: string;
  expiresAt: string | null;   // null: sesión anterior al tope de 60 minutos, no vence sola
  lastSeen: string | null;
};

// Sesiones de soporte que siguen vivas en Auth. Solo las no cerradas desde el portal: las que
// se cerraron ya no existen en auth.sessions.
export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = createAdminClient();

  const { data: rows, error } = await db
    .from('admin_impersonation_sessions')
    .select('session_id, admin_email, tenant_id, target_user_id, reason, created_at')
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json([]);

  const { data: status, error: statusError } = await db.rpc('admin_support_session_status', {
    p_session_ids: rows.map(r => r.session_id),
  });
  if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });

  type Status = { session_id: string; active: boolean; not_after: string | null; last_seen: string | null };
  const byId = new Map((status as Status[]).map(s => [s.session_id, s]));
  const live = rows.filter(r => byId.get(r.session_id)?.active);
  if (!live.length) return NextResponse.json([]);

  const [{ data: tenants }, { data: users }] = await Promise.all([
    db.from('tenants').select('id, name').in('id', Array.from(new Set(live.map(r => r.tenant_id).filter(Boolean)))),
    db.from('users').select('id, email').in('id', live.map(r => r.target_user_id)),
  ]);

  const sessions: ActiveSupportSession[] = live.map(r => {
    const s = byId.get(r.session_id)!;
    return {
      sessionId: r.session_id,
      adminEmail: r.admin_email,
      tenantId: r.tenant_id,
      tenantName: tenants?.find(t => t.id === r.tenant_id)?.name ?? null,
      targetEmail: users?.find(u => u.id === r.target_user_id)?.email ?? null,
      reason: r.reason,
      openedAt: r.created_at,
      expiresAt: s.not_after,
      lastSeen: s.last_seen,
    };
  });
  return NextResponse.json(sessions);
}
