'use client';
import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { countryLabel } from '@/lib/countries';

type Tenant = { id: string; name: string; country_iso: string | null };

export default function AdminHeader({ title }: { title: string }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<Tenant[]>([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const ref    = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetch(`/api/tenants?search=${encodeURIComponent(query)}`);
      const data = res.ok ? await res.json() : [];
      setResults((data as Tenant[]).slice(0, 7));
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function navigate(id: string) {
    router.push(`/tenants/${id}`);
    setQuery('');
    setOpen(false);
  }

  return (
    <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-4 sticky top-0 z-40">
      <h1 className="text-base md:text-lg font-black text-slate-900 flex-shrink-0">{title}</h1>

      {/* Global tenant search — desktop only */}
      <div ref={ref} className="relative ml-auto hidden md:block w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search tenants…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query) setOpen(true); }}
          className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
        />
        {open && query.trim() && (
          <div className="absolute top-full mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-64 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-slate-400 text-center py-3">Searching…</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">No tenants found</p>
            ) : results.map(t => (
              <button key={t.id} onMouseDown={() => navigate(t.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">{t.name}</span>
                <span className="text-xs text-slate-400 flex-shrink-0">{countryLabel(t.country_iso)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
