import type { SupabaseClient } from '@supabase/supabase-js';

const EMPTINESS_CHECK_TABLES = ['branches', 'products_services', 'sales', 'customers', 'payment_accounts'] as const;

const isSuperadmin = (permissions: unknown) => {
  const perms = typeof permissions === 'string' ? JSON.parse(permissions) : (permissions ?? {});
  return perms.can_do_everything === true;
};

/**
 * Un tenant vacío tiene como mucho un usuario, y es un superadmin: el que crea POST /api/tenants.
 * Es el mismo criterio del rollback, que conserva exactamente un superadmin. No usa admin_email:
 * ese es el correo de contacto del salón y puede no ser de ningún usuario.
 */
export function hasExtraUsers(users: { permissions: unknown }[]) {
  return users.length > 1 || (users.length === 1 && !isSuperadmin(users[0].permissions));
}

/**
 * Email del superadmin que ya tiene el tenant, o null si no tiene. Todo tenant nace con uno
 * (POST /api/tenants), y POST /api/tenants/[id]/admin rechaza un segundo con el mismo criterio.
 */
export async function findTenantSuperadmin(db: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await db.from('users').select('email, permissions').eq('tenant_id', tenantId);
  if (error) throw new Error(`Could not read users of tenant ${tenantId}`);

  const admin = (data ?? []).find(u => isSuperadmin(u.permissions));
  return admin ? admin.email : null;
}

/**
 * Tablas con datos en el tenant destino de un clone; vacío = se puede clonar.
 * Lanza error si no se puede verificar: quien llama debe bloquear el clone, nunca asumir vacío,
 * porque si el clone falla el rollback automático borra todo el contenido del destino.
 */
export async function findTargetData(db: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: tenant, error: tenantError } = await db.from('tenants').select('id').eq('id', tenantId).single();
  if (tenantError || !tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const [users, ...checks] = await Promise.all([
    db.from('users').select('permissions').eq('tenant_id', tenantId),
    ...EMPTINESS_CHECK_TABLES.map(table =>
      db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    ),
  ]);

  if (users.error) throw new Error('Could not verify users on target tenant');
  const failed = EMPTINESS_CHECK_TABLES.find((_, i) => checks[i].error);
  if (failed) throw new Error(`Could not verify ${failed} on target tenant`);

  return [
    ...(hasExtraUsers(users.data ?? []) ? ['users'] : []),
    ...EMPTINESS_CHECK_TABLES.filter((_, i) => (checks[i].count ?? 0) > 0),
  ];
}
