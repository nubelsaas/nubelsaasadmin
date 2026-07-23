'use client';
import { useState, useCallback, useEffect } from 'react';
import { Search, ExternalLink, Copy, Check, UserCog } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';


type Tenant = { id: string; name: string };
type TenantUser = { id: string; email: string | null; full_name: string | null; is_active: boolean };

export default function ImpersonatePage() {
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    const res = await fetch(`/api/tenants${tenantSearch.trim() ? `?search=${encodeURIComponent(tenantSearch.trim())}` : ''}`);
    setTenants(res.ok ? await res.json() : []);
    setLoadingTenants(false);
  }, [tenantSearch]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  async function selectTenant(t: Tenant) {
    setSelectedTenant(t);
    setLink(null);
    setUsers([]);
    setLoadingUsers(true);
    const res = await fetch(`/api/tenants/${t.id}/users`);
    setUsers(res.ok ? await res.json() : []);
    setLoadingUsers(false);
  }

  async function handleImpersonate(user: TenantUser) {
    if (!user.email) return;
    setGenerating(user.id);
    setLink(null);
    const res = await fetch('/api/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    const json = await res.json();
    setGenerating(null);
    if (json.link) setLink(json.link);
    else alert(json.error ?? 'Failed to generate link');
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <AdminHeader title="Impersonate User" />
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        <div className="w-full md:w-72 md:border-r border-slate-200 flex flex-col bg-white">
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search tenant..." value={tenantSearch} onChange={e => setTenantSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {loadingTenants ? (
              <p className="text-xs text-slate-400 text-center py-8">Loading...</p>
            ) : tenants.map(t => (
              <button key={t.id} onClick={() => selectTenant(t)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${
                  selectedTenant?.id === t.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'
                }`}>
                <p className="text-sm font-medium truncate">{t.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-5">
          {!selectedTenant ? (
            <div className="flex items-center justify-center h-48 text-sm text-slate-400">
              Select a tenant to see its users
            </div>
          ) : (
            <>
              <h2 className="text-base font-black text-slate-900">{selectedTenant.name}</h2>

              {link && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-emerald-800">Magic link generated</p>
                  <p className="text-xs font-mono text-emerald-700 break-all">{link}</p>
                  <div className="flex gap-2">
                    <button onClick={copyLink}
                      className="flex items-center gap-1.5 text-xs rounded-full border border-emerald-300 px-3 py-1.5 text-emerald-700 font-medium">
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <a href={link} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs rounded-full bg-emerald-600 text-white px-3 py-1.5 font-black">
                      <ExternalLink size={13} /> Open in app
                    </a>
                  </div>
                </div>
              )}

              {loadingUsers ? (
                <p className="text-sm text-slate-400">Loading users...</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-slate-400">No users found</p>
              ) : (
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.id} className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{u.full_name ?? '—'}</p>
                        <p className="text-xs text-slate-400 truncate">{u.email ?? 'no email'}</p>
                        {!u.is_active && <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1">inactive</span>}
                      </div>
                      <button onClick={() => handleImpersonate(u)} disabled={!u.email || generating === u.id}
                        className="flex items-center gap-1.5 text-xs rounded-full bg-indigo-600 text-white font-black px-3 py-1.5 disabled:opacity-40 flex-shrink-0">
                        <UserCog size={13} />
                        {generating === u.id ? '...' : 'Sign in as'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
