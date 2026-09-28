import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = createAdminClient();
  const [{ data: tenant }, { count: activeUsers }, { count: branches }, { data: lastSaleData }, { count: customers }] = await Promise.all([
    db.from('tenants').select('id, name, admin_email, phone, city, country_iso, currency_code, timezone, plan_id, feature_overrides, settings, logo_url, created_at').eq('id', params.id).single(),
    db.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id).eq('is_active', true),
    db.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id).eq('is_active', true),
    db.from('sales').select('date_time').eq('tenant_id', params.id).order('date_time', { ascending: false }).limit(1),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id),
  ]);

  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    tenant,
    stats: { activeUsers: activeUsers ?? 0, branches: branches ?? 0, lastSale: lastSaleData?.[0]?.date_time ?? null, customers: customers ?? 0 },
  });
}

const PATCHABLE_FIELDS = new Set(['name', 'admin_email', 'phone', 'city', 'country_iso', 'phone_prefix', 'plan_id', 'feature_overrides', 'logo_url', 'settings', 'currency_code', 'timezone', 'is_audit_enabled']);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (PATCHABLE_FIELDS.has(key)) update[key] = body[key];
  }
  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.from('tenants').update(update).eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
