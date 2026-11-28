'use client';
import { useCallback, useEffect, useState } from 'react';
import Hint, { HintIcon } from '@/components/ui/Hint';
import { Bell, CalendarDays, ChevronDown, ChevronUp, Mail, MessageCircle, RefreshCw } from 'lucide-react';
import type { IntegrationReport } from '@/lib/integrationHealth';
import type { IntegrationKey, Level } from '@/lib/integrationRules';

// Estado de email, WhatsApp, Google Calendar y push del salón (lib/integrationRules.ts).
// Se carga aparte para no demorar el resto del detalle.

const ICON: Record<IntegrationKey, typeof Mail> = { email: Mail, whatsapp: MessageCircle, google: CalendarDays, push: Bell };

const LEVEL_LABEL: Record<Level, string> = { ok: 'Working', warning: 'Check', error: 'Failing', off: 'Off', unavailable: 'N/A' };
const LEVEL_STYLE: Record<Level, string> = {
  ok: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-700',
  error: 'bg-rose-50 text-rose-600',
  off: 'bg-slate-100 text-slate-500',
  unavailable: 'bg-slate-100 text-slate-400',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function IntegrationsCard({ tenantId }: { tenantId: string }) {
  const [report, setReport] = useState<IntegrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<IntegrationKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tenants/${tenantId}/integrations`);
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setReport(json);
      // Abre sola la primera que falla, para no tener que buscarla.
      const failing = (json as IntegrationReport).integrations.find(i => i.level === 'error' || i.level === 'warning');
      setOpen(current => current ?? failing?.key ?? null);
    } else {
      setError(json?.error ?? 'Could not load integrations');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
        <Hint id="card.integrations" className="flex-1">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Integrations <HintIcon /></p>
        </Hint>
        {report && (
          <Hint id="integration.level" inline>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${LEVEL_STYLE[report.level]}`}>{LEVEL_LABEL[report.level]}</span>
          </Hint>
        )}
        <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh integrations">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error ? (
        <p className="px-5 py-4 text-sm text-rose-600">{error}</p>
      ) : !report ? (
        <p className="px-5 py-4 text-xs text-slate-400">Loading...</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {report.integrations.map(i => {
            const Icon = ICON[i.key];
            const expanded = open === i.key;
            const hasMore = i.details.length > 0 || i.errors.length > 0;
            return (
              <li key={i.key}>
                <button type="button" onClick={() => hasMore && setOpen(expanded ? null : i.key)}
                  className={`w-full flex items-start gap-3 px-5 py-3 text-left ${hasMore ? 'hover:bg-slate-50' : 'cursor-default'}`}
                  aria-expanded={hasMore ? expanded : undefined}>
                  <Icon size={16} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{i.label}</p>
                    <p className="text-xs text-slate-500">{i.summary}</p>
                  </div>
                  <Hint id="integration.level" inline className="flex-shrink-0">
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${LEVEL_STYLE[i.level]}`}>{LEVEL_LABEL[i.level]}</span>
                  </Hint>
                  {hasMore && (expanded ? <ChevronUp size={14} className="text-slate-400 mt-0.5" /> : <ChevronDown size={14} className="text-slate-400 mt-0.5" />)}
                </button>
                {expanded && (
                  <div className="px-5 pb-4 pl-12 space-y-3">
                    {i.errors.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-bold text-slate-400">Recent errors</p>
                        <ul className="space-y-1">
                          {i.errors.map((e, n) => (
                            <li key={n} className="text-xs text-rose-700 bg-rose-50 rounded-lg px-2.5 py-1.5">
                              <span className="text-rose-400">{formatDate(e.at)}{e.who ? ` · ${e.who}` : ''} · </span>{e.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {i.details.length > 0 && (
                      <ul className="space-y-1">
                        {i.details.map((d, n) => <li key={n} className="text-xs text-slate-500">{d}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {report && (
        <p className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
          Last 30 days, from what the app records. Checked {formatDate(report.generatedAt)}.
        </p>
      )}
    </div>
  );
}
