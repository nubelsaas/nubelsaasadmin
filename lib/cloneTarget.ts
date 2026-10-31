import type { SupabaseClient } from '@supabase/supabase-js';

const EMPTINESS_CHECK_TABLES = ['branches', 'users', 'products_services', 'sales', 'customers', 'payment_accounts'] as const;

/**
 * Email del superadmin que ya tiene el tenant, o null si no tiene. Todo tenant nace con uno
 * (POST /api/tenants), y POST /api/tenants/[id]/admin rechaza un segundo con el mismo criterio.
 */
export async function findTenantSuperadmin(db: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await db.from('users').select('email, permissions').eq('tenant_id', tenantId);
  if (error) throw new Error(`Could not read users of tenant ${tenantId}`);

  const admin = (data ?? []).find(u => {
    const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions ?? {});
    return perms.can_do_everything === true;
  });
  return admin ? admin.email : null;
}

/**
 * Tablas con datos en el tenant destino de un clone; vacío = se puede clonar.
 * Lanza error si no se puede verificar: quien llama debe bloquear el clone, nunca asumir vacío,
 * porque si el clone falla el rollback automático borra todo el contenido del destino.
 */
export async function findTargetData(db: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .select('admin_email')
    .eq('id', tenantId)
    .single();
  if (tenantError || !tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const checks = await Promise.all(
    EMPTINESS_CHECK_TABLES.map(table => {
      let query = db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if (table === 'users' && tenant.admin_email) {
        query = query.neq('email', tenant.admin_email);
      }
      return query;
    })
  );

  const failed = EMPTINESS_CHECK_TABLES.find((_, i) => checks[i].error);
  if (failed) throw new Error(`Could not verify ${failed} on target tenant`);

  return EMPTINESS_CHECK_TABLES.filter((_, i) => (checks[i].count ?? 0) > 0);
}
