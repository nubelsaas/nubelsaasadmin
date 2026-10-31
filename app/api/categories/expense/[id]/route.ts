import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';

const PATCHABLE = new Set(['name', 'is_active', 'code']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (PATCHABLE.has(key)) update[key] = body[key];
  }
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const logged = await logAdminAction(session, 'category.update', { details: { id: params.id, changes: update } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const db = createAdminClient();
  const { error } = await db
    .from('expense_categories')
    .update(update)
    .eq('id', params.id)
    .is('tenant_id', null);   // safety: only update global categories

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
