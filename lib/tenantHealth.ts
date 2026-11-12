import type { SupabaseClient } from '@supabase/supabase-js';
import { getCloneRun } from '@/lib/cloneUndo';
import { QUIET_DAYS, classify, type HealthStatus } from '@/lib/healthStatus';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
export const IMPERSONATION_LIMIT = 5;
const MONTHS = 6;

export type { HealthStatus };

export type TenantHealth = {
  id: string;
  name: string;
  currency: string | null;
  planName: string | null;
  planPrice: number;
  suspended: boolean;
  auditOff: boolean;
  hasOwner: boolean;
  contactIssue: 'missing' | 'inactive' | null;
  lastSale: string | null;
  sales30: number;
  revenue30: number;
  revenuePrev30: number;
  appointments30: number;
  activeStaff: number;
  monthly: { month: string; revenue: number }[];
  status: HealthStatus;
};

export type PortalAlert = { severity: 'high' | 'info'; tenantId: string | null; tenantName: string | null; message: string };

/** Lee todas las filas o falla: el panel no puede mostrar totales incompletos como si fueran reales. */
async function readAll<T>(build: () => any): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const { data, count, error } = await build().range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (rows.length >= (count ?? 0) || !data?.length) {
      if (rows.length !== count) throw new Error(`Incomplete read: ${rows.length} of ${count}`);
      return rows;
    }
  }
}

const monthKey = (iso: string) => iso.slice(0, 7);

