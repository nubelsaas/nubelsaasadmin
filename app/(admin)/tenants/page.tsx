'use client';
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import AdminHeader from '@/components/layout/AdminHeader';
import TenantCreateModal from '@/components/tenants/TenantCreateModal';
import { countryLabel, groupByCountry } from '@/lib/countries';
import { STATUS_LABEL, STATUS_STYLE } from '@/lib/healthStatus';
import {
  DEFAULT_FILTERS, filterTenants, filtersFromParams, filtersToParams, sortTenants,
  type HealthSummary, type ListTenant, type TenantFilters,
} from '@/lib/tenantFilters';

type Plan = { id: string; name: string };

export default function TenantsPage() {
  // useSearchParams necesita un Suspense en una página cliente.
  return (
    <Suspense fallback={<AdminHeader title="Tenants" />}>
      <TenantsList />
    </Suspense>
  );
}

function TenantsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Los filtros viven en la URL: al volver desde un salón, la lista sigue filtrada.
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const [tenants, setTenants] = useState<ListTenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [health, setHealth] = useState<Record<string, HealthSummary> | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchText, setSearchText] = useState(filters.search);
  const pushedSearch = useRef(filters.search);

  const setFilters = useCallback((change: Partial<TenantFilters>) => {
    if (change.search !== undefined) pushedSearch.current = change.search;
    const query = filtersToParams({ ...filters, ...change });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  // Si la URL cambia por fuera (atrás/adelante del navegador), el cuadro de búsqueda la sigue.
  // Lo que escribió el propio cuadro no se copia de vuelta: pisaría lo tecleado mientras tanto.
  useEffect(() => {
    if (filters.search === pushedSearch.current) return;
    pushedSearch.current = filters.search;
    setSearchText(filters.search);
  }, [filters.search]);

  // La búsqueda se escribe en la URL con una pausa, para no reemplazarla en cada tecla.
  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ search: searchText }), 250);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, setFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [tenantsRes, plansRes] = await Promise.all([fetch('/api/tenants'), fetch('/api/plans')]);
    if (tenantsRes.ok) setTenants(await tenantsRes.json());
    else setLoadError((await tenantsRes.json().catch(() => ({}))).error ?? 'Could not load tenants');
    if (plansRes.ok) setPlans(await plansRes.json());
    setLoading(false);
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthError(false);
    const res = await fetch('/api/tenants/health');
    if (res.ok) setHealth(await res.json());
    else setHealthError(true);
  }, []);

  useEffect(() => { load(); loadHealth(); }, [load, loadHealth]);

  const planName = useMemo(() => new Map(plans.map(p => [p.id, p.name])), [plans]);
  const countries = useMemo(
    () => Array.from(new Set(tenants.map(t => t.country_iso ?? 'none'))).sort((a, b) => countryLabel(a === 'none' ? null : a).localeCompare(countryLabel(b === 'none' ? null : b))),
    [tenants],
  );
  const visible = useMemo(
    () => sortTenants(filterTenants(tenants, filters, health ?? undefined), filters.sort),
    [tenants, filters, health],
  );
  const { sortedCodes: sortedCountries, groups } = groupByCountry(visible);
  const filtered = filtersToParams({ ...filters, sort: DEFAULT_FILTERS.sort }) !== '';
  const waitingForHealth = filters.health !== 'all' && !health && !healthError;

  const selectCls = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <>
      <AdminHeader title="Tenants" />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search by name or contact email..." value={searchText} onChange={e => setSearchText(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-4 py-2.5 text-sm">
            <Plus size={16} /><span className="hidden sm:inline">New</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Plan" value={filters.plan} onChange={e => setFilters({ plan: e.target.value })} className={selectCls}>
            <option value="all">All plans</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">No plan</option>
          </select>
          <select aria-label="Status" value={filters.status} onChange={e => setFilters({ status: e.target.value as TenantFilters['status'] })} className={selectCls}>
            <option value="all">Active and suspended</option>
            <option value="active">Active only</option>
            <option value="suspended">Suspended only</option>
          </select>
          <select aria-label="Country" value={filters.country} onChange={e => setFilters({ country: e.target.value })} className={selectCls}>
            <option value="all">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c === 'none' ? 'No country' : countryLabel(c)}</option>)}
          </select>
          <select aria-label="Health" value={filters.health} onChange={e => setFilters({ health: e.target.value as TenantFilters['health'] })} className={selectCls}>
            <option value="all">Any health</option>
            <option value="attention">Needs attention</option>
            {(['active', 'quiet', 'declining', 'new', 'suspended'] as const).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select aria-label="Sort" value={filters.sort} onChange={e => setFilters({ sort: e.target.value as TenantFilters['sort'] })} className={selectCls}>
            <option value="name">Name A–Z</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {filtered && (
            <button onClick={() => { setSearchText(''); setFilters({ ...DEFAULT_FILTERS, sort: filters.sort }); }}
              className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 px-2 py-2">
              <X size={13} /> Clear filters
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-xs text-slate-400">
              {visible.length === tenants.length ? `${tenants.length} tenants` : `${visible.length} of ${tenants.length} tenants`}
            </span>
          )}
        </div>

        {healthError && (
          <p className="text-xs text-amber-700">
            Health couldn&apos;t be loaded, so the health filter and badges are unavailable.{' '}
            <button onClick={loadHealth} className="font-bold underline">Retry</button>
          </p>
        )}

        {loading || waitingForHealth ? (
          <div className="text-sm text-slate-500 text-center py-12">Loading...</div>
        ) : loadError ? (
          <div className="text-sm text-rose-600 text-center py-12">{loadError}</div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-12">{tenants.length ? 'No tenants match these filters' : 'No tenants yet'}</div>
        ) : (
          <div className="space-y-5">
            {sortedCountries.map(country => (
              <div key={country}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-black text-slate-700">{countryLabel(country)}</span>
                  <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                    {groups[country].length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {groups[country].map(t => {
                    const h = health?.[t.id];
                    return (
                      <Link key={t.id} href={`/tenants/${t.id}`}
                        className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-indigo-200 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {t.admin_email ?? '—'}
                            {t.plan_id && <span className="text-slate-300"> · {planName.get(t.plan_id) ?? 'Unknown plan'}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {h?.needsAttention && (
                            <span className="text-[10px] font-bold rounded-full bg-rose-50 text-rose-600 px-2 py-0.5">Needs attention</span>
                          )}
                          {h ? (
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${STATUS_STYLE[h.status]}`}>{STATUS_LABEL[h.status]}</span>
                          ) : t.suspended_at ? (
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${STATUS_STYLE.suspended}`}>{STATUS_LABEL.suspended}</span>
                          ) : null}
                        </div>
                        <p className="hidden sm:block text-xs text-slate-400 flex-shrink-0 w-16 text-right">
                          {new Date(t.created_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <TenantCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); loadHealth(); }} />
      )}
    </>
  );
}
