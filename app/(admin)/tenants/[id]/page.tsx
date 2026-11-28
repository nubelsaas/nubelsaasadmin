'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Copy as CopyIcon, Download, Save, Users, GitBranch, ShoppingBag, ExternalLink, CreditCard, ImagePlus, X, UserRound, CalendarCheck, Copy, Check, Trash2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import AdminHeader from '@/components/layout/AdminHeader';
import { useAskDialog } from '@/components/shared/AskDialog';
import IntegrationsCard from '@/components/tenants/IntegrationsCard';
import OnboardingCard from '@/components/tenants/OnboardingCard';
import NotesCard from '@/components/tenants/NotesCard';
import TimelineCard from '@/components/tenants/TimelineCard';
import Hint, { HintIcon } from '@/components/ui/Hint';
import type { HelpKey } from '@/lib/fieldHelp';

type Tenant = {
  id: string; name: string; admin_email: string | null;
  phone: string | null; city: string | null; country_iso: string | null;
  currency_code: string | null; timezone: string | null; phone_prefix: string | null;
  plan_id: string | null; logo_url: string | null; suspended_at: string | null;
  feature_overrides: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  created_at: string;
};
type TenantStats = { activeUsers: number; branches: number; lastSale: string | null; customers: number };
type Plan = { id: string; name: string; monthly_price: number };

