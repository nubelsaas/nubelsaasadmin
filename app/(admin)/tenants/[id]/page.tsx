'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Users, GitBranch, ShoppingBag, ExternalLink, CreditCard, ImagePlus, X, UserRound } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import AdminHeader from '@/components/layout/AdminHeader';

type Tenant = {
  id: string; name: string; admin_email: string | null;
  phone: string | null; city: string | null; country_iso: string | null;
  currency_code: string | null; timezone: string | null;
  plan_id: string | null; logo_url: string | null;
  feature_overrides: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  created_at: string;
};
type TenantStats = { activeUsers: number; branches: number; lastSale: string | null; customers: number };
type Plan = { id: string; name: string; monthly_price: number };

const inputCls = 'w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tenant,        setTenant]        = useState<Tenant | null>(null);
  const [stats,         setStats]         = useState<TenantStats | null>(null);
  const [plans,         setPlans]         = useState<Plan[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [logoUrl,       setLogoUrl]       = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError,     setLogoError]     = useState<string | null>(null);

  // Editable fields
  const [email,    setEmail]    = useState('');
  const [planId,   setPlanId]   = useState('');
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    async function load() {
      const [detailRes, plansRes] = await Promise.all([
        fetch(`/api/tenants/${id}`),
        fetch('/api/plans'),
      ]);
      const detail = detailRes.ok ? await detailRes.json() : null;
      const plans  = plansRes.ok  ? await plansRes.json()  : [];
      if (detail?.tenant) {
        const t = detail.tenant;
        setTenant(t);
        setEmail(t.admin_email ?? '');
        setPlanId(t.plan_id ?? '');
        setCurrency(t.currency_code ?? '');
        setTimezone(t.timezone ?? '');
        setLogoUrl(t.logo_url ?? null);
        setStats(detail.stats);
      }
      setPlans(plans as Plan[]);
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_email:   email    || null,
        plan_id:       planId   || null,
        currency_code: currency || null,
        timezone:      timezone || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'Failed to save');
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setSaving(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const uploadRes = await fetch('/api/upload/logo', { method: 'POST', body: form });
      if (!uploadRes.ok) throw new Error((await uploadRes.json()).error ?? 'Upload failed');
      const { url } = await uploadRes.json();

      const patchRes = await fetch(`/api/tenants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: url }),
      });
      if (!patchRes.ok) throw new Error((await patchRes.json()).error ?? 'Failed to save logo');
      setLogoUrl(url);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Error uploading logo');
    } finally {
      setUploadingLogo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleLogoRemove() {
    setLogoError(null);
    const res = await fetch(`/api/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo_url: null }),
    });
    if (res.ok) setLogoUrl(null);
  }

  if (loading) return <><AdminHeader title="Tenant" /><div className="p-8 text-sm text-slate-500">Loading...</div></>;
  if (!tenant) return <><AdminHeader title="Tenant" /><div className="p-8 text-sm text-slate-500">Tenant not found</div></>;

  const currentPlan = plans.find(p => p.id === planId);

  return (
    <>
      <AdminHeader title={tenant.name} />
      <div className="p-4 md:p-8 space-y-5 max-w-2xl">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={16} /> Back
        </button>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link href={`/tenants/${id}/users`}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-center hover:border-indigo-200 transition-colors">
              <Users size={18} className="mx-auto text-slate-400 mb-1" />
              <p className="text-xl font-black text-slate-900">{stats.activeUsers}</p>
              <p className="text-[11px] text-slate-400">Users</p>
            </Link>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <UserRound size={18} className="mx-auto text-slate-400 mb-1" />
              <p className="text-xl font-black text-slate-900">{stats.customers}</p>
              <p className="text-[11px] text-slate-400">Customers</p>
            </div>
            {[
              { icon: GitBranch,   value: stats.branches, label: 'Branches' },
              { icon: ShoppingBag, value: stats.lastSale
                  ? new Date(stats.lastSale).toLocaleDateString('en', { day: 'numeric', month: 'short' })
                  : '—', label: 'Last sale' },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                <Icon size={18} className="mx-auto text-slate-400 mb-1" />
                <p className="text-xl font-black text-slate-900">{value}</p>
                <p className="text-[11px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quick links */}
        <div className="flex gap-2 flex-wrap">
          <Link href={`/flags?tenant=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Feature Flags</Link>
          <Link href={`/impersonate?tenant=${id}`} className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Impersonate</Link>
          <Link href={`/clone?source=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Clone</Link>
          <Link href={`/audit?tenant=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Audit log</Link>
          <a href={process.env.NEXT_PUBLIC_MAIN_APP_URL ?? 'https://app.nubel.tech'} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
            <ExternalLink size={12} /> Open app
          </a>
        </div>

        {/* Logo */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <p className="text-sm font-black text-slate-700">Logo</p>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <div className="relative w-20 h-20 rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 flex-shrink-0">
                <Image src={logoUrl} alt="Logo" fill className="object-contain p-2" unoptimized />
              </div>
            ) : (
              <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center flex-shrink-0">
                <ImagePlus size={22} className="text-slate-300" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingLogo}
                className="text-xs font-bold rounded-xl border border-slate-200 px-4 py-2 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={handleLogoRemove}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-500 hover:text-rose-700 transition-colors"
                >
                  <X size={12} /> Remove
                </button>
              )}
            </div>
          </div>
          {logoError && <p className="text-xs text-rose-600">{logoError}</p>}
        </div>

        {/* Info — read-only */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Info</p>
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">ID</p>
            <p className="text-xs font-mono text-slate-400 break-all">{tenant.id}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Name',    value: tenant.name },
              { label: 'City',    value: tenant.city    ?? '—' },
              { label: 'Phone',   value: tenant.phone   ?? '—' },
              { label: 'Country', value: tenant.country_iso ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-medium text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm text-slate-700">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Editable fields */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Platform settings</p>

            <div>
              <label className={labelCls}>Admin email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls}
                placeholder="admin@empresa.com" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Currency</label>
                <input type="text" value={currency} onChange={e => setCurrency(e.target.value)}
                  className={inputCls} placeholder="COP" maxLength={3} />
              </div>
              <div>
                <label className={labelCls}>Timezone</label>
                <input type="text" value={timezone} onChange={e => setTimezone(e.target.value)}
                  className={inputCls} placeholder="America/Bogota" />
              </div>
            </div>

            {/* Plan */}
            <div className="pt-2 border-t border-slate-100">
              <label className={labelCls}>
                <span className="flex items-center gap-2"><CreditCard size={14} className="text-slate-400" /> Subscription plan</span>
              </label>
              <select value={planId} onChange={e => setPlanId(e.target.value)} className={inputCls}>
                <option value="">— No plan assigned —</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.monthly_price.toLocaleString()}/mo
                  </option>
                ))}
              </select>
              {currentPlan && (
                <p className="text-xs text-slate-400 mt-1.5">
                  Current: <span className="font-medium text-slate-600">{currentPlan.name}</span>
                  {' · '}${currentPlan.monthly_price.toLocaleString()}/mo
                </p>
              )}
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-6 py-2.5 text-sm disabled:opacity-50">
              <Save size={16} />
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        </div>

        <p className="text-xs text-slate-400">
          Created: {new Date(tenant.created_at).toLocaleDateString('en', { dateStyle: 'long' })}
        </p>
      </div>
    </>
  );
}
