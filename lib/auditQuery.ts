// Filtros del Audit Log, compartidos por la lista (GET /api/audit y /api/audit/admin) y la
// exportación CSV (POST /api/audit/export): el archivo trae exactamente lo que muestra la pantalla.

export type AuditView = 'tenant' | 'admin';

export type AuditFilters = {
  tenantId: string | null;
  action: string | null;
  table: string | null;     // solo vista tenant
  from: string | null;      // YYYY-MM-DD
  to: string | null;        // YYYY-MM-DD, incluido el día completo
  views: boolean;           // solo vista admin: incluir view.*
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Desde la URL (lista) o el cuerpo JSON (exportación). Fechas que no son YYYY-MM-DD se ignoran. */
export function readAuditFilters(get: (name: string) => unknown): AuditFilters {
  return {
    tenantId: text(get('tenantId')),
    action: text(get('action')),
    table: text(get('table')),
    from: day(get('from')),
    to: day(get('to')),
    views: get('views') === '1' || get('views') === true,
  };
}

// Lo mínimo del query builder de supabase-js que usan los filtros. Q queda genérico y sin
// restricciones: tipar el builder real hace que TypeScript se ahogue con tablas dinámicas.
type Builder = {
  eq(column: string, value: unknown): Builder;
  ilike(column: string, pattern: string): Builder;
  gte(column: string, value: string): Builder;
  lte(column: string, value: string): Builder;
  not(column: string, operator: string, value: string): Builder;
};

export function applyAuditFilters<Q>(query: Q, view: AuditView, f: AuditFilters): Q {
  let q = query as unknown as Builder;
  const time = view === 'admin' ? 'created_at' : 'timestamp';
  if (f.tenantId) q = q.eq('tenant_id', f.tenantId);
  if (f.action) q = q.ilike('action', `%${f.action}%`);
  if (view === 'tenant' && f.table) q = q.ilike('table_name', `%${f.table}%`);
  // Las vistas son muchas y rutinarias: se muestran solo si se piden o se filtra por acción.
  if (view === 'admin' && !f.views && !f.action) q = q.not('action', 'like', 'view.%');
  if (f.from) q = q.gte(time, f.from);
  if (f.to) q = q.lte(time, `${f.to}T23:59:59Z`);
  return q as unknown as Q;
}

/** Una importación guarda miles de ids para poder deshacerla: en pantalla y en el CSV basta la cantidad. */
export function compactDetails(details: unknown): unknown {
  const d = details as { ids?: unknown } | null;
  return d && Array.isArray(d.ids) ? { ...d, ids: d.ids.length } : details;
}

export const EXPORT_MAX_ROWS = 50_000;

export const EXPORT_COLUMNS: Record<AuditView, string[]> = {
  tenant: ['timestamp', 'tenant_id', 'tenant_name', 'action', 'table_name', 'record_id', 'user_id'],
  admin: ['created_at', 'admin_email', 'action', 'tenant_id', 'tenant_name', 'details'],
};

export function exportFileName(view: AuditView, f: AuditFilters, now = new Date()): string {
  const parts = ['audit', view === 'admin' ? 'admin-actions' : 'tenant-activity'];
  if (f.from || f.to) parts.push(`${f.from ?? 'start'}_to_${f.to ?? 'now'}`);
  parts.push(now.toISOString().slice(0, 10));
  return `${parts.join('-')}.csv`;
}