const COUNTRY_DEFAULTS: Record<string, { currency: string; timezone: string; prefix: string }> = {
  CO: { currency: 'COP', timezone: 'America/Bogota', prefix: '+57' },
  MX: { currency: 'MXN', timezone: 'America/Mexico_City', prefix: '+52' },
  CL: { currency: 'CLP', timezone: 'America/Santiago', prefix: '+56' },
  ES: { currency: 'EUR', timezone: 'Europe/Madrid', prefix: '+34' },
  AR: { currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires', prefix: '+54' },
  PE: { currency: 'PEN', timezone: 'America/Lima', prefix: '+51' },
  EC: { currency: 'USD', timezone: 'America/Guayaquil', prefix: '+593' },
  CR: { currency: 'CRC', timezone: 'America/Costa_Rica', prefix: '+506' },
  DO: { currency: 'DOP', timezone: 'America/Santo_Domingo', prefix: '+1' },
  GT: { currency: 'GTQ', timezone: 'America/Guatemala', prefix: '+502' },
  PA: { currency: 'PAB', timezone: 'America/Panama', prefix: '+507' },
  VE: { currency: 'VES', timezone: 'America/Caracas', prefix: '+58' },
  BO: { currency: 'BOB', timezone: 'America/La_Paz', prefix: '+591' },
  PR: { currency: 'USD', timezone: 'America/Puerto_Rico', prefix: '+1' },
};

const inputCls = 'w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tenant,        setTenant]        = useState<Tenant | null>(null);
  const [stats,         setStats]         = useState<TenantStats | null>(null);
  const [regionLocked,  setRegionLocked]  = useState(false);
  const [plans,         setPlans]         = useState<Plan[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [logoUrl,       setLogoUrl]       = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError,     setLogoError]     = useState<string | null>(null);
  const [copiedBooking, setCopiedBooking] = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteName,    setDeleteName]    = useState('');
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState<string | null>(null);
  const [failedLogins,  setFailedLogins]  = useState<string[] | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingSuspension, setSavingSuspension] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [suspensionError, setSuspensionError] = useState<string | null>(null);
  const { ask, dialog } = useAskDialog();

  // Editable fields
  const [email,    setEmail]    = useState('');
  const [planId,   setPlanId]   = useState('');
  const [currency, setCurrency] = useState('');
  const [timezone, setTimezone] = useState('');
  const [country,  setCountry]  = useState('');
  const [phonePrefix, setPhonePrefix] = useState('');

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
        setCountry(t.country_iso ?? 'CO');
        setPhonePrefix(t.phone_prefix ?? '');
        setLogoUrl(t.logo_url ?? null);
        setStats(detail.stats);
        setRegionLocked(detail.regionLocked);
      }
      setPlans(plans as Plan[]);
      setLoading(false);
    }
    load();
  }, [id]);

  function handleCountryChange(isoCode: string) {
    setCountry(isoCode);
    const defaults = COUNTRY_DEFAULTS[isoCode];
    if (defaults) {
      setCurrency(defaults.currency);
      setTimezone(defaults.timezone);
      setPhonePrefix(defaults.prefix);
    }
  }

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
        country_iso:   country  || null,
        phone_prefix:  phonePrefix || null,
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

  async function handleCopyBooking(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedBooking(true);
      setTimeout(() => setCopiedBooking(false), 2000);
    } catch { /* clipboard unavailable — the input is still selectable */ }
  }

  async function handleTemplateToggle() {
    if (!tenant) return;
    setSavingTemplate(true);
    const res = await fetch(`/api/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_overrides_changes: { set: { cloneTemplate: !isTemplate }, remove: [] } }),
    });
    if (res.ok) setTenant({ ...tenant, feature_overrides: (await res.json()).feature_overrides });
    setSavingTemplate(false);
  }

  async function handleExport() {
    if (!tenant) return;
    const reason = await ask({
      title: `Export the data of ${tenant.name}?`,
      message: 'The ZIP includes customer personal data. Keep it safe and delete it when you no longer need it.',
      confirmLabel: 'Download ZIP',
      placeholder: 'e.g. The salon asked for a copy of its data',
    });
    if (!reason) return;

    setExportError(null);
    setExporting(true);
    const res = await fetch(`/api/tenants/${id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `nubel-export-${tenant.name.replace(/[^\w-]+/g, '_')}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      setExportError((await res.json()).error ?? 'Export failed');
    }
    setExporting(false);
  }

  async function handleSuspensionToggle() {
    if (!tenant) return;
    const suspended = !tenant.suspended_at;
    const reason = await ask(suspended
      ? {
          title: `Suspend ${tenant.name}?`,
          message: 'Its staff will only be able to read: no sales, appointments or changes until you reactivate it.',
          confirmLabel: 'Suspend',
          tone: 'danger',
          placeholder: 'e.g. Payment overdue since…',
        }
      : {
          title: `Reactivate ${tenant.name}?`,
          message: 'Its staff can work normally again.',
          confirmLabel: 'Reactivate',
        });
    if (!reason) return;

    setSuspensionError(null);
    setSavingSuspension(true);
    const res = await fetch(`/api/tenants/${id}/suspension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspended, reason }),
    });
    const json = await res.json();
    if (res.ok) setTenant({ ...tenant, suspended_at: json.suspended_at });
    else setSuspensionError(json.error ?? 'Failed to update');
    setSavingSuspension(false);
  }

  function closeDelete() {
    setShowDelete(false);
    setDeleteName('');
    setDeleteError(null);
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    const res = await fetch(`/api/tenants/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: deleteName }),
    });
    const json = await res.json();
    setDeleting(false);
    if (!res.ok) { setDeleteError(json.error ?? 'Failed to delete'); return; }
    if (json.failedLogins?.length > 0) setFailedLogins(json.failedLogins);
    else router.push('/tenants');
  }

  if (loading) return <><AdminHeader title="Tenant" /><div className="p-8 text-sm text-slate-500">Loading...</div></>;
  if (!tenant) return <><AdminHeader title="Tenant" /><div className="p-8 text-sm text-slate-500">Tenant not found</div></>;

  const currentPlan = plans.find(p => p.id === planId);
  const isTemplate = tenant.feature_overrides?.cloneTemplate === true;

  // Public booking portal (served by the main app at /book/[tenant_id]).
  const bookingBase = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? 'https://app.nubel.tech';
  const bookingUrl  = `${bookingBase.replace(/\/$/, '')}/book/${tenant.id}`;
  // Enabled only when the salon has published services — same gate the portal RPC
  // uses (feature_overrides.publicAllowedServices). Otherwise the link 404s.
  const publicServices = (tenant.feature_overrides as { publicAllowedServices?: unknown } | null)?.publicAllowedServices;
  const bookingEnabled = Array.isArray(publicServices) && publicServices.length > 0;

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
            <Hint id="stats.users" className="flex"><Link href={`/tenants/${id}/users`}
              className="flex-1 bg-white rounded-2xl border border-slate-200 p-4 text-center hover:border-indigo-200 transition-colors">
              <Users size={18} className="mx-auto text-slate-400 mb-1" />
              <p className="text-xl font-black text-slate-900">{stats.activeUsers}</p>
              <p className="text-[11px] text-slate-400">Users <HintIcon /></p>
            </Link></Hint>
            <Hint id="stats.customers" className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <UserRound size={18} className="mx-auto text-slate-400 mb-1" />
              <p className="text-xl font-black text-slate-900">{stats.customers}</p>
              <p className="text-[11px] text-slate-400">Customers <HintIcon /></p>
            </Hint>
            {[
              { icon: GitBranch,   value: stats.branches, label: 'Branches', hint: 'stats.branches' as HelpKey },
              { icon: ShoppingBag, value: stats.lastSale
                  ? new Date(stats.lastSale).toLocaleDateString('en', { day: 'numeric', month: 'short' })
                  : '—', label: 'Last sale', hint: 'stats.lastSale' as HelpKey },
            ].map(({ icon: Icon, value, label, hint }) => (
              <Hint key={label} id={hint} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                <Icon size={18} className="mx-auto text-slate-400 mb-1" />
                <p className="text-xl font-black text-slate-900">{value}</p>
                <p className="text-[11px] text-slate-400">{label} <HintIcon /></p>
              </Hint>
            ))}
          </div>
        )}

        {/* Quick links */}
        <div className="flex gap-2 flex-wrap">
          <Hint id="link.flags" inline className="flex"><Link href={`/flags?tenant=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Feature Flags</Link></Hint>
          <Hint id="link.impersonate" inline className="flex"><Link href={`/impersonate?tenant=${id}`} className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Impersonate</Link></Hint>
          <Hint id="link.clone" inline className="flex"><Link href={`/clone?source=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Clone</Link></Hint>
          <Hint id="link.audit" inline className="flex"><Link href={`/audit?tenant=${id}`}       className="text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Audit log</Link></Hint>
          <Hint id="link.openApp" inline className="flex">
          <a href={process.env.NEXT_PUBLIC_MAIN_APP_URL ?? 'https://app.nubel.tech'} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs rounded-full border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
            <ExternalLink size={12} /> Open app
          </a>
          </Hint>
        </div>

        <NotesCard tenantId={tenant.id} />

        <OnboardingCard tenantId={tenant.id} />

        <IntegrationsCard tenantId={tenant.id} />

        <TimelineCard tenantId={tenant.id} />

        {/* Public booking link — the salon's shareable /book portal URL */}
        <Hint id="card.booking" className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black text-slate-700 flex items-center gap-2">
              <CalendarCheck size={15} className="text-slate-400" /> Public booking page <HintIcon />
            </p>
            {bookingEnabled ? (
              <span className="text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-600 px-2 py-0.5">Enabled</span>
            ) : (
              <span className="text-[10px] font-bold rounded-full bg-slate-100 text-slate-400 px-2 py-0.5">Not enabled</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={bookingUrl}
              onFocus={e => e.target.select()}
              className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 truncate"
            />
            <button
              type="button"
              onClick={() => handleCopyBooking(bookingUrl)}
              title="Copy URL"
              className="flex items-center gap-1.5 text-xs font-bold rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50 transition-colors flex-shrink-0"
            >
              {copiedBooking ? <><Check size={12} className="text-emerald-500" /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open booking page"
              className="flex items-center rounded-xl border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0"
            >
              <ExternalLink size={12} />
            </a>
          </div>
          {!bookingEnabled && (
            <p className="text-[11px] text-slate-400">
              El salón aún no habilitó su agenda pública (no hay servicios publicables). El enlace mostrará “Salón no encontrado” hasta que active servicios en el app.
            </p>
          )}
        </Hint>

        {/* Logo */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <Hint id="settings.logo"><p className="text-sm font-black text-slate-700">Logo <HintIcon /></p></Hint>
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
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
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
          <Hint id="info.id">
            <p className="text-xs font-medium text-slate-400 mb-1">ID <HintIcon /></p>
            <p className="text-xs font-mono text-slate-400 break-all">{tenant.id}</p>
          </Hint>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Name',    value: tenant.name,                hint: 'info.name' },
              { label: 'City',    value: tenant.city    ?? '—',      hint: 'info.city' },
              { label: 'Phone',   value: tenant.phone   ?? '—',      hint: 'info.phone' },
              { label: 'Country', value: tenant.country_iso ?? '—',  hint: 'info.country' },
            ].map(({ label, value, hint }) => (
              <Hint key={label} id={hint as HelpKey}>
                <p className="text-xs font-medium text-slate-400 mb-0.5">{label} <HintIcon /></p>
                <p className="text-sm text-slate-700">{value}</p>
              </Hint>
            ))}
          </div>
        </div>

        {/* Editable fields */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Platform settings</p>

            <Hint id="settings.adminEmail">
              <label className={labelCls}>Admin email <HintIcon /></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls}
                placeholder="admin@empresa.com" />
            </Hint>

            <div className="grid grid-cols-3 gap-3">
              <Hint id="settings.country">
                <label className={labelCls}>Country (ISO) <HintIcon /></label>
                <select value={country} onChange={e => handleCountryChange(e.target.value)} disabled={regionLocked}
                  className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed`}>
                  <option value="CO">🇨🇴 Colombia (CO)</option>
                  <option value="MX">🇲🇽 México (MX)</option>
                  <option value="CL">🇨🇱 Chile (CL)</option>
                  <option value="ES">🇪🇸 España (ES)</option>
                  <option value="AR">🇦🇷 Argentina (AR)</option>
                  <option value="PE">🇵🇪 Perú (PE)</option>
                  <option value="EC">🇪🇨 Ecuador (EC)</option>
                  <option value="CR">🇨🇷 Costa Rica (CR)</option>
                  <option value="DO">🇩🇴 Rep. Dominicana (DO)</option>
                  <option value="GT">🇬🇹 Guatemala (GT)</option>
                  <option value="PA">🇵🇦 Panamá (PA)</option>
                  <option value="VE">🇻🇪 Venezuela (VE)</option>
                  <option value="BO">🇧🇴 Bolivia (BO)</option>
                  <option value="PR">🇵🇷 Puerto Rico (PR)</option>
                </select>
              </Hint>
              <Hint id="settings.currency">
                <label className={labelCls}>Currency <HintIcon /></label>
                <input type="text" value={currency} readOnly
                  className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} placeholder="COP" />
              </Hint>
              <Hint id="settings.timezone">
                <label className={labelCls}>Timezone <HintIcon /></label>
                <input type="text" value={timezone} readOnly
                  className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} placeholder="America/Bogota" />
              </Hint>
              <Hint id="settings.phonePrefix">
                <label className={labelCls}>Phone prefix <HintIcon /></label>
                <input type="text" value={phonePrefix} readOnly
                  className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} placeholder="+57" />
              </Hint>
            </div>

            {regionLocked && (
              <p className="text-xs text-amber-600">Region is locked because this tenant has financial records. Changing it would corrupt its amounts and day cutoffs.</p>
            )}

            {/* Plan */}
            <Hint id="settings.plan" className="pt-2 border-t border-slate-100">
              <label className={labelCls}>
                <span className="flex items-center gap-2"><CreditCard size={14} className="text-slate-400" /> Subscription plan <HintIcon /></span>
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
            </Hint>

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

        {/* Export */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Hint id="action.export">
              <p className="text-sm font-black text-slate-700 flex items-center gap-2"><Download size={15} className="text-slate-400" /> Export data <HintIcon /></p>
              <p className="text-xs text-slate-400 mt-0.5">Downloads a ZIP of CSV files with the salon&apos;s records. It has personal data: never send it as an email attachment.</p>
            </Hint>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="text-xs font-bold rounded-full border border-slate-200 px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
          {exportError && <p className="text-xs text-rose-600">{exportError}</p>}
        </div>

        {/* Suspension */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Hint id="action.suspend">
              <p className="text-sm font-black text-slate-700 flex items-center gap-2">
                <Ban size={15} className="text-slate-400" /> Suspension <HintIcon />
                {tenant.suspended_at && <span className="text-[10px] font-bold rounded-full bg-rose-50 text-rose-600 px-2 py-0.5">Suspended</span>}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {tenant.suspended_at
                  ? `Read-only since ${new Date(tenant.suspended_at).toLocaleDateString('en', { dateStyle: 'long' })}. The reason is in the audit log.`
                  : 'Makes the salon read-only and stops public booking, WhatsApp and reminders. Support chat stays on.'}
              </p>
            </Hint>
            <button
              type="button"
              onClick={handleSuspensionToggle}
              disabled={savingSuspension}
              className="text-xs font-bold rounded-full border border-slate-200 px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors flex-shrink-0"
            >
              {tenant.suspended_at ? 'Reactivate' : 'Suspend'}
            </button>
          </div>
          {suspensionError && <p className="text-xs text-rose-600">{suspensionError}</p>}
        </div>

        {/* Clone template */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between gap-4">
          <Hint id="action.template">
            <p className="text-sm font-black text-slate-700 flex items-center gap-2"><CopyIcon size={15} className="text-slate-400" /> Clone template <HintIcon /></p>
            <p className="text-xs text-slate-400 mt-0.5">Only templates can be a clone source. Its catalog, costs and suppliers get copied, so never use a real salon.</p>
          </Hint>
          <button
            type="button"
            onClick={handleTemplateToggle}
            disabled={savingTemplate}
            className="text-xs font-bold rounded-full border border-slate-200 px-4 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {isTemplate ? 'Remove template' : 'Mark as template'}
          </button>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-2xl border border-rose-200 p-5 flex items-center justify-between gap-4">
          <Hint id="action.delete">
            <p className="text-sm font-black text-slate-700">Delete tenant <HintIcon /></p>
            <p className="text-xs text-slate-400 mt-0.5">Only for empty tenants. Removes the tenant and its logins permanently.</p>
          </Hint>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-1.5 text-xs font-bold rounded-full border border-rose-200 text-rose-600 px-4 py-2 hover:bg-rose-50 transition-colors flex-shrink-0"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            {failedLogins ? (
              <>
                <h2 className="text-base font-black text-slate-900">Tenant deleted</h2>
                <p className="text-sm text-amber-700">
                  These logins could not be removed and their emails stay taken: {failedLogins.join(', ')}. Remove them in Supabase → Authentication.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/tenants')}
                  className="w-full rounded-full bg-indigo-600 text-white font-black px-6 py-2.5 text-sm"
                >
                  OK
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-black text-slate-900">Delete {tenant.name}?</h2>
                <p className="text-sm text-slate-600">
                  This can&apos;t be undone. It deletes the tenant, its settings and its users&apos; logins. Tenants with data are rejected.
                </p>
                <div>
                  <label className={labelCls}>Type the tenant name to confirm</label>
                  <input value={deleteName} onChange={e => setDeleteName(e.target.value)} className={inputCls} placeholder={tenant.name} />
                </div>
                {deleteError && <p className="text-sm text-rose-600">{deleteError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={closeDelete}
                    disabled={deleting}
                    className="text-sm font-bold rounded-full border border-slate-200 px-5 py-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || deleteName !== tenant.name}
                    className="rounded-full bg-rose-600 text-white font-black px-5 py-2.5 text-sm disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Delete tenant'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {dialog}
    </>
  );
}
