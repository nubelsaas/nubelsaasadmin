import type { SupabaseClient } from '@supabase/supabase-js';

// Lo que queda en un tenant vacío: su admin, su rol y el historial.
export const EMPTY_TENANT_TABLES = new Set(['users', 'roles', 'audit_log', 'admin_audit_logs']);

/** Todas las tablas con `tenant_id`, leídas de la API: incluye las que el app principal agregue. */
async function listTenantTables(): Promise<string[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Could not list the database tables');

  const { definitions } = await res.json() as { definitions: Record<string, { properties?: Record<string, unknown> }> };
  return Object.keys(definitions).filter(table => definitions[table].properties?.tenant_id);
}

/** Tablas con filas del tenant, fuera de `ignored`. Lanza error si no se puede verificar. */
export async function findTablesWithRows(db: SupabaseClient, tenantId: string, ignored: Set<string>): Promise<string[]> {
  const tables = (await listTenantTables()).filter(table => !ignored.has(table));
  const checks = await Promise.all(
    tables.map(table => db.from(table).select('tenant_id', { count: 'exact', head: true }).eq('tenant_id', tenantId))
  );

  const failed = tables.find((_, i) => checks[i].error);
  if (failed) throw new Error(`Could not verify ${failed} on tenant ${tenantId}`);

  return tables.filter((_, i) => (checks[i].count ?? 0) > 0);
}
