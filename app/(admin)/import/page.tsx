'use client';
import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';
import ImportSections from '@/components/import/ImportSections';
import { countryLabel } from '@/lib/countries';

type Tenant = { id: string; name: string; country_iso: string | null };

export default function ImportPage() {
  const [search,     setSearch]     = useState('');
  const [results,    setResults]    = useState<Tenant[]>([]);
  const [selected,   setSelected]   = useState<Tenant | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [open,       setOpen]       = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/tenants?search=${encodeURIComponent(search)}`);
      const data = res.ok ? await res.json() : [];
      setResults((data as Tenant[]).slice(0, 8));
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function selectTenant(t: Tenant) {
    setSelected(t);
    setSearch(t.name);
    setOpen(false);
  }

  return (
    <>
      <AdminHeader title="Import CSV" />
      <div className="p-4 md:p-8 max-w-3xl space-y-6">

        {/* Tenant selector */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div>
            <p className="text-sm font-black text-slate-700 mb-1">Target tenant</p>
            <p className="text-xs text-slate-400 mb-3">Select the tenant you want to import data into.</p>
            <div ref={ref} className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" placeholder="Search by name…" value={search}
                onChange={e => { setSearch(e.target.value); setSelected(null); setOpen(true); }}
                onFocus={() => setOpen(true)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {open && search.trim() && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                  {loading ? (
                    <p className="text-xs text-slate-400 text-center py-3">Searching…</p>
                  ) : results.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">No tenants found</p>
                  ) : results.map(t => (
                    <button key={t.id} onMouseDown={() => selectTenant(t)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700 border-b border-slate-50 last:border-0 flex items-center justify-between gap-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-slate-400">{countryLabel(t.country_iso)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selected && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
              <span className="font-black">Importing into:</span>
              <span>{selected.name}</span>
              <span className="font-mono text-slate-400 ml-auto">{selected.id.slice(0, 8)}…</span>
            </div>
          )}
        </div>

        {/* Import sections — only shown when a tenant is selected */}
        {selected && <ImportSections tenantId={selected.id} />}

      </div>
    </>
  );
}
