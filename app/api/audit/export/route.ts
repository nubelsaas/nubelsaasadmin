import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import {
  EXPORT_COLUMNS, EXPORT_MAX_ROWS, applyAuditFilters, compactDetails, exportFileName, readAuditFilters, type AuditView,
} from '@/lib/auditQuery';
import { toCsv } from '@/lib/tenantExport';

const PAGE = 1000;

/**
 * CSV del Audit Log con los mismos filtros que la pantalla. POST y no GET: un link no debe poder
 * dispararla. Se registra (audit.export) antes de leer; si no se puede registrar, no sale nada.
 */
export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const view: AuditView = body?.view === 'admin' ? 'admin' : 'tenant';
  const filters = readAuditFilters(name => body?.[name]);
  const table = view === 'admin' ? 'admin_audit_logs' : 'audit_log';
  const columns = view === 'admin' ? 'admin_email, action, tenant_id, details, created_at' : 'tenant_id, user_id, action, table_name, record_id, timestamp';
  const order = view === 'admin' ? 'created_at' : 'timestamp';
  // Tabla elegida en tiempo de ejecución: sin tipos generados, para que TypeScript no se ahogue.
  const db = createAdminClient() as unknown as SupabaseClient;

  const { count, error: countError } = await applyAuditFilters(
    db.from(table).select('id', { count: 'exact', head: true }), view, filters);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > EXPORT_MAX_ROWS) {
    return NextResponse.json({ error: `${count} rows match. Narrow the filters (dates or salon) to ${EXPORT_MAX_ROWS.toLocaleString('en')} or fewer.` }, { status: 413 });
  }

  const logged = await logAdminAction(session, 'audit.export', {
    tenantId: filters.tenantId,
    details: { view, filters, rows: count ?? 0 },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  // Por páginas, ordenado por fecha e id para que ninguna fila se repita ni se salte.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyAuditFilters(
      db.from(table).select(columns).order(order, { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1),
      view, filters);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE || rows.length >= EXPORT_MAX_ROWS) break;
  }

  const ids = Array.from(new Set(rows.map(r => r.tenant_id as string).filter(Boolean)));
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('tenants').select('id, name').in('id', ids.slice(i, i + 200));
    for (const t of data ?? []) names.set(t.id, t.name);
  }
  const out = rows.map(r => ({
    ...r,
    tenant_name: names.get(r.tenant_id as string) ?? '',
    ...(view === 'admin' ? { details: compactDetails(r.details) } : {}),
  }));

  return new NextResponse(toCsv(EXPORT_COLUMNS[view], out), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(view, filters)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
