import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { IMPORT_FIELDS, IMPORT_TABLES, pickFields, splitDuplicates, type ImportEntity } from '@/lib/importFields';
import { hasFinancialHistory } from '@/lib/regionLock';
import { readAllRows } from '@/lib/tenantExport';

const UNDO_WINDOW_MS = 60 * 60 * 1000;

/** Importaciones del tenant que aún se pueden deshacer. Sale del audit log: sobrevive a recargar. */
export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from('admin_audit_logs')
    .select('id, action, details, created_at')
    .eq('tenant_id', tenantId)
    .in('action', ['import.finished', 'import.undone'])
    .gte('created_at', new Date(Date.now() - UNDO_WINDOW_MS).toISOString())
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const undone = new Set((data ?? []).filter(row => row.action === 'import.undone').map(row => row.details.importId));
  return NextResponse.json(
    (data ?? [])
      .filter(row => row.action === 'import.finished' && !undone.has(row.id))
      .map(row => ({ id: row.id, entity: row.details.entity, inserted: row.details.inserted, created_at: row.created_at }))
  );
}

export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { tenantId, entity, records, dryRun, confirmLive } = body as {
    tenantId: string;
    entity: string;
    records: Record<string, unknown>[];
    dryRun?: boolean;
    confirmLive?: boolean;
  };

  if (!tenantId || !entity || !Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'Missing tenantId, entity, or records' }, { status: 400 });
  }
  if (!(entity in IMPORT_TABLES)) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }
  const importEntity = entity as ImportEntity;

  const db = createAdminClient();
  const target = IMPORT_TABLES[importEntity];

  try {
    const existing = await readAllRows(db, { file: '', description: '', ...target, columns: [...target.columns] }, tenantId);
    const { fresh, duplicates } = splitDuplicates(importEntity, records, existing);
    // Si no se puede verificar se trata como salón con movimientos: pide confirmar de más, nunca de menos.
    const live = await hasFinancialHistory(db, tenantId).catch(() => true);

    if (dryRun) return NextResponse.json({ fresh: fresh.length, duplicates, live });
    if (live && confirmLive !== true) {
      return NextResponse.json({ error: 'This salon has financial records. Confirm before importing.' }, { status: 409 });
    }
    if (fresh.length === 0) return NextResponse.json({ count: 0, skipped: duplicates });

    const logged = await logAdminAction(session, 'import', {
      tenantId,
      details: { entity, records: records.length, skipped: duplicates, live },
    });
    if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

    const rows = await buildRows(db, importEntity, fresh, tenantId);

    // Un solo INSERT es atómico: si una fila falla no entra ninguna y reintentar no duplica.
    const { data, error } = await db.from(target.table).insert(rows).select('id');
    if (error) throw new Error(`${target.table}: ${error.message}`);

    await logAdminAction(session, 'import.finished', {
      tenantId,
      details: { entity, inserted: data.length, skipped: duplicates, ids: data.map(row => row.id) },
    });
    return NextResponse.json({ count: data.length, skipped: duplicates });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function buildRows(
  db: ReturnType<typeof createAdminClient>,
  entity: ImportEntity,
  records: Record<string, unknown>[],
  tenantId: string,
) {
  if (entity === 'categories') {
    return records.map(r => ({ name: r.name, type: r.type || 'service', tenant_id: tenantId }));
  }
  if (entity === 'clients') {
    return records.map(r => ({ ...pickFields(r, IMPORT_FIELDS.clients), tenant_id: tenantId }));
  }

  // Resolve category names → IDs using service role (bypasses RLS)
  const { data: cats } = await db.from('product_categories').select('id, name').eq('tenant_id', tenantId);
  const catMap: Record<string, string> = {};
  cats?.forEach(c => { catMap[(c.name as string).toLowerCase().trim()] = c.id as string; });

  return records.map(r => {
    const catName = ((r.category_name as string) ?? '').toLowerCase().trim();
    return { ...pickFields(r, IMPORT_FIELDS[entity]), tenant_id: tenantId, category_id: catMap[catName] ?? null };
  });
}
