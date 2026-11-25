import type { SupabaseClient } from '@supabase/supabase-js';
import { planDefault } from '@/lib/planFeatures';
import { onboardingSummary, type OnboardingSummary } from '@/lib/onboardingRules';

// Lee de la base lo que necesita el checklist de arranque (lib/onboardingRules.ts).
// Solo conteos (head: true) y fechas: no trae datos de clientes ni de ventas.

type TenantRow = { id: string; created_at: string; plan_id: string | null; feature_overrides: Record<string, unknown> | null };

const CONCURRENCY = 8;
const AUTH_PAGE = 1000;

export async function loadOnboarding(db: SupabaseClient, tenantIds?: string[], now = Date.now()): Promise<Record<string, OnboardingSummary>> {
  let tenantQuery = db.from('tenants').select('id, created_at, plan_id, feature_overrides');
  if (tenantIds) tenantQuery = tenantQuery.in('id', tenantIds);
  const [{ data: tenants, error }, { data: plans, error: plansError }, signIns] = await Promise.all([
    tenantQuery,
    db.from('subscription_plans').select('id, default_features'),
    lastSignIns(db),
  ]);
  if (error) throw new Error(error.message);
  if (plansError) throw new Error(plansError.message);

  const owners = await ownersByTenant(db, (tenants ?? []).map(t => t.id));
  const result: Record<string, OnboardingSummary> = {};
  const queue = [...(tenants ?? [])] as TenantRow[];

  // Unas pocas a la vez: cada salón son 7 conteos.
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const plan = plans?.find(p => p.id === t.plan_id);
      const fo = t.feature_overrides ?? {};
      const schedulerOn = typeof fo.enableScheduler === 'boolean'
        ? fo.enableScheduler
        : planDefault('enableScheduler', plan?.default_features) ?? false;
      const published = Array.isArray(fo.publicAllowedServices) ? fo.publicAllowedServices.length : 0;
      const ownerSignIns = (owners.get(t.id) ?? []).map(id => signIns.get(id)).filter((d): d is string => Boolean(d)).sort();

      const [services, paymentMethods, activeUsers, customers, appointments, sales, firstSale] = await Promise.all([
        countRows(db, 'products_services', t.id, q => q.eq('type', 'service').eq('is_active', true)),
        countRows(db, 'payment_accounts', t.id, q => q.eq('is_active', true)),
        countRows(db, 'users', t.id, q => q.eq('is_active', true)),
        countRows(db, 'customers', t.id),
        countRows(db, 'appointments', t.id),
        countRows(db, 'transactions', t.id, q => q.neq('status', 'voided')),
        db.from('transactions').select('date_time').eq('tenant_id', t.id).neq('status', 'voided')
          .order('date_time', { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (firstSale.error) throw new Error(firstSale.error.message);

      result[t.id] = onboardingSummary({
        createdAt: t.created_at,
        schedulerOn,
        ownerLastSignIn: ownerSignIns.at(-1) ?? null,
        services, paymentMethods, activeUsers, customers, appointments,
        publicServices: published,
        sales,
        firstSaleAt: firstSale.data?.date_time ?? null,
      }, now);
    }
  }));

  return result;
}

async function countRows(db: SupabaseClient, table: string, tenantId: string, filter?: (q: any) => any): Promise<number> {
  let query = db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/** Dueños activos (can_do_everything) por salón. */
async function ownersByTenant(db: SupabaseClient, tenantIds: string[]): Promise<Map<string, string[]>> {
  const owners = new Map<string, string[]>();
  if (!tenantIds.length) return owners;
  const { data, error } = await db.from('users').select('id, tenant_id, permissions').in('tenant_id', tenantIds).eq('is_active', true);
  if (error) throw new Error(error.message);
  for (const u of data ?? []) {
    const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions ?? {});
    if (perms.can_do_everything !== true) continue;
    owners.set(u.tenant_id, [...(owners.get(u.tenant_id) ?? []), u.id]);
  }
  return owners;
}

/** Último ingreso de cada login (Auth no guarda el primero). */
async function lastSignIns(db: SupabaseClient): Promise<Map<string, string>> {
  const signIns = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: AUTH_PAGE });
    if (error) throw new Error(`Auth: ${error.message}`);
    for (const u of data.users) if (u.last_sign_in_at) signIns.set(u.id, u.last_sign_in_at);
    if (data.users.length < AUTH_PAGE) return signIns;
  }
}
