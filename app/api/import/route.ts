import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction } from '@/lib/adminAudit';
import { IMPORT_FIELDS, pickFields } from '@/lib/importFields';

const ALLOWED_ENTITIES = new Set(['categories', 'services', 'inventory', 'clients']);

export async function POST(req: NextRequest) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { tenantId, entity, records } = body as {
    tenantId: string;
    entity: string;
    records: Record<string, unknown>[];
  };

  if (!tenantId || !entity || !Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'Missing tenantId, entity, or records' }, { status: 400 });
  }
  if (!ALLOWED_ENTITIES.has(entity)) {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }

  const logged = await logAdminAction(session, 'import', { tenantId, details: { entity, records: records.length } });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const db = createAdminClient();

  // Un solo INSERT es atómico: si una fila falla no entra ninguna y reintentar no duplica.
  async function insertAll(table: string, rows: Record<string, unknown>[]) {
    const { error } = await db.from(table as any).insert(rows as any);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  try {
    if (entity === 'categories') {
      await insertAll('product_categories',
        records.map(r => ({ name: r.name, type: r.type || 'service', tenant_id: tenantId }))
      );
    }

    else if (entity === 'services' || entity === 'inventory') {
      // Resolve category names → IDs using service role (bypasses RLS)
      const { data: cats } = await db
        .from('product_categories').select('id, name').eq('tenant_id', tenantId);
      const catMap: Record<string, string> = {};
      cats?.forEach(c => { catMap[(c.name as string).toLowerCase().trim()] = c.id as string; });

      const rows = records.map(r => {
        const catName = ((r.category_name as string) ?? '').toLowerCase().trim();
        return { ...pickFields(r, IMPORT_FIELDS[entity]), tenant_id: tenantId, category_id: catMap[catName] ?? null };
      });
      await insertAll('products_services', rows);
    }

    else if (entity === 'clients') {
      await insertAll('customers',
        records.map(r => ({ ...pickFields(r, IMPORT_FIELDS.clients), tenant_id: tenantId }))
      );
    }

    return NextResponse.json({ count: records.length });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
