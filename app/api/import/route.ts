import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

const ALLOWED_ENTITIES = new Set(['categories', 'services', 'inventory', 'clients']);

export async function POST(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

  const db = createAdminClient();
  let inserted = 0;

  async function batchInsert(table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from(table as any).insert(rows.slice(i, i + 100) as any);
      if (error) throw new Error(`${table}: ${error.message}`);
      inserted += rows.slice(i, i + 100).length;
    }
  }

  try {
    if (entity === 'categories') {
      await batchInsert('product_categories',
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
        const row: Record<string, unknown> = { ...r, tenant_id: tenantId };
        row.category_id = catMap[catName] ?? null;
        delete row.category_name;
        return row;
      });
      await batchInsert('products_services', rows);
    }

    else if (entity === 'clients') {
      await batchInsert('customers',
        records.map(r => ({ ...r, tenant_id: tenantId }))
      );
    }

    return NextResponse.json({ count: inserted });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
