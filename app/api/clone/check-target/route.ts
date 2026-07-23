import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

const EMPTINESS_CHECK_TABLES = ['branches', 'users', 'products_services', 'sales'] as const;

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

  const db = createAdminClient();

  // Fetch target tenant to check its admin_email
  const { data: tenant } = await db
    .from('tenants')
    .select('admin_email')
    .eq('id', tenantId)
    .single();
  const adminEmail = tenant?.admin_email;

  const checks = await Promise.all(
    EMPTINESS_CHECK_TABLES.map(table => {
      let query = db.from(table as any).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if (table === 'users' && adminEmail) {
        query = query.neq('email', adminEmail);
      }
      return query;
    })
  );
  const offendingTables = EMPTINESS_CHECK_TABLES.filter((_, i) => (checks[i].count ?? 0) > 0);

  return NextResponse.json({ empty: offendingTables.length === 0, offendingTables });
}
