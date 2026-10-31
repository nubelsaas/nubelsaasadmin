import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { findTargetData, findTenantSuperadmin } from '@/lib/cloneTarget';

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });

  try {
    const db = createAdminClient();
    const [offendingTables, existingAdmin] = await Promise.all([
      findTargetData(db, tenantId),
      findTenantSuperadmin(db, tenantId),
    ]);
    return NextResponse.json({ empty: offendingTables.length === 0, offendingTables, existingAdmin });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
