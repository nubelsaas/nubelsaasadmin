'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import AdminHeader from '@/components/layout/AdminHeader';
import TenantCreateModal from '@/components/tenants/TenantCreateModal';
import { countryLabel, groupByCountry } from '@/lib/countries';

type Tenant = { id: string; name: string; admin_email: string | null; created_at: string; country_iso: string | null };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tenants${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
    const data = res.ok ? await res.json() : [];
    setTenants(data);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const { sortedCodes: sortedCountries, groups } = groupByCountry(tenants);

  return (
    <>
      <AdminHeader title="Tenants" />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-4 py-2.5 text-sm">
            <Plus size={16} /><span className="hidden sm:inline">New</span>
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 text-center py-12">Loading...</div>
        ) : tenants.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-12">No results</div>
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
                  {groups[country].map(t => (
                    <Link key={t.id} href={`/tenants/${t.id}`}
                      className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-indigo-200 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                        <p className="text-xs text-slate-400 truncate">{t.admin_email ?? '—'}</p>
                      </div>
                      <p className="text-xs text-slate-400 flex-shrink-0">
                        {new Date(t.created_at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <TenantCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </>
  );
}
