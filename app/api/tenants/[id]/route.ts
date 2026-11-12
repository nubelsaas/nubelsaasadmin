import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { AUDIT_FAILED, logAdminAction, logAdminView } from '@/lib/adminAudit';
import { findTargetData } from '@/lib/cloneTarget';
import { EMPTY_TENANT_TABLES, findTablesWithRows } from '@/lib/tenantTables';
import { changedRegionFields, hasFinancialHistory } from '@/lib/regionLock';
import { applyJsonChanges, isJsonChanges } from '@/lib/jsonChanges';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!await logAdminView(session, 'view.tenant', params.id)) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const db = createAdminClient();
  const [{ data: tenant }, regionLocked, { count: activeUsers }, { count: branches }, { data: lastSaleData }, { count: customers }] = await Promise.all([
    db.from('tenants').select('id, name, admin_email, phone, city, country_iso, currency_code, timezone, plan_id, feature_overrides, settings, logo_url, suspended_at, created_at').eq('id', params.id).single(),
    hasFinancialHistory(db, params.id).catch(() => true),
    db.from('users').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id).eq('is_active', true),
    db.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id).eq('is_active', true),
    db.from('transactions').select('date_time').eq('tenant_id', params.id).order('date_time', { ascending: false }).limit(1),
    db.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', params.id),
  ]);

  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    tenant,
    regionLocked,
    stats: { activeUsers: activeUsers ?? 0, branches: branches ?? 0, lastSale: lastSaleData?.[0]?.date_time ?? null, customers: customers ?? 0 },
  });
}

const PATCHABLE_FIELDS = new Set(['name', 'admin_email', 'phone', 'city', 'country_iso', 'phone_prefix', 'plan_id', 'logo_url', 'currency_code', 'timezone', 'is_audit_enabled']);
const JSON_FIELDS = ['feature_overrides', 'settings'] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (PATCHABLE_FIELDS.has(key)) update[key] = body[key];
  }

  const jsonChanges = JSON_FIELDS.filter(field => `${field}_changes` in body);
  if (jsonChanges.some(field => !isJsonChanges(body[`${field}_changes`]))) {
    return NextResponse.json({ error: 'Invalid changes' }, { status: 400 });
  }
  if (Object.keys(update).length === 0 && jsonChanges.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const db = createAdminClient();

  const { data: current } = await db
    .from('tenants')
    .select('country_iso, currency_code, timezone, phone_prefix, is_audit_enabled, feature_overrides, settings')
    .eq('id', params.id)
    .single();
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const changedRegion = changedRegionFields(current, update);
  if (changedRegion.length > 0) {
    try {
      if (await hasFinancialHistory(db, params.id)) {
        return NextResponse.json({ error: `This tenant has financial records, so ${changedRegion.join(', ')} can't change.` }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Could not verify the financial history. Nothing was changed.' }, { status: 500 });
    }
  }

  const disablingAudit = update.is_audit_enabled === false && current.is_audit_enabled !== false;
  const auditReason = typeof body.audit_reason === 'string' ? body.audit_reason.trim() : '';
  if (disablingAudit && auditReason.length < 5) {
    return NextResponse.json({ error: 'A reason is required to turn off the audit log' }, { status: 400 });
  }

  const logged = await logAdminAction(session, 'tenant.update', {
    tenantId: params.id,
    details: {
      changes: { ...update, ...Object.fromEntries(jsonChanges.map(field => [field, body[`${field}_changes`]])) },
      ...(disablingAudit && { audit_reason: auditReason }),
    },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  for (const field of jsonChanges) update[field] = applyJsonChanges(current[field], body[`${field}_changes`]);

  // Solo escribe si el JSON sigue como se leyó: entre leer y guardar pudo cambiarlo el salón.
  let query = db.from('tenants').update(update).eq('id', params.id);
  for (const field of jsonChanges) {
    query = current[field] === null ? query.is(field, null) : query.eq(field, JSON.stringify(current[field]));
  }
  const { data, error } = await query.select('feature_overrides, settings');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'This tenant just changed. Reload and try again.' }, { status: 409 });
  return NextResponse.json({ ok: true, ...data[0] });
}

/**
 * Borra un tenant vacío y sus logins. Solo vacío: el borrado no se puede deshacer, y las FK en
 * cascada se llevarían ventas y clientes. "Vacío" es el criterio del destino de un clone, más
 * cualquier otra tabla con filas del tenant, salvo las de EMPTY_TENANT_TABLES.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertSuperadmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { confirmName } = await req.json().catch(() => ({ confirmName: null }));

  const db = createAdminClient();
  const { data: tenant } = await db.from('tenants').select('name, admin_email').eq('id', params.id).single();
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (confirmName !== tenant.name) return NextResponse.json({ error: 'The tenant name does not match' }, { status: 400 });

  let offendingTables: string[];
  try {
    const [targetData, otherTables] = await Promise.all([
      findTargetData(db, params.id),
      findTablesWithRows(db, params.id, EMPTY_TENANT_TABLES),
    ]);
    offendingTables = Array.from(new Set([...targetData, ...otherTables]));
  } catch {
    return NextResponse.json({ error: 'Could not verify that the tenant is empty. Nothing was deleted.' }, { status: 500 });
  }
  if (offendingTables.length > 0) {
    return NextResponse.json({ error: `This tenant still has data: ${offendingTables.join(', ')}. Nothing was deleted.` }, { status: 409 });
  }

  // Se leen antes de borrar: la cascada se lleva las filas de users, pero no los logins de auth.users.
  const { data: users, error: usersError } = await db.from('users').select('id, email').eq('tenant_id', params.id);
  if (usersError || !users) return NextResponse.json({ error: 'Could not read the tenant users. Nothing was deleted.' }, { status: 500 });

  const { data: portalAdmins, error: portalAdminsError } = await db
    .from('admin_superadmins').select('user_id').in('user_id', users.map(u => u.id));
  if (portalAdminsError) return NextResponse.json({ error: 'Could not read the portal admins. Nothing was deleted.' }, { status: 500 });

  const logged = await logAdminAction(session, 'tenant.delete', {
    tenantId: params.id,
    details: { name: tenant.name, users: users.length },
  });
  if (!logged) return NextResponse.json({ error: AUDIT_FAILED }, { status: 500 });

  const { error } = await db.from('tenants').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Un login sin tenant no sirve, y su email quedaría bloqueado para un admin nuevo.
  const keep = new Set((portalAdmins ?? []).map(a => a.user_id));
  const logins = users.filter(u => !keep.has(u.id));
  const results = await Promise.all(logins.map(u => db.auth.admin.deleteUser(u.id)));
  const failedLogins = logins.filter((_, i) => results[i].error && results[i].error?.status !== 404).map(u => u.email);

  return NextResponse.json({ ok: true, failedLogins });
}
