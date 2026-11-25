import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminView } from '@/lib/adminAudit';
import { applyAuditFilters, readAuditFilters } from '@/lib/auditQuery';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filters = readAuditFilters(name => searchParams.get(name));
  const page    = Math.max(0, parseInt(searchParams.get('page') ?? '0'));

  if (!await logAdminView(session, 'view.activity', filters.tenantId)) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const db = createAdminClient();

  const q = applyAuditFilters(db
    .from('audit_log')
    .select('id, tenant_id, user_id, action, table_name, record_id, timestamp, tenants!inner(name)', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1), 'tenant', filters);

  const { data, count, error } = await q;

  if (error) {
    // Fallback without join if FK alias fails
    const q2 = applyAuditFilters(db
      .from('audit_log')
      .select('id, tenant_id, user_id, action, table_name, record_id, timestamp', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1), 'tenant', filters);

    const { data: d2, count: c2, error: e2 } = await q2;
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    return NextResponse.json({ rows: d2 ?? [], total: c2 ?? 0, pageSize: PAGE_SIZE });
  }

  return NextResponse.json({ rows: data ?? [], total: count ?? 0, pageSize: PAGE_SIZE });
}
