import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await createAdminClient()
    .from('users')
    .select('id, first_name, last_name, email, is_active, permissions, roles(id, name, type)')
    .eq('tenant_id', params.id)
    .order('first_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
