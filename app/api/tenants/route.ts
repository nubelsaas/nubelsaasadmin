import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { createAdminUserForTenant } from '@/lib/createAdminUser';

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const search = req.nextUrl.searchParams.get('search') ?? '';
  const db = createAdminClient();
  let query = db
    .from('tenants')
    .select('id, name, admin_email, created_at, country_iso, feature_overrides, settings, is_audit_enabled')
    .order('country_iso', { nullsFirst: false })
    .order('name');
  if (search) query = query.ilike('name', `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const db = createAdminClient();

  if (!body.plan_id) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });

  // Invariante: todo tenant debe nacer con su Súper Administrador.
  const adminEmail: string | null = body.admin_email?.trim() || null;
  if (!adminEmail) return NextResponse.json({ error: 'admin_email is required' }, { status: 400 });

  const { data, error } = await db
    .from('tenants')
    .insert({
      name:          body.name,
      plan_id:       body.plan_id,
      admin_email:   body.admin_email   || null,
      phone:         body.phone         || null,
      city:          body.city          || null,
      country_iso:   body.country_iso   || null,
      phone_prefix:  body.phone_prefix  || null,
      currency_code: body.currency_code || null,
      timezone:      body.timezone      || null,
      logo_url:      body.logo_url      || null,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tenantId = data.id;

  const result = await createAdminUserForTenant({
    tenantId,
    email: adminEmail,
    adminName: body.admin_name || '',
  });

  // Si el admin no se pudo crear, revertimos el tenant: ningún tenant debe
  // quedar persistido sin un Súper Administrador.
  if (!result.ok) {
    await db.from('tenants').delete().eq('id', tenantId);
    return NextResponse.json(
      { error: `No se pudo crear el administrador del tenant: ${result.error ?? 'error desconocido'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: tenantId, adminCreated: true, adminError: null }, { status: 201 });
}
