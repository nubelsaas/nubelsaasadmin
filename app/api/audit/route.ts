import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tenantId  = searchParams.get('tenantId')  ?? null;
  const action    = searchParams.get('action')    ?? null;
  const tableName = searchParams.get('table')     ?? null;
  const from      = searchParams.get('from')      ?? null;
  const to        = searchParams.get('to')        ?? null;
  const page      = Math.max(0, parseInt(searchParams.get('page') ?? '0'));

  const db = createAdminClient();

  let q = db
    .from('audit_log')
    .select('id, tenant_id, user_id, action, table_name, record_id, timestamp, tenants!inner(name)', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (tenantId)  q = q.eq('tenant_id',  tenantId);
  if (action)    q = q.ilike('action',    `%${action}%`);
  if (tableName) q = q.ilike('table_name', `%${tableName}%`);
  if (from)      q = q.gte('timestamp',  from);
  if (to)        q = q.lte('timestamp',  to + 'T23:59:59Z');

  const { data, count, error } = await q;

  if (error) {
    // Fallback without join if FK alias fails
    let q2 = db
      .from('audit_log')
      .select('id, tenant_id, user_id, action, table_name, record_id, timestamp', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (tenantId)  q2 = q2.eq('tenant_id',  tenantId);
    if (action)    q2 = q2.ilike('action',    `%${action}%`);
    if (tableName) q2 = q2.ilike('table_name', `%${tableName}%`);
    if (from)      q2 = q2.gte('timestamp',  from);
    if (to)        q2 = q2.lte('timestamp',  to + 'T23:59:59Z');

    const { data: d2, count: c2, error: e2 } = await q2;
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ rows: d2 ?? [], total: c2 ?? 0, pageSize: PAGE_SIZE });
  }

  return NextResponse.json({ rows: data ?? [], total: count ?? 0, pageSize: PAGE_SIZE });
}
