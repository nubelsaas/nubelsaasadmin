import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { applyAuditFilters, compactDetails, readAuditFilters } from '@/lib/auditQuery';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filters = readAuditFilters(name => searchParams.get(name));
  const page    = Math.max(0, parseInt(searchParams.get('page') ?? '0'));

  const db = createAdminClient();

  const q = applyAuditFilters(db
    .from('admin_audit_logs')
    .select('id, admin_email, action, tenant_id, details, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1), 'admin', filters);

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
    rows: rows.map(r => ({ ...r, details: compactDetails(r.details), tenant_name: names.get(r.tenant_id) ?? null })),
    total: count ?? 0,
    pageSize: PAGE_SIZE,
  });
}
