'use client';
import { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, ChevronDown, ChevronUp, Search, Plus, CheckCircle, XCircle, Loader, ShieldCheck } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';

// ── Table definitions ──────────────────────────────────────────────────────────

// expense_categories is global (tenant_id IS NULL) — inherited by all tenants via RLS, never cloned.
const ONBOARDING_TABLES = [
  'branches', 'roles', 'product_categories', 'distributors',
  'commission_rules', 'products_services', 'service_recipes',
  'branch_stock',
] as const;

const DEMO_EXTRA_TABLES = ['users'] as const;
const TABLE_META: Record<string, { label: string; requires?: string }> = {
  branches:           { label: 'Branches' },
  roles:              { label: 'Roles' },
  product_categories: { label: 'Product categories' },
  distributors:       { label: 'Distributors' },
  commission_rules:   { label: 'Commission rules',   requires: 'roles' },
  products_services:  { label: 'Products & services', requires: 'product categories' },
  service_recipes:    { label: 'Service recipes',    requires: 'products & services' },
  branch_stock:       { label: 'Branch stock',       requires: 'branches + products' },
  users:              { label: 'Users (staff)',       requires: 'branches + roles' },
};

// Cascades: excluding a key forces all values to be excluded too
const DEPENDENTS: Record<string, string[]> = {
  branches:           ['branch_stock', 'users'],
  roles:              ['commission_rules', 'users'],
  product_categories: ['products_services'],
  distributors:       ['products_services'],   // product_distributors links both
  products_services:  ['service_recipes', 'branch_stock'],
};
function computeExcluded(userExcluded: Set<string>): Set<string> {
  const result = new Set(userExcluded);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [table, deps] of Object.entries(DEPENDENTS)) {
      if (result.has(table)) {
        for (const dep of deps) {
          if (!result.has(dep)) { result.add(dep); changed = true; }
        }
      }
    }
  }
  return result;
}

const DEMO_GENERATED_ITEMS = [
  'customers (50 mock)', 'cash register shifts', 'sales',
  'transaction payments', 'account movements', 'expenses',
  'attendance records', 'payrolls',
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Tenant = { id: string; name: string };
type TargetState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'empty';    tenant: Tenant }
  | { status: 'has_data'; tenant: Tenant; offendingTables: string[] };

// ── Sub-components ─────────────────────────────────────────────────────────────