function lastMonths(now: number) {
  const date = new Date(now);
  return Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - (MONTHS - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export async function loadTenantHealth(db: SupabaseClient, now = Date.now()): Promise<TenantHealth[]> {
  const months = lastMonths(now);
  const since = `${months[0]}-01T00:00:00Z`;
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const since60 = new Date(now - 60 * DAY_MS).toISOString();

  const [{ data: tenants, error }, { data: plans }, sales, appointments, users] = await Promise.all([
    db.from('tenants').select('id, name, currency_code, plan_id, suspended_at, is_audit_enabled, admin_email').order('name'),
    db.from('subscription_plans').select('id, name, monthly_price'),
    readAll<{ tenant_id: string; date_time: string; total_sale_price: number }>(() =>
      db.from('transactions').select('tenant_id, date_time, total_sale_price', { count: 'exact' })
        .neq('status', 'voided').gte('date_time', since < since60 ? since : since60).order('id')),
    readAll<{ tenant_id: string }>(() =>
      db.from('appointments').select('tenant_id', { count: 'exact' })
        .gte('start_time', since30).lte('start_time', new Date(now).toISOString())
        .not('status', 'in', '(cancelled,no_show)').order('id')),
    readAll<{ tenant_id: string; permissions: unknown; email: string | null; is_active: boolean | null }>(() =>
      db.from('users').select('tenant_id, permissions, email, is_active', { count: 'exact' }).order('id')),
  ]);
  if (error || !tenants) throw new Error(error?.message ?? 'Could not read tenants');

  const lastSales = await Promise.all(tenants.map(t =>
    db.from('transactions').select('date_time').eq('tenant_id', t.id).neq('status', 'voided')
      .order('date_time', { ascending: false }).limit(1)
  ));

  return tenants.map((t, i) => {
    const plan = plans?.find(p => p.id === t.plan_id);
    const own = sales.filter(s => s.tenant_id === t.id);
    const sum = (rows: typeof own) => rows.reduce((total, s) => total + Number(s.total_sale_price || 0), 0);
    const last30 = own.filter(s => s.date_time >= since30);
    const everyone = users.filter(u => u.tenant_id === t.id);
    const staff = everyone.filter(u => u.is_active !== false);
    const contact = t.admin_email?.toLowerCase();
    const contactUser = everyone.find(u => u.email?.toLowerCase() === contact);
    const health = {
      id: t.id,
      name: t.name,
      currency: t.currency_code,
      planName: plan?.name ?? null,
      planPrice: Number(plan?.monthly_price ?? 0),
      suspended: Boolean(t.suspended_at),
      auditOff: t.is_audit_enabled === false,
      hasOwner: staff.some(u => {
        const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions ?? {});
        return perms.can_do_everything === true;
      }),
      // El contacto puede ser un correo externo (info@salon.co): solo se avisa si falta o si es de alguien desactivado.
      contactIssue: !contact ? 'missing' as const : contactUser?.is_active === false ? 'inactive' as const : null,
      lastSale: lastSales[i].data?.[0]?.date_time ?? null,
      sales30: last30.length,
      revenue30: sum(last30),
      revenuePrev30: sum(own.filter(s => s.date_time >= since60 && s.date_time < since30)),
      appointments30: appointments.filter(a => a.tenant_id === t.id).length,
      activeStaff: staff.length,
      monthly: months.map(month => ({ month, revenue: sum(own.filter(s => monthKey(s.date_time) === month)) })),
    };
    return { ...health, status: classify(health, now) };
  });
}

/** Lo que pide revisión. Se calcula al abrir el dashboard: el portal no envía avisos por fuera. */
export async function loadAlerts(db: SupabaseClient, health: TenantHealth[], now = Date.now()): Promise<PortalAlert[]> {
  const alerts: PortalAlert[] = [];
  const byId = new Map(health.map(h => [h.id, h]));
  const name = (id: string | null) => (id ? byId.get(id)?.name ?? 'Deleted tenant' : null);

  const { data: logs, error } = await db
    .from('admin_audit_logs')
    .select('action, admin_email, tenant_id, created_at')
    .or(`action.like.clone.%,action.eq.impersonate`)
    .gte('created_at', new Date(now - 30 * DAY_MS).toISOString());
  if (error) throw new Error(error.message);

  const cloned = Array.from(new Set((logs ?? []).filter(l => l.action.startsWith('clone.') && l.tenant_id).map(l => l.tenant_id as string)));
  const runs = await Promise.all(cloned.map(id => getCloneRun(db, id, now)));
  cloned.forEach((id, i) => {
    if (runs[i].state === 'interrupted') {
      alerts.push({ severity: 'high', tenantId: id, tenantName: name(id), message: 'A clone or Undo did not finish. Open Clone and use Undo to clean it up.' });
    }
  });

  const recent = (logs ?? []).filter(l => l.action === 'impersonate' && now - new Date(l.created_at).getTime() < DAY_MS);
  const perAdmin = new Map<string, number>();
  recent.forEach(l => perAdmin.set(l.admin_email, (perAdmin.get(l.admin_email) ?? 0) + 1));
  perAdmin.forEach((count, admin) => {
    if (count >= IMPERSONATION_LIMIT) {
      alerts.push({ severity: 'high', tenantId: null, tenantName: null, message: `${admin} impersonated users ${count} times in the last 24 hours.` });
    }
  });

  for (const h of health) {
    if (h.auditOff) alerts.push({ severity: 'high', tenantId: h.id, tenantName: h.name, message: 'Audit log is turned off.' });
    if (!h.hasOwner && !h.suspended) alerts.push({ severity: 'high', tenantId: h.id, tenantName: h.name, message: 'No active owner: nobody in the salon can manage it.' });
    if (h.contactIssue === 'missing') alerts.push({ severity: 'info', tenantId: h.id, tenantName: h.name, message: 'No contact email: cash alerts are not sent.' });
    if (h.contactIssue === 'inactive') alerts.push({ severity: 'high', tenantId: h.id, tenantName: h.name, message: 'Contact email belongs to a deactivated user: cash alerts still go to them.' });
    if (h.status === 'quiet') alerts.push({ severity: 'info', tenantId: h.id, tenantName: h.name, message: `No sales in more than ${QUIET_DAYS} days.` });
    if (h.status === 'declining') alerts.push({ severity: 'info', tenantId: h.id, tenantName: h.name, message: 'Revenue in the last 30 days fell by more than half.' });
    if (h.suspended) alerts.push({ severity: 'info', tenantId: h.id, tenantName: h.name, message: 'Suspended.' });
  }

  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}
