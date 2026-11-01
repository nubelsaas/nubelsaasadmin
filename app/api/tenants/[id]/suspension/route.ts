import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

// El motivo va al audit log y no al tenant: cualquier usuario del salón puede leer su propia fila.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { suspended, reason } = await req.json().catch(() => ({ suspended: null, reason: null }));
  if (typeof suspended !== 'boolean') return NextResponse.json({ error: 'suspended is required' }, { status: 400 });
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const logged = await logAdminAction(session, suspended ? 'tenant.suspend' : 'tenant.reactivate', {
    tenantId: params.id,
    details: { reason: reason.trim() },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const suspended_at = suspended ? new Date().toISOString() : null;
  const { data, error } = await createAdminClient()
    .from('tenants').update({ suspended_at }).eq('id', params.id).select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ suspended_at });
}
