'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, Upload, XCircle } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';
import {
  CATEGORY_LABEL, checkRequirements, diffSnapshots, parseSnapshot,
  type DiffCategory, type DiffItem, type DiffKind, type SchemaSnapshot,
} from '@/lib/schemaDiff';

// Estructura de la base (sin filas) y comparación con la del otro entorno. El portal solo tiene
// la clave de su propia base: la otra se compara subiendo su snapshot. Ver docs/features/schema.md.

const label = (s: SchemaSnapshot) => `${s.env.toUpperCase()} · ${s.project}`;
const formatDate = (iso: string) => (iso ? new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Acepta un snapshot o el archivo de `schema-diff.mjs --save` ({ dev: …, prod: … }): toma el del otro proyecto. */
function readUpload(text: string, current: SchemaSnapshot): SchemaSnapshot | null {
  const single = parseSnapshot(text);
  if (single) return single;
  try {
    const all = Object.values(JSON.parse(text) as Record<string, unknown>).map(v => parseSnapshot(JSON.stringify(v)));
    return all.find(s => s && s.project !== current.project) ?? all.find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export default function SchemaPage() {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [other, setOther] = useState<SchemaSnapshot | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [category, setCategory] = useState<DiffCategory | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/schema');
    const json = await res.json().catch(() => null);
    if (res.ok) setSnapshot(json);
    else setError(json?.error ?? 'Could not read the schema');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function download() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schema-${snapshot.env}-${snapshot.project}-${snapshot.generated_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(file: File | undefined) {
    if (!file || !snapshot) return;
    setUploadError(null);
    const parsed = readUpload(await file.text(), snapshot);
    if (!parsed) {
      setOther(null);
      setUploadError('That file is not a schema snapshot. Download one from the Schema page of the other environment.');
      return;
    }
    setOther(parsed);
    setCategory('all');
  }

  const readiness = useMemo(() => (snapshot ? checkRequirements(snapshot) : []), [snapshot]);
  const missing = readiness.filter(r => !r.ok);
  const diff = useMemo(() => (snapshot && other ? diffSnapshots(snapshot, other) : []), [snapshot, other]);
  const counts = useMemo(() => {
    const c = {} as Record<DiffCategory, number>;
    for (const i of diff) c[i.category] = (c[i.category] ?? 0) + 1;
    return c;
  }, [diff]);
  const shown = category === 'all' ? diff : diff.filter(i => i.category === category);

  const groups: { kind: DiffKind; title: string; tone: string }[] = snapshot && other ? [
    { kind: 'only_there', title: `Only in ${label(other)}: missing in ${label(snapshot)}`, tone: 'text-rose-600' },
    { kind: 'only_here', title: `Only in ${label(snapshot)}: missing in ${label(other)}`, tone: 'text-amber-700' },
    { kind: 'changed', title: 'Different on each side', tone: 'text-slate-700' },
  ] : [];

  return (
    <>
      <AdminHeader title="Schema" />
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">

        {/* ── Esta base ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="flex-1 text-sm font-black text-slate-700">
              This database {snapshot && <span className="ml-1 font-mono text-xs text-slate-500">{label(snapshot)}</span>}
            </p>
            <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh schema">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={download} disabled={!snapshot}
              className="flex items-center gap-1.5 text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <Download size={13} /> Download snapshot
            </button>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {snapshot && (
            <>
              <p className="text-xs text-slate-500" data-testid="counts">
                {Object.keys(snapshot.tables).length} tables · {snapshot.functions.length} functions
                {snapshot.source === 'catalog' && <> · {snapshot.triggers.length} triggers · {snapshot.policies.length} policies · {snapshot.indexes.length} indexes</>}
                {' '}· read {formatDate(snapshot.generated_at)}
              </p>
              {snapshot.source === 'api' && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                  admin_schema_snapshot() is not installed here, so only table, column and function names are known (no types, triggers, policies or indexes).
                  Run <span className="font-mono">supabase/migrations/20261125_admin_schema_snapshot.sql</span> in this database&apos;s SQL editor.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Lo que necesita el portal ── */}
        {snapshot && (
          <div className="bg-white rounded-2xl border border-slate-200">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
              <p className="flex-1 text-[11px] font-black text-slate-400 uppercase tracking-wider">Portal readiness</p>
              <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${missing.length ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {missing.length ? `${missing.length} missing` : 'Ready'}
              </span>
            </div>
            <ul className="divide-y divide-slate-50">
              {[...missing, ...readiness.filter(r => r.ok)].map(r => (
                <li key={r.name} className="px-5 py-2.5 flex items-start gap-2.5" data-requirement={r.name}>
                  {r.ok ? <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" /> : <XCircle size={16} className="text-rose-500 mt-0.5 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800"><span className="font-mono text-xs">{r.name}</span> <span className="text-[10px] text-slate-400">{r.kind}</span></p>
                    {!r.ok && <p className="text-xs text-slate-500">{r.breaks}. SQL: <span className="font-mono">{r.source}</span></p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Comparar ── */}
        {snapshot && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div>
              <p className="text-sm font-black text-slate-700">Compare with the other environment</p>
              <p className="text-xs text-slate-500 mt-1">
                The portal only has this database&apos;s key. Open the portal on the other environment, download its snapshot, and upload it here.
                From a terminal, <span className="font-mono">node scripts/schema-diff.mjs</span> compares DEV and PROD in one step.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs rounded-full bg-indigo-600 text-white font-black px-4 py-2 cursor-pointer">
              <Upload size={13} /> Upload snapshot
              <input type="file" accept="application/json,.json" className="hidden" aria-label="Upload snapshot"
                onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {uploadError && <p className="text-sm text-rose-600">{uploadError}</p>}

            {other && (
              <div className="space-y-4">
                <p className="text-sm text-slate-700" data-testid="diff-summary">
                  {label(snapshot)} vs {label(other)}{other.generated_at && <span className="text-xs text-slate-400"> (read {formatDate(other.generated_at)})</span>}:{' '}
                  <b>{diff.length}</b> difference{diff.length === 1 ? '' : 's'}.
                </p>
                {other.project === snapshot.project && <p className="text-xs text-amber-700">That snapshot is from this same database.</p>}
                {(snapshot.source === 'api' || other.source === 'api') && (
                  <p className="text-xs text-amber-700">One side has no admin_schema_snapshot(): only table, column and function names are compared.</p>
                )}

                {diff.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', ...Object.keys(CATEGORY_LABEL)] as (DiffCategory | 'all')[])
                      .filter(c => c === 'all' || counts[c as DiffCategory])
                      .map(c => (
                        <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                          className={`text-xs rounded-full px-3 py-1 border ${category === c ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                          {c === 'all' ? `All ${diff.length}` : `${CATEGORY_LABEL[c as DiffCategory]} ${counts[c as DiffCategory]}`}
                        </button>
                      ))}
                  </div>
                )}

                {groups.map(g => {
                  const list = shown.filter(i => i.kind === g.kind);
                  if (!list.length) return null;
                  return (
                    <section key={g.kind} className="space-y-1" data-group={g.kind}>
                      <p className={`text-xs font-bold ${g.tone}`}>{g.title} · {list.length}</p>
                      <ul className="rounded-xl border border-slate-100 divide-y divide-slate-50">
                        {list.map((i: DiffItem) => (
                          <li key={`${i.category}:${i.name}`} className="px-3 py-1.5 flex items-baseline gap-2">
                            <span className="text-[10px] font-bold text-slate-400 w-16 flex-shrink-0">{CATEGORY_LABEL[i.category]}</span>
                            <span className="font-mono text-xs text-slate-800 break-all">{i.name}</span>
                            {i.detail && <span className="text-xs text-slate-500">{i.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
