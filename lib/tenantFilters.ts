// Búsqueda, filtros y orden de la lista de tenants. Sin dependencias: lo usan la API
// (/api/tenants?search=, que también alimenta la búsqueda del encabezado) y la página, y se
// prueba con node --test.
import type { HealthStatus } from './healthStatus.ts';

export type ListTenant = {
  id: string;
  name: string;
  admin_email: string | null;
  created_at: string;
  country_iso: string | null;
  suspended_at: string | null;
  plan_id: string | null;
};

export type StatusFilter = 'all' | 'active' | 'suspended';
export type HealthFilter = 'all' | HealthStatus | 'attention';
export type SortKey = 'name' | 'newest' | 'oldest';

export type TenantFilters = {
  search: string;
  plan: string;        // 'all', 'none' (sin plan) o el id del plan
  status: StatusFilter;
  country: string;     // 'all', 'none' (sin país) o el código ISO
  health: HealthFilter;
  sort: SortKey;
};

/** Lo que la lista necesita de la salud de cada salón (lib/tenantHealth.ts). */
export type HealthSummary = { status: HealthStatus; needsAttention: boolean };

export const DEFAULT_FILTERS: TenantFilters = { search: '', plan: 'all', status: 'all', country: 'all', health: 'all', sort: 'name' };

/** Minúsculas y sin tildes: "Peluquería" se encuentra con "peluqueria". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca en el nombre y en el correo de contacto. Varias palabras deben aparecer todas. */
export function matchesSearch(t: Pick<ListTenant, 'name' | 'admin_email'>, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${normalize(t.name)} ${normalize(t.admin_email ?? '')}`;
  return words.every(word => haystack.includes(word));
}

export function filterTenants<T extends ListTenant>(
  tenants: T[],
  f: TenantFilters,
  health?: Record<string, HealthSummary>,
): T[] {
  return tenants.filter(t => {
    if (!matchesSearch(t, f.search)) return false;
    if (f.plan === 'none' ? t.plan_id !== null : f.plan !== 'all' && t.plan_id !== f.plan) return false;
    if (f.status === 'active' && t.suspended_at) return false;
    if (f.status === 'suspended' && !t.suspended_at) return false;
    if (f.country === 'none' ? t.country_iso !== null : f.country !== 'all' && t.country_iso !== f.country) return false;
    if (f.health !== 'all') {
      // Sin datos de salud todavía no se puede decidir: se oculta en vez de mostrar algo que quizá no aplica.
      const h = health?.[t.id];
      if (!h) return false;
      if (f.health === 'attention' ? !h.needsAttention : h.status !== f.health) return false;
    }
    return true;
  });
}

export function sortTenants<T extends ListTenant>(tenants: T[], sort: SortKey): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  const byDate = (a: T, b: T) => a.created_at.localeCompare(b.created_at);
  const compare = sort === 'newest' ? (a: T, b: T) => byDate(b, a) || byName(a, b)
    : sort === 'oldest' ? (a: T, b: T) => byDate(a, b) || byName(a, b)
    : byName;
  return [...tenants].sort(compare);
}

/** Lee los filtros de la URL; valores desconocidos vuelven al de por defecto. */
export function filtersFromParams(params: { get(name: string): string | null }): TenantFilters {
  const pick = <K extends string>(value: string | null, allowed: readonly K[], fallback: K): K =>
    value && (allowed as readonly string[]).includes(value) ? (value as K) : fallback;
  return {
    search: params.get('q') ?? '',
    plan: params.get('plan') || 'all',
    status: pick(params.get('status'), ['all', 'active', 'suspended'] as const, 'all'),
    country: params.get('country') || 'all',
    health: pick(params.get('health'), ['all', 'active', 'quiet', 'declining', 'new', 'suspended', 'attention'] as const, 'all'),
    sort: pick(params.get('sort'), ['name', 'newest', 'oldest'] as const, 'name'),
  };
}

/** Solo lo que difiere del valor por defecto, para que la URL quede corta. */
export function filtersToParams(f: TenantFilters): string {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set('q', f.search);
  if (f.plan !== 'all') params.set('plan', f.plan);
  if (f.status !== 'all') params.set('status', f.status);
  if (f.country !== 'all') params.set('country', f.country);
  if (f.health !== 'all') params.set('health', f.health);
  if (f.sort !== 'name') params.set('sort', f.sort);
  return params.toString();
}
