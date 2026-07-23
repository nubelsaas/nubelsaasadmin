import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db
    .from('expense_categories')
    .select('id, name, type, is_active, code')
    .is('tenant_id', null)
    .order('type')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name, type } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!type)         return NextResponse.json({ error: 'type is required' }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db
    .from('expense_categories')
    .insert({ name: name.trim(), type, is_active: true, tenant_id: null })
    .select('id, name, type, is_active, code')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
