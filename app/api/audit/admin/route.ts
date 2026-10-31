import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') ?? null;
  const action   = searchParams.get('action')   ?? null;
  const from     = searchParams.get('from')     ?? null;
  const to       = searchParams.get('to')       ?? null;
  const page     = Math.max(0, parseInt(searchParams.get('page') ?? '0'));

  const db = createAdminClient();

  let q = db
    .from('admin_audit_logs')
    .select('id, admin_email, action, tenant_id, details, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (tenantId) q = q.eq('tenant_id', tenantId);
  if (action)   q = q.ilike('action', `%${action}%`);
  if (from)     q = q.gte('created_at', from);
  if (to)       q = q.lte('created_at', to + 'T23:59:59Z');

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sin FK a tenants (el registro sobrevive al tenant), así que el nombre se resuelve aparte.
  const rows = data ?? [];
  const ids  = Array.from(new Set(rows.map(r => r.tenant_id).filter(Boolean)));
  const { data: tenants } = ids.length
    ? await db.from('tenants').select('id, name').in('id', ids)
    : { data: [] };
  const names = new Map((tenants ?? []).map(t => [t.id, t.name]));

  return NextResponse.json({
    rows: rows.map(r => ({ ...r, tenant_name: names.get(r.tenant_id) ?? null })),
    total: count ?? 0,
    pageSize: PAGE_SIZE,
  });
}
