import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminView } from '@/lib/adminAudit';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!await logAdminView(session, 'view.staff', params.id)) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { data, error } = await createAdminClient()
    .from('users')
    .select('id, first_name, last_name, email, is_active, permissions, roles(id, name, type)')
    .eq('tenant_id', params.id)
    .order('first_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
