'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, RefreshCw } from 'lucide-react';
import type { OnboardingSummary } from '@/lib/onboardingRules';

// Checklist de arranque del salón (lib/onboardingRules.ts). Abierta mientras falte algo;
// cerrada cuando está completa.

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function OnboardingCard({ tenantId }: { tenantId: string }) {
  const [summary, setSummary] = useState<OnboardingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tenants/${tenantId}/onboarding`);
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setSummary(json);
      setOpen(current => current ?? !(json as OnboardingSummary).complete);
    } else {
      setError(json?.error ?? 'Could not load setup progress');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const badge = !summary ? null
    : summary.complete ? { text: 'Complete', cls: 'bg-emerald-50 text-emerald-600' }
    : summary.stuck ? { text: `Stuck · ${summary.done}/${summary.total}`, cls: 'bg-amber-50 text-amber-700' }
    : { text: `${summary.done}/${summary.total}`, cls: 'bg-slate-100 text-slate-500' };
  const pct = summary ? Math.round((summary.done / summary.total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="flex items-center gap-2 px-5 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} disabled={!summary}
          className="flex-1 flex items-center gap-2 text-left" aria-expanded={Boolean(open)}>
          <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Setup</span>
          {badge && <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.text}</span>}
          {summary && (open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />)}
        </button>
        <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh setup progress">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error ? (
        <p className="px-5 pb-4 text-sm text-rose-600">{error}</p>
      ) : !summary ? (
        <p className="px-5 pb-4 text-xs text-slate-400">Loading...</p>
      ) : open && (
        <div className="px-5 pb-4 space-y-3">
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${summary.complete ? 'bg-emerald-500' : summary.stuck ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {summary.stuck && (
            <p className="text-xs text-amber-700">
              Created {summary.daysSinceCreated} days ago and still no first sale. Next step: {summary.next}.
            </p>
          )}
          <ul className="space-y-2">
            {summary.steps.map(step => (
              <li key={step.key} className="flex items-start gap-2.5">
                {step.done
                  ? <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  : <Circle size={16} className="text-slate-300 mt-0.5 flex-shrink-0" />}
                <div className="min-w-0">
                  <p className={`text-sm ${step.done ? 'text-slate-700' : 'text-slate-900 font-medium'}`}>
                    {step.label}
                    {step.optional && <span className="ml-1.5 text-[10px] font-bold text-slate-400">optional</span>}
                    {step.at && <span className="ml-1.5 text-[11px] text-slate-400">{formatDate(step.at)}</span>}
                  </p>
                  <p className="text-xs text-slate-500">{step.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