function TenantSearchInput({
  placeholder, value, onChange, onSelect, results, loading,
}: {
  placeholder: string; value: string; onChange: (v: string) => void;
  onSelect: (t: Tenant) => void; results: Tenant[]; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" placeholder={placeholder} value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      {open && value.trim().length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-3">Searching...</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-3">No tenants found</p>
          ) : results.map(t => (
            <button key={t.id} onMouseDown={() => { onSelect(t); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm text-slate-700 border-b border-slate-50 last:border-0">
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-slate-400 ml-2 font-mono">{t.id.slice(0, 8)}…</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ClonePage() {
  const [mode, setMode] = useState<'onboarding' | 'demo'>('onboarding');
  const [copyStock, setCopyStock] = useState(false);
  const [showTables, setShowTables] = useState(false);

  // Table selection: userExcluded = tables the user explicitly unchecked
  const [userExcluded, setUserExcluded] = useState<Set<string>>(new Set());
  const fullyExcluded = computeExcluded(userExcluded);

  const activeTables: string[] = mode === 'demo'
    ? [...ONBOARDING_TABLES, ...DEMO_EXTRA_TABLES]
    : [...ONBOARDING_TABLES];

  function toggleTable(table: string) {
    setUserExcluded(prev => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }

  // Excluded tables to pass to the API (only those in activeTables)
  const excludedParam = activeTables.filter(t => fullyExcluded.has(t)).join(',');

  // Source
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceResults, setSourceResults] = useState<Tenant[]>([]);
  const [sourceTenant, setSourceTenant] = useState<Tenant | null>(null);
  const [searchingSource, setSearchingSource] = useState(false);

  // Target
  const [targetSearch, setTargetSearch] = useState('');
  const [targetResults, setTargetResults] = useState<Tenant[]>([]);
  const [targetState, setTargetState] = useState<TargetState>({ status: 'idle' });
  const [searchingTarget, setSearchingTarget] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);

  // New superadmin for the clone (required for both modes). The target tenant has
  // no loginable user after a clone, so we force creating one fresh identity.
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminMode, setAdminMode] = useState<'invite' | 'manual'>('invite');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  type EmailCheck = { status: 'idle' | 'checking' | 'available' | 'taken' | 'error'; reason?: string };
  const [emailCheck, setEmailCheck] = useState<EmailCheck>({ status: 'idle' });

  // Log
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const [clonedTarget, setClonedTarget] = useState<Tenant | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [activeOp, setActiveOp] = useState<'onboarding' | 'demo' | 'rollback' | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!sourceSearch.trim()) { setSourceResults([]); return; }
    const t = setTimeout(async () => {
      setSearchingSource(true);
      const res = await fetch(`/api/tenants?search=${encodeURIComponent(sourceSearch.trim())}`);
      setSourceResults(res.ok ? (await res.json()).slice(0, 8) : []);
      setSearchingSource(false);
    }, 300);
    return () => clearTimeout(t);
  }, [sourceSearch]);

  useEffect(() => {
    if (!targetSearch.trim()) { setTargetResults([]); return; }
    const t = setTimeout(async () => {
      setSearchingTarget(true);
      const res = await fetch(`/api/tenants?search=${encodeURIComponent(targetSearch.trim())}`);
      setTargetResults(res.ok ? (await res.json()).slice(0, 8) : []);
      setSearchingTarget(false);
    }, 300);
    return () => clearTimeout(t);
  }, [targetSearch]);

  // Live availability check for the new superadmin email (debounced).
  const emailFormatValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim());
  useEffect(() => {
    const email = adminEmail.trim();
    if (!email || !emailFormatValid) { setEmailCheck({ status: 'idle' }); return; }
    setEmailCheck({ status: 'checking' });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clone/check-admin-email?email=${encodeURIComponent(email)}`);
        const json = await res.json();
        if (!res.ok) { setEmailCheck({ status: 'error', reason: json.error ?? 'Check failed' }); return; }
        setEmailCheck(json.available ? { status: 'available' } : { status: 'taken', reason: json.reason });
      } catch {
        setEmailCheck({ status: 'error', reason: 'Network error' });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [adminEmail, emailFormatValid]);

  const adminValid =
    emailFormatValid &&
    emailCheck.status === 'available' &&
    (adminMode === 'invite' || (adminPassword.length >= 8 && adminPassword === adminPasswordConfirm));

  function selectSource(t: Tenant) {
    setSourceTenant(t); setSourceSearch(t.name); setSourceResults([]);
  }

  async function selectTarget(t: Tenant) {
    setTargetSearch(t.name); setTargetResults([]);
    setTargetState({ status: 'checking' });
    const res = await fetch(`/api/clone/check-target?tenant_id=${t.id}`);
    const { empty, offendingTables } = res.ok ? await res.json() : { empty: false, offendingTables: [] };
    setTargetState(empty
      ? { status: 'empty', tenant: t }
      : { status: 'has_data', tenant: t, offendingTables });
  }

  async function handleCreateTarget() {
    if (!targetSearch.trim()) return;
    setCreatingTenant(true);
    const res  = await fetch('/api/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: targetSearch.trim() }) });
    const json = await res.json();
    setCreatingTenant(false);
    if (!res.ok) { alert(json.error ?? 'Failed to create tenant'); return; }
    setTargetState({ status: 'empty', tenant: { id: json.id, name: targetSearch.trim() } });
  }

  async function readStream(url: string, onLine: (line: string) => void) {
    const res = await fetch(url);
    if (!res.body) throw new Error('No stream');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const raw of dec.decode(value).split('\n')) {
        const line = raw.replace(/^data: /, '').trim();
        if (line) onLine(line);
      }
    }
  }

  async function handleRun() {
    if (!sourceTenant || targetState.status !== 'empty' || running) return;
    const targetTenant = targetState.tenant;

    setRunning(true);
    setActiveOp(mode);
    setClonedTarget(null);
    setLog(['Starting…']);

    const params = new URLSearchParams({ source: sourceTenant.id, target: targetTenant.id, mode });
    if (mode === 'onboarding' && copyStock) params.set('copyStock', '1');
    if (excludedParam) params.set('exclude', excludedParam);

    let succeeded = false;
    try {
      await readStream(`/api/clone/stream?${params}`, line => {
        if (line.startsWith('✅')) succeeded = true;
        setLog(prev => [...prev, line]);
      });

      // After the clone completes, create the required superadmin for the new tenant.
      // The target has no loginable user otherwise (cloned staff are obfuscated /
      // have no auth identity). require_new rejects emails already in auth.users.
      if (succeeded) {
        setLog(prev => [...prev, '──', '👤 Creating tenant superadmin…']);
        const res = await fetch(`/api/tenants/${targetTenant.id}/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: adminEmail.trim(),
            admin_name: adminName.trim(),
            password: adminMode === 'manual' ? adminPassword : null,
            require_new: true,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          succeeded = false;
          setLog(prev => [...prev, `❌ Superadmin creation failed: ${json.error ?? 'unknown error'}`]);
          setLog(prev => [...prev, '⚠️  Tenant data was seeded but has no admin. Use "Undo clone" or retry from Tenants → Users.']);
        } else {
          setLog(prev => [...prev, adminMode === 'invite'
            ? `✅ Superadmin invited — ${adminEmail.trim()} will receive an email to set a password.`
            : `✅ Superadmin created — log in with ${adminEmail.trim()} and the chosen password.`]);
        }
      }
    } catch (e: unknown) {
      succeeded = false;
      setLog(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setRunning(false);
      if (succeeded) setClonedTarget(targetTenant);
    }
  }

  async function handleUndo() {
    if (!clonedTarget || running) return;
    const target = clonedTarget;

    setRunning(true);
    setActiveOp('rollback');
    setLog([`Undoing clone on "${target.name}"…`]);

    const params = new URLSearchParams({ target: target.id, mode: 'rollback' });
    let succeeded = false;
    try {
      await readStream(`/api/clone/stream?${params}`, line => {
        if (line.startsWith('↩️')) succeeded = true;
        setLog(prev => [...prev, line]);
      });
    } catch (e: unknown) {
      setLog(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setRunning(false);
      if (succeeded) setClonedTarget(null);
    }
  }

  const includedCount = activeTables.filter(t => !fullyExcluded.has(t)).length;
  const canRun = !!sourceTenant && targetState.status === 'empty' && adminValid && !running;

  const TOTAL_STEPS: Record<string, number> = { onboarding: 11, demo: 24, rollback: 20 };
  const completions = log.filter(l =>
    l.startsWith('✓') || l.startsWith('✅') || l.startsWith('⏭') || l.startsWith('↩️')
  ).length;
  const isDone = log.some(l => l.startsWith('✅') || l.startsWith('↩️'));
  const progressPct = isDone
    ? 100
    : running
      ? Math.min(92, Math.round(completions / (TOTAL_STEPS[activeOp ?? 'onboarding'] ?? 15) * 100))
      : 0;

  const MODES = [
    {
      value: 'onboarding' as const,
      label: 'Onboarding',
      badge: `${ONBOARDING_TABLES.length} tables`,
      desc:  'Copies branches, roles, products, categories and commission rules. Tenant ready to operate from day 1.',
    },
    {
      value: 'demo' as const,
      label: 'Demo Seed',
      badge: '3 months of data',
      desc:  'Onboarding + 3 months of synthetic transactions: 50 sales/month, staff, payroll, expenses and account movements.',
    },
  ] as const;

  return (
    <>
      <AdminHeader title="Clone Tenant" />
      <div className="p-4 md:p-8 max-w-2xl space-y-6">

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-3">
          {MODES.map(({ value, label, badge, desc }) => (
            <button key={value} onClick={() => setMode(value)}
              className={`text-left rounded-2xl border p-4 transition-colors ${
                mode === value ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-black ${mode === value ? 'text-indigo-700' : 'text-slate-700'}`}>{label}</span>
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded-md ${mode === value ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                  {badge}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-snug">{desc}</p>
            </button>
          ))}
        </div>

        {/* Tables to clone */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <button onClick={() => setShowTables(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <span>
              Tables to clone
              <span className="ml-2 text-xs font-mono text-slate-400">
                {includedCount}/{activeTables.length} selected
              </span>
            </span>
            {showTables ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showTables && (
            <div className="border-t border-slate-100 px-5 py-4 space-y-1">
              {activeTables.map(table => {
                const meta        = TABLE_META[table];
                const isUserOff   = userExcluded.has(table);
                const isForced    = fullyExcluded.has(table) && !isUserOff;
                const isExcluded  = fullyExcluded.has(table);
                const isDisabled  = isForced; // user can't re-enable if parent is excluded

                return (
                  <label
                    key={table}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors cursor-pointer
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'}
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      disabled={isDisabled}
                      onChange={() => !isDisabled && toggleTable(table)}
                      className="rounded accent-indigo-600 w-4 h-4 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <span className={`text-sm font-medium ${isExcluded ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                        {meta.label}
                      </span>
                      {isForced && (
                        <span className="ml-2 text-xs text-amber-600">requires {meta.requires}</span>
                      )}
                      {!isForced && meta.requires && !isExcluded && (
                        <span className="ml-2 text-[11px] text-slate-400">· requires {meta.requires}</span>
                      )}
                    </div>
                    <span className="ml-auto font-mono text-[10px] text-slate-300">{table}</span>
                  </label>
                );
              })}

              {mode === 'demo' && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-400 mb-2">Always generated synthetically</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DEMO_GENERATED_ITEMS.map(t => (
                      <span key={t} className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-400">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Source + Target */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Source tenant</label>
            <TenantSearchInput placeholder="Search by name…" value={sourceSearch}
              onChange={v => { setSourceSearch(v); setSourceTenant(null); }}
              onSelect={selectSource} results={sourceResults} loading={searchingSource} />
            {sourceTenant && <p className="text-xs font-mono text-slate-400 mt-1.5">{sourceTenant.id}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target tenant</label>
            <TenantSearchInput placeholder="Search existing or type a new name…" value={targetSearch}
              onChange={v => { setTargetSearch(v); setTargetState({ status: 'idle' }); }}
              onSelect={selectTarget} results={targetResults} loading={searchingTarget} />

            {targetState.status === 'checking' && (
              <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                <Loader size={13} className="animate-spin" /> Checking if tenant is empty…
              </div>
            )}
            {targetState.status === 'empty' && (
              <div className="flex items-center gap-2 mt-2 text-xs text-emerald-600">
                <CheckCircle size={14} /> Empty tenant — safe to proceed
                <span className="font-mono text-slate-400 ml-1">{targetState.tenant.id.slice(0, 8)}…</span>
              </div>
            )}
            {targetState.status === 'has_data' && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-xs text-rose-600">
                  <XCircle size={14} /> Tenant already has data
                </div>
                <p className="text-xs text-slate-400">
                  Non-empty: <span className="font-mono">{targetState.offendingTables.join(', ')}</span>
                </p>
              </div>
            )}
            {targetSearch.trim().length > 1 && targetState.status === 'idle' && targetResults.length === 0 && !searchingTarget && (
              <button onClick={handleCreateTarget} disabled={creatingTenant}
                className="flex items-center gap-2 mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50">
                <Plus size={13} />
                {creatingTenant ? 'Creating…' : `Create new tenant "${targetSearch.trim()}"`}
              </button>
            )}
          </div>

          {mode === 'onboarding' && (
            <label className="flex items-center gap-3 cursor-pointer pt-1">
              <input type="checkbox" checked={copyStock} onChange={e => setCopyStock(e.target.checked)} className="rounded" />
              <span className="text-sm text-slate-700">Copy real stock values <span className="text-slate-400">(default: reset to 0)</span></span>
            </label>
          )}

          {/* New superadmin — required for both modes */}
          {targetState.status === 'empty' && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-sm font-black text-slate-700 flex items-center gap-2">
                <ShieldCheck size={16} className="text-indigo-500" /> New tenant superadmin
                <span className="text-rose-500">*</span>
              </p>
              <p className="text-xs text-slate-400 leading-snug">
                The clone has no loginable user. Create a fresh admin (must be a brand-new
                email, not already registered) — it will be the tenant&apos;s superadmin.
              </p>

              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
                {(['invite', 'manual'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setAdminMode(m)}
                    className={`flex-1 py-2 font-medium transition-colors ${adminMode === m ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                    {m === 'invite' ? 'Send invite' : 'Create manually'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                {adminMode === 'invite' ? 'The admin receives an email to set their own password.' : 'Set a password directly. No email is sent.'}
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Admin email <span className="text-rose-500">*</span></label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  placeholder="admin@empresa.com" />
                {emailCheck.status === 'checking' && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-1.5"><Loader size={12} className="animate-spin" /> Checking availability…</p>
                )}
                {emailCheck.status === 'available' && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 mt-1.5"><CheckCircle size={13} /> Email available</p>
                )}
                {emailCheck.status === 'taken' && (
                  <p className="flex items-center gap-1.5 text-xs text-rose-600 mt-1.5"><XCircle size={13} /> {emailCheck.reason}</p>
                )}
                {emailCheck.status === 'error' && (
                  <p className="text-xs text-amber-600 mt-1.5">{emailCheck.reason}</p>
                )}
                {adminEmail.trim() && !emailFormatValid && emailCheck.status === 'idle' && (
                  <p className="text-xs text-slate-400 mt-1.5">Enter a valid email.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Admin name</label>
                <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  placeholder="Juan Pérez" />
              </div>

              {adminMode === 'manual' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Password <span className="text-rose-500">*</span></label>
                    <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      placeholder="Min. 8 chars" minLength={8} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Confirm <span className="text-rose-500">*</span></label>
                    <input type="password" value={adminPasswordConfirm} onChange={e => setAdminPasswordConfirm(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      placeholder="Repeat" />
                  </div>
                  {adminPassword.length > 0 && adminPassword.length < 8 && (
                    <p className="col-span-2 text-xs text-rose-600">Password must be at least 8 characters.</p>
                  )}
                  {adminPasswordConfirm.length > 0 && adminPassword !== adminPasswordConfirm && (
                    <p className="col-span-2 text-xs text-rose-600">Passwords do not match.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <button onClick={() => setShowConfirm(true)} disabled={!canRun}
            className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-6 py-2.5 text-sm disabled:opacity-40">
            <Play size={16} />
            {running ? (mode === 'demo' ? 'Seeding…' : 'Setting up…') : (mode === 'demo' ? 'Start Demo Seed' : 'Start Onboarding')}
          </button>
        </div>

        {/* Progress bar + Log */}
        {log.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progressPct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                  } ${running && progressPct === 0 ? 'animate-pulse w-full opacity-30' : ''}`}
                  style={{ width: progressPct > 0 ? `${progressPct}%` : undefined }}
                />
              </div>
              <span className="text-xs font-mono text-slate-400 w-8 text-right">{progressPct}%</span>
            </div>
            <div ref={logRef} className="bg-slate-900 rounded-2xl p-4 font-mono text-xs text-slate-300 space-y-1 max-h-72 overflow-y-auto no-scrollbar">
              {log.map((line, i) => (
                <p key={i} className={
                  line.startsWith('✅') ? 'text-emerald-400' :
                  line.startsWith('❌') ? 'text-rose-400' :
                  line.startsWith('↩️') ? 'text-sky-400' :
                  line.startsWith('⚠️') ? 'text-amber-400' :
                  line.startsWith('──') || line.startsWith('📅') || line.startsWith('📋') ? 'text-slate-400' :
                  ''
                }>{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Undo banner */}
        {clonedTarget && !running && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Clone completed</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Target: <span className="font-mono">{clonedTarget.name}</span> — all data can be removed
              </p>
            </div>
            <button onClick={handleUndo}
              className="flex items-center gap-2 rounded-full border border-amber-300 bg-white text-amber-700 font-black px-4 py-2 text-xs hover:bg-amber-50 transition-colors flex-shrink-0 ml-4">
              <RotateCcw size={13} />
              Undo clone
            </button>
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      {showConfirm && sourceTenant && targetState.status === 'empty' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            <h2 className="text-base font-black text-slate-900">
              Confirm {mode === 'demo' ? 'Demo Seed' : 'Onboarding'}
            </h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex gap-2">
                <span className="text-slate-400 w-14 flex-shrink-0">Source</span>
                <span className="font-medium text-slate-800">{sourceTenant.name}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-14 flex-shrink-0">Target</span>
                <span className="font-medium text-slate-800">{targetState.tenant.name}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-slate-400 w-14 flex-shrink-0">Tables</span>
                <span className="font-medium text-slate-800">{includedCount} of {activeTables.length}</span>
              </div>
              {excludedParam && (
                <div className="flex gap-2 text-xs">
                  <span className="text-slate-400 w-14 flex-shrink-0">Skipped</span>
                  <span className="font-mono text-amber-700">{excludedParam.split(',').join(', ')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-slate-400 w-14 flex-shrink-0">Admin</span>
                <span className="font-medium text-slate-800 truncate">
                  {adminEmail.trim()}
                  <span className="text-slate-400 ml-1">({adminMode === 'invite' ? 'invite' : 'password'})</span>
                </span>
              </div>
            </div>
            {mode === 'demo' && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 leading-relaxed">
                Staff will be obfuscated, real customers replaced with 50 mocks, prices +2. Use &quot;Undo clone&quot; to reverse.
              </p>
            )}
            {mode === 'onboarding' && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
                Copies catalog structure. Target tenant must remain empty. Use &quot;Undo clone&quot; to reverse.
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
                Cancel
              </button>
              <button onClick={() => { setShowConfirm(false); handleRun(); }}
                className="flex-1 rounded-full bg-indigo-600 text-white font-black py-2.5 text-sm">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
