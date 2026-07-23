'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';
import { countryLabel } from '@/lib/countries';

type Tenant  = { id: string; name: string; country_iso: string | null };
type AuditRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string;
  timestamp: string;
  tenants?: { name: string } | null;
};

const inputCls = 'rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

function AuditContent() {
  const searchParams = useSearchParams();

  // Filters
  const [tenantSearch,  setTenantSearch]  = useState('');
  const [tenantResults, setTenantResults] = useState<Tenant[]>([]);
  const [tenantFilter,  setTenantFilter]  = useState<Tenant | null>(null);
  const [searchingTenant, setSearchingTenant] = useState(false);
  const [tenantOpen,    setTenantOpen]    = useState(false);
  const [actionFilter,  setActionFilter]  = useState('');
  const [tableFilter,   setTableFilter]   = useState('');
  const [fromDate,      setFromDate]      = useState('');
  const [toDate,        setToDate]        = useState('');
  const [page,          setPage]          = useState(0);

  // Results
  const [rows,    setRows]    = useState<AuditRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);

  // Pre-select tenant from URL param
  useEffect(() => {
    const tid = searchParams.get('tenant');
    if (!tid) return;
    fetch(`/api/tenants/${tid}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.tenant) {
          const t = json.tenant as Tenant;
          setTenantFilter(t);
          setTenantSearch(t.name);
        }
      });
  }, [searchParams]);

  // Debounced tenant search
  useEffect(() => {
    if (!tenantSearch.trim()) { setTenantResults([]); return; }
    const t = setTimeout(async () => {
      setSearchingTenant(true);
      const res = await fetch(`/api/tenants?search=${encodeURIComponent(tenantSearch.trim())}`);
      setTenantResults(res.ok ? (await res.json()).slice(0, 7) : []);
      setSearchingTenant(false);
    }, 300);
    return () => clearTimeout(t);
  }, [tenantSearch]);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (tenantFilter) params.set('tenantId', tenantFilter.id);
    if (actionFilter) params.set('action',   actionFilter);
    if (tableFilter)  params.set('table',    tableFilter);
    if (fromDate)     params.set('from',     fromDate);
    if (toDate)       params.set('to',       toDate);

    const res = await fetch(`/api/audit?${params}`);
    const json = await res.json();
    setRows(json.rows ?? []);
    setTotal(json.total ?? 0);
    setPageSize(json.pageSize ?? 50);
    setLoading(false);
  }, [page, tenantFilter, actionFilter, tableFilter, fromDate, toDate]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  function selectTenant(t: Tenant) {
    setTenantFilter(t); setTenantSearch(t.name); setTenantOpen(false); setPage(0);
  }
  function clearTenant() {
    setTenantFilter(null); setTenantSearch(''); setPage(0);
  }

  const totalPages = Math.ceil(total / pageSize);

  function fmtTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const ACTION_COLOR: Record<string, string> = {
    INSERT: 'bg-emerald-50 text-emerald-700',
    UPDATE: 'bg-amber-50  text-amber-700',
    DELETE: 'bg-rose-50   text-rose-700',
  };

  return (
    <>
      <AdminHeader title="Audit Log" />
      <div className="p-4 md:p-6 space-y-4 h-full flex flex-col overflow-hidden">

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Filter size={14} className="text-slate-400" />
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">

            {/* Tenant search */}
            <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTenantOpen(false); }} tabIndex={-1}>
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" placeholder="All tenants" value={tenantSearch}
                onChange={e => { setTenantSearch(e.target.value); setTenantFilter(null); setTenantOpen(true); setPage(0); }}
                onFocus={() => setTenantOpen(true)}
                className={`${inputCls} w-full pl-8 pr-8`} />
              {tenantFilter && (
                <button onClick={clearTenant} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
              )}
              {tenantOpen && tenantSearch.trim() && !tenantFilter && (
                <div className="absolute z-20 top-full mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                  {searchingTenant ? (
                    <p className="text-xs text-slate-400 text-center py-3">Searching…</p>
                  ) : tenantResults.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">No tenants found</p>
                  ) : tenantResults.map(t => (
                    <button key={t.id} onMouseDown={() => selectTenant(t)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-xs text-slate-700 flex justify-between gap-2 border-b border-slate-50 last:border-0">
                      <span className="font-medium truncate">{t.name}</span>
                      <span className="text-slate-400 flex-shrink-0">{countryLabel(t.country_iso)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input type="text" placeholder="Action (e.g. INSERT)" value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setPage(0); }}
              className={inputCls} />

            <input type="text" placeholder="Table name" value={tableFilter}
              onChange={e => { setTableFilter(e.target.value); setPage(0); }}
              className={inputCls} />

            <div className="flex gap-2">
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
                className={`${inputCls} flex-1`} />
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
                className={`${inputCls} flex-1`} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto bg-white rounded-2xl border border-slate-200">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-sm text-slate-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-slate-400">No records found</div>
          ) : (
            <table className="w-full text-xs min-w-max">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Timestamp', 'Tenant', 'Action', 'Table', 'Record ID', 'User ID'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const tenantName = (row.tenants as { name: string } | null)?.name ?? null;
                  const actionKey  = row.action.toUpperCase();
                  const badgeCls   = ACTION_COLOR[actionKey] ?? 'bg-slate-100 text-slate-600';
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono">{fmtTime(row.timestamp)}</td>
                      <td className="px-4 py-2.5">
                        {tenantName ? (
                          <a href={`/tenants/${row.tenant_id}`} className="font-medium text-indigo-600 hover:underline">{tenantName}</a>
                        ) : (
                          <span className="font-mono text-slate-400">{row.tenant_id.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`font-black px-2 py-0.5 rounded-md ${badgeCls}`}>{row.action}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{row.table_name}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-400">{row.record_id.slice(0, 8)}…</td>
                      <td className="px-4 py-2.5 font-mono text-slate-400">
                        {row.user_id ? `${row.user_id.slice(0, 8)}…` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between flex-shrink-0 text-xs text-slate-500">
          <span>{total.toLocaleString()} total records</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
              <ChevronLeft size={13} /> Prev
            </button>
            <span className="px-2">Page {page + 1} of {Math.max(1, totalPages)}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>

      </div>
    </>
  );
}

// Wrap in Suspense because useSearchParams requires it in Next.js 14
export default function AuditPage() {
  return (
    <Suspense fallback={<><AdminHeader title="Audit Log" /><div className="p-8 text-sm text-slate-500">Loading…</div></>}>
      <AuditContent />
    </Suspense>
  );
}
