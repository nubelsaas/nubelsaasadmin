'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus, ShieldCheck, ChevronDown, ChevronUp, Mail, Link2, Copy, Check } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';

type Role = { id: string; name: string; type: string };
type TenantUser = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  permissions: Record<string, boolean> | null;
  roles: Role | null;
};

type UserAction = { userId: string; status: 'idle' | 'loading' | 'done' | 'error'; message?: string; link?: string; copied?: boolean };

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

export default function TenantUsersPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [users,            setUsers]            = useState<TenantUser[]>([]);
  const [tenantName,       setTenantName]       = useState('');
  const [tenantAdminEmail, setTenantAdminEmail] = useState<string | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [showForm,         setShowForm]         = useState(false);
  const [mode,             setMode]             = useState<'invite' | 'manual'>('invite');
  const [email,            setEmail]            = useState('');
  const [adminName,        setAdminName]        = useState('');
  const [password,         setPassword]         = useState('');
  const [passwordConfirm,  setPasswordConfirm]  = useState('');
  const [submitting,       setSubmitting]       = useState(false);
  const [quickSubmitting,  setQuickSubmitting]  = useState(false);
  const [formError,        setFormError]        = useState<string | null>(null);
  const [successMsg,       setSuccessMsg]       = useState<string | null>(null);
  // Per-user expanded state and action state
  const [expandedUser,     setExpandedUser]     = useState<string | null>(null);
  const [userActions,      setUserActions]      = useState<Record<string, UserAction>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, tenantRes] = await Promise.all([
      fetch(`/api/tenants/${id}/users`),
      fetch(`/api/tenants/${id}`),
    ]);
    const usersData  = usersRes.ok  ? await usersRes.json()  : [];
    const tenantData = tenantRes.ok ? await tenantRes.json() : null;
    setUsers(usersData);
    if (tenantData?.tenant) {
      setTenantName(tenantData.tenant.name ?? '');
      setTenantAdminEmail(tenantData.tenant.admin_email ?? null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const hasAdmin = users.some(u => {
    const perms = u.permissions ?? {};
    return perms.can_do_everything === true;
  });

  // ── Admin creation ──────────────────────────────────────────────

  async function callCreateAdmin(targetEmail: string, targetName: string, targetPassword?: string) {
    const res = await fetch(`/api/tenants/${id}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail, admin_name: targetName, password: targetPassword ?? null }),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? 'Failed to create admin';
    return null;
  }

  async function handleQuickCreate() {
    if (!tenantAdminEmail) return;
    setFormError(null);
    setQuickSubmitting(true);
    const err = await callCreateAdmin(tenantAdminEmail, '');
    if (err) setFormError(err);
    else setSuccessMsg(`Invite sent to ${tenantAdminEmail}`);
    setQuickSubmitting(false);
    load();
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (mode === 'manual') {
      if (password.length < 8) { setFormError('Password must be at least 8 characters'); return; }
      if (password !== passwordConfirm) { setFormError('Passwords do not match'); return; }
    }
    setSubmitting(true);
    const err = await callCreateAdmin(email, adminName, mode === 'manual' ? password : undefined);
    if (err) { setFormError(err); setSubmitting(false); return; }
    setSuccessMsg(mode === 'invite' ? `Invite sent to ${email}` : `Admin created for ${email}`);
    setEmail(''); setAdminName(''); setPassword(''); setPasswordConfirm('');
    setShowForm(false);
    setSubmitting(false);
    load();
  }

  function openFormWithEmail(prefill: string) {
    setEmail(prefill); setAdminName(''); setPassword(''); setPasswordConfirm('');
    setMode('invite'); setFormError(null); setShowForm(true);
  }

  // ── Per-user actions ─────────────────────────────────────────────

  function setAction(userId: string, patch: Partial<UserAction>) {
    setUserActions(prev => {
      const base: UserAction = prev[userId] ?? { userId, status: 'idle' };
      return { ...prev, [userId]: { ...base, ...patch } };
    });
  }

  async function handleResendInvite(userId: string) {
    setAction(userId, { status: 'loading' });
    const res = await fetch(`/api/tenants/${id}/users/${userId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invite' }),
    });
    const json = await res.json();
    if (!res.ok) setAction(userId, { status: 'error', message: json.error ?? 'Failed' });
    else setAction(userId, { status: 'done', message: 'Invite sent!' });
  }

  async function handleMagicLink(userId: string) {
    setAction(userId, { status: 'loading' });
    const res = await fetch(`/api/tenants/${id}/users/${userId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'magic_link' }),
    });
    const json = await res.json();
    if (!res.ok) setAction(userId, { status: 'error', message: json.error ?? 'Failed' });
    else setAction(userId, { status: 'done', link: json.link, copied: false });
  }

  async function handleCopyLink(userId: string, link: string) {
    await navigator.clipboard.writeText(link);
    setAction(userId, { copied: true });
    setTimeout(() => setAction(userId, { copied: false }), 2000);
  }

  function initials(u: TenantUser) {
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  }

  const noAdminBanner = !loading && !hasAdmin && !showForm;

  return (
    <>
      <AdminHeader title={tenantName ? `${tenantName} — Users` : 'Users'} />
      <div className="p-4 md:p-8 space-y-5 max-w-2xl">

        <button onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={16} /> Back
        </button>

        {/* No-admin banner — with known email */}
        {noAdminBanner && tenantAdminEmail && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 space-y-3">
            <p className="text-sm text-amber-800 font-medium">
              This tenant has no admin user. We found a registered email:
            </p>
            <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl px-3 py-2">
              <span className="text-sm font-mono text-slate-700 flex-1 truncate">{tenantAdminEmail}</span>
            </div>
            {formError && <p className="text-xs text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{formError}</p>}
            <div className="flex gap-2">
              <button onClick={handleQuickCreate} disabled={quickSubmitting}
                className="flex-1 rounded-full bg-amber-600 text-white font-black py-2 text-sm disabled:opacity-50">
                {quickSubmitting ? 'Sending…' : 'Yes, create admin'}
              </button>
              <button onClick={() => openFormWithEmail(tenantAdminEmail)}
                className="flex-1 rounded-full border border-amber-300 text-amber-800 font-medium py-2 text-sm hover:bg-amber-100 transition-colors">
                Use different email
              </button>
            </div>
          </div>
        )}

        {/* No-admin banner — no known email */}
        {noAdminBanner && !tenantAdminEmail && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <p className="text-sm text-amber-800 font-medium">This tenant has no admin user yet.</p>
            <button onClick={() => setShowForm(true)}
              className="text-xs font-black text-amber-700 hover:text-amber-900 underline underline-offset-2">
              Create admin →
            </button>
          </div>
        )}

        {/* Global success */}
        {successMsg && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-sm text-emerald-800">
            {successMsg}
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-slate-700">
            {loading ? '…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
          </p>
          {!showForm && (
            <button onClick={() => {
              setShowForm(true); setSuccessMsg(null); setFormError(null);
              setEmail(''); setAdminName(''); setPassword(''); setPasswordConfirm(''); setMode('invite');
            }} className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-4 py-2 text-sm">
              <UserPlus size={15} /> Create admin
            </button>
          )}
        </div>

        {/* Create admin form */}
        {showForm && (
          <form onSubmit={handleCreateAdmin}
            className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <p className="text-sm font-black text-slate-700 flex items-center gap-2">
              <ShieldCheck size={16} className="text-indigo-500" /> New admin user
            </p>
            <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
              {(['invite', 'manual'] as const).map(m => (
                <button key={m} type="button" onClick={() => { setMode(m); setFormError(null); }}
                  className={`flex-1 py-2 font-medium transition-colors ${mode === m ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {m === 'invite' ? 'Send invite' : 'Create manually'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {mode === 'invite' ? 'The admin will receive an email to set their own password.' : 'Set a password directly. No email will be sent.'}
            </p>
            <div>
              <label className={labelCls}>Email <span className="text-rose-500">*</span></label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                autoFocus className={inputCls} placeholder="admin@empresa.com" />
            </div>
            <div>
              <label className={labelCls}>Name</label>
              <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
                className={inputCls} placeholder="Juan Pérez" />
            </div>
            {mode === 'manual' && (
              <>
                <div>
                  <label className={labelCls}>Password <span className="text-rose-500">*</span></label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    className={inputCls} placeholder="Min. 8 characters" minLength={8} />
                </div>
                <div>
                  <label className={labelCls}>Confirm password <span className="text-rose-500">*</span></label>
                  <input type="password" required value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                    className={inputCls} placeholder="Repeat password" />
                </div>
              </>
            )}
            {formError && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-4 py-2">{formError}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setShowForm(false); setFormError(null); }}
                className="flex-1 rounded-full border border-slate-200 py-2 text-sm font-medium text-slate-600">
                Cancel
              </button>
              <button type="submit" disabled={submitting || !email}
                className="flex-1 rounded-full bg-indigo-600 text-white font-black py-2 text-sm disabled:opacity-50">
                {submitting ? 'Creating…' : mode === 'invite' ? 'Send invite' : 'Create admin'}
              </button>
            </div>
          </form>
        )}

        {/* Users list */}
        {loading ? (
          <div className="text-sm text-slate-500 text-center py-12">Loading…</div>
        ) : users.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-12">No users yet</div>
        ) : (
          <div className="space-y-2">
            {users.map(u => {
              const perms   = u.permissions ?? {};
              const isAdmin = perms.can_do_everything === true;
              const ua      = userActions[u.id];
              const expanded = expandedUser === u.id;

              return (
                <div key={u.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  {/* Main row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-black flex-shrink-0">
                      {initials(u)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {u.roles && (
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                          {u.roles.name}
                        </span>
                      )}
                      {isAdmin && (
                        <span className="text-[11px] font-black bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
                          Admin
                        </span>
                      )}
                      {!u.is_active && (
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-400 rounded-full px-2 py-0.5">
                          Inactive
                        </span>
                      )}
                      {/* Expand toggle */}
                      <button
                        onClick={() => setExpandedUser(expanded ? null : u.id)}
                        className="ml-1 text-slate-400 hover:text-slate-600 transition-colors">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable actions */}
                  {expanded && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-3">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                        Registration actions
                      </p>

                      {/* Action buttons */}
                      {(!ua || ua.status === 'idle' || ua.status === 'error') && (
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => handleResendInvite(u.id)}
                            className="flex items-center gap-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                            <Mail size={13} /> Resend invite
                          </button>
                          <button
                            onClick={() => handleMagicLink(u.id)}
                            className="flex items-center gap-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                            <Link2 size={13} /> Generate magic link
                          </button>
                        </div>
                      )}

                      {ua?.status === 'loading' && (
                        <p className="text-xs text-slate-500">Processing…</p>
                      )}

                      {ua?.status === 'done' && !ua.link && (
                        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
                          ✓ {ua.message}
                        </p>
                      )}

                      {/* Magic link result */}
                      {ua?.status === 'done' && ua.link && (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500">
                            Share this link — it grants immediate access (one-time use):
                          </p>
                          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                            <span className="text-[11px] font-mono text-slate-600 flex-1 truncate">{ua.link}</span>
                            <button
                              onClick={() => handleCopyLink(u.id, ua.link!)}
                              className="text-slate-400 hover:text-indigo-600 transition-colors flex-shrink-0">
                              {ua.copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                          <button onClick={() => handleMagicLink(u.id)}
                            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2">
                            Generate new link
                          </button>
                        </div>
                      )}

                      {ua?.status === 'error' && (
                        <p className="text-xs text-rose-600 bg-rose-50 rounded-xl px-3 py-2">
                          {ua.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
