'use client';
import { useCallback, useEffect, useState } from 'react';
import { Building2, Headset, History, Megaphone, RefreshCw, StickyNote, Wrench } from 'lucide-react';
import type { TimelineItem, TimelineKind } from '@/lib/timeline';

// Línea de tiempo del salón (lib/timeline.ts): acciones del portal, notas, sesiones de soporte y
// anuncios, la más nueva arriba.

const ICON: Record<TimelineKind, typeof History> = {
  created: Building2, action: Wrench, note: StickyNote, support: Headset, announcement: Megaphone,
};
const TONE: Record<TimelineKind, string> = {
  created: 'bg-emerald-50 text-emerald-600', action: 'bg-slate-100 text-slate-500', note: 'bg-amber-50 text-amber-700',
  support: 'bg-indigo-50 text-indigo-600', announcement: 'bg-rose-50 text-rose-600',
};
const FILTERS: { key: TimelineKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'action', label: 'Actions' }, { key: 'note', label: 'Notes' },
  { key: 'support', label: 'Support' }, { key: 'announcement', label: 'Announcements' },
];
const PAGE = 15;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TimelineCard({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TimelineKind | 'all'>('all');
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tenants/${tenantId}/timeline`);
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setItems(json.items);
      setUnavailable(json.unavailable ?? []);
    } else {
      setError(json?.error ?? 'Could not load the timeline');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const list = (items ?? []).filter(i => filter === 'all' || i.kind === filter);

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <p className="flex-1 flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-wider">
          <History size={13} /> Timeline
        </p>
        <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh timeline">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-3">
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!items && !error && <p className="text-xs text-slate-400">Loading...</p>}
        {items && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => { setFilter(f.key); setShown(PAGE); }} aria-pressed={filter === f.key}
                  className={`text-xs rounded-full px-3 py-1 border ${filter === f.key ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {unavailable.length > 0 && (
              <p className="text-xs text-amber-700">Not in this database yet: {unavailable.join(', ')}.</p>
            )}
            {list.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing here yet.</p>
            ) : (
              <ol className="relative border-l border-slate-100 ml-3 space-y-4">
                {list.slice(0, shown).map(item => {
                  const Icon = ICON[item.kind];
                  return (
                    <li key={item.id} className="ml-5" data-timeline={item.kind}>
                      <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${TONE[item.kind]}`}>
                        <Icon size={12} />
                      </span>
                      <p className="text-sm text-slate-800">{item.title}</p>
                      {item.detail && <p className="text-xs text-slate-500 whitespace-pre-line break-words">{item.detail}</p>}
                      <p className="text-[11px] text-slate-400">{formatDate(item.at)}{item.actor ? ` · ${item.actor}` : ''}</p>
                    </li>
                  );
                })}
              </ol>
            )}
            {list.length > shown && (
              <button onClick={() => setShown(s => s + PAGE)} className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50">
                Show {Math.min(PAGE, list.length - shown)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
