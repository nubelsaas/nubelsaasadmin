import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { EXPORT_SPECS, buildExportZip, readAllRows } from '@/lib/tenantExport';

// El ZIP se arma en memoria y no se guarda: así no queda ninguna copia de los datos personales.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { reason } = await req.json().catch(() => ({ reason: null }));
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: tenant } = await db.from('tenants').select('name').eq('id', params.id).single();
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const logged = await logAdminAction(session, 'tenant.export', { tenantId: params.id, details: { reason: reason.trim() } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  try {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const spec of EXPORT_SPECS) tables[spec.file] = await readAllRows(db, spec, params.id);

    const { counts, zip } = buildExportZip(tenant.name, tables);
    await logAdminAction(session, 'tenant.export_finished', { tenantId: params.id, details: { rows: counts } });

    return new Response(Buffer.from(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="nubel-export.zip"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
