import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { IMPORT_TABLES, type ImportEntity } from '@/lib/importFields';

const UNDO_WINDOW_MS = 60 * 60 * 1000;
const CHUNK = 200;

// Borra solo las filas que creó esa importación. Las que ya se usaron, por ejemplo un cliente con una
// venta, las protege su FK: quedan en su lugar y se informan.
export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { importId } = await req.json().catch(() => ({ importId: null }));
  if (!importId) return NextResponse.json({ error: 'importId required' }, { status: 400 });

  const db = createAdminClient();
  const { data: entry } = await db
    .from('admin_audit_logs')
    .select('id, tenant_id, details, created_at')
    .eq('id', importId)
    .eq('action', 'import.finished')
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (Date.now() - new Date(entry.created_at).getTime() > UNDO_WINDOW_MS) {
    return NextResponse.json({ error: 'Undo is only available for 1 hour after an import.' }, { status: 409 });
  }

  const { data: undone, error: undoneError } = await db
    .from('admin_audit_logs').select('id').eq('action', 'import.undone').contains('details', { importId }).limit(1);
  if (undoneError) return NextResponse.json({ error: undoneError.message }, { status: 500 });
  if (undone?.length) return NextResponse.json({ error: 'This import was already undone.' }, { status: 409 });

  const entity = entry.details.entity as ImportEntity;
  const ids = entry.details.ids as string[];
  const logged = await logAdminAction(session, 'import.undone', { tenantId: entry.tenant_id, details: { importId, entity } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const remove = (batch: string[]) =>
    db.from(IMPORT_TABLES[entity].table).delete({ count: 'exact' }).eq('tenant_id', entry.tenant_id).in('id', batch);

  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const { count, error } = await remove(batch);
    if (!error) { removed += count ?? 0; continue; }

    // Una fila en uso hace fallar todo el lote: se reintenta una por una para borrar las demás.
    for (const id of batch) {
      const single = await remove([id]);
      if (!single.error) removed += single.count ?? 0;
    }
  }

  const kept = ids.length - removed;
  await logAdminAction(session, 'import.undo_finished', { tenantId: entry.tenant_id, details: { importId, removed, kept } });
  return NextResponse.json({ removed, kept });
}
