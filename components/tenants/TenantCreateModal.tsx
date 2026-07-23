'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Upload, ImageIcon } from 'lucide-react';
import { COUNTRY_OPTIONS, COUNTRIES } from '@/lib/countries';

type Plan = { id: string; name: string; monthly_price: number };
type Props = { onClose: () => void; onCreated: () => void };

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const labelCls = 'block text-xs font-medium text-slate-500 mb-1';

export default function TenantCreateModal({ onClose, onCreated }: Props) {
  // Core
  const [name,        setName]        = useState('');
  const [countryIso,  setCountryIso]  = useState('CO');
  const [planId,      setPlanId]      = useState('');
  // Contact
  const [adminEmail,  setAdminEmail]  = useState('');
  const [adminName,   setAdminName]   = useState('');
  const [phone,       setPhone]       = useState('');
  const [city,        setCity]        = useState('');
  // Config (auto-filled from country, editable)
  const [currency,    setCurrency]    = useState('COP');
  const [timezone,    setTimezone]    = useState('America/Bogota');
  const [phonePrefix, setPhonePrefix] = useState('+57');
  // Logo
  const [logoFile,    setLogoFile]    = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Remote
  const [plans,   setPlans]   = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plans').then(r => r.json()).then((rows: Plan[]) => {
      setPlans(rows);
      if (rows.length) setPlanId(rows[0].id);
    });
  }, []);

  function handleCountryChange(iso: string) {
    setCountryIso(iso);
    const c = COUNTRIES[iso];
    if (!c) return;
    setCurrency(c.currencyCode);
    setTimezone(c.timezone);
    setPhonePrefix(c.phonePrefix);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!planId) { setError('Select a plan'); return; }
    setError(null);
    setLoading(true);

    // Upload logo if selected
    let logoUrl: string | null = null;
    if (logoFile) {
      const fd = new FormData();
      fd.append('file', logoFile);
      const uploadRes = await fetch('/api/upload/logo', { method: 'POST', body: fd });
      if (uploadRes.ok) {
        const { url } = await uploadRes.json();
        logoUrl = url;
      } else {
        const { error: uploadErr } = await uploadRes.json();
        setError(`Logo upload failed: ${uploadErr}`);
        setLoading(false);
        return;
      }
    }

    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        plan_id:      planId,
        country_iso:  countryIso,
        phone_prefix: phonePrefix,
        currency_code: currency,
        timezone,
        admin_email:  adminEmail || null,
        phone:        phone     || null,
        city:         city      || null,
        logo_url:     logoUrl,
        admin_name:   adminName || null,
      }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Failed to create tenant'); setLoading(false); return; }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-0 md:px-4">
      <div className="w-full md:max-w-xl bg-white rounded-t-2xl md:rounded-2xl flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-black text-slate-900">New tenant</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        {/* Scrollable body */}
        <form id="create-tenant" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Identity */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Identity</p>
            <div>
              <label className={labelCls}>Business name <span className="text-rose-500">*</span></label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus
                className={inputCls} placeholder="Salón Ejemplo" />
            </div>
          </section>

          {/* Location */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Location</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Country <span className="text-rose-500">*</span></label>
                <select value={countryIso} onChange={e => handleCountryChange(e.target.value)} required className={inputCls}>
                  {COUNTRY_OPTIONS.map(c => (
                    <option key={c.iso} value={c.iso}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  className={inputCls} placeholder="Bogotá" />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Contact</p>
            <div>
              <label className={labelCls}>Admin email <span className="text-rose-500">*</span></label>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} required
                className={inputCls} placeholder="admin@ejemplo.com" />
              <p className="mt-1 text-[10px] text-slate-400">Cada tenant debe nacer con su Súper Administrador. Se le enviará una invitación para configurar su acceso.</p>
            </div>
            <div>
              <label className={labelCls}>Admin name</label>
              <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)}
                className={inputCls} placeholder="Juan Pérez" />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <div className="flex gap-2">
                <input type="text" value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)}
                  className={`${inputCls} w-20 text-center`} />
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  className={`${inputCls} flex-1`} placeholder="3001234567" />
              </div>
            </div>
          </section>

          {/* Configuration */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Configuration</p>
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
          </section>

          {/* Plan */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Plan</p>
            <select value={planId} onChange={e => setPlanId(e.target.value)} required className={inputCls}>
              {plans.length === 0 && <option value="">Loading plans…</option>}
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${p.monthly_price.toLocaleString()}/mo
                </option>
              ))}
            </select>
          </section>

          {/* Logo */}
          <section className="space-y-3">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">Logo</p>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-4 border-2 border-dashed border-slate-200 rounded-2xl p-4 cursor-pointer hover:border-indigo-300 transition-colors">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo preview" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <ImageIcon size={22} className="text-slate-400" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-slate-700">
                  {logoFile ? logoFile.name : 'Click to upload logo'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">PNG, JPG or SVG · max 2 MB</p>
              </div>
              <Upload size={16} className="text-slate-400 ml-auto flex-shrink-0" />
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={handleFileChange} />
          </section>

          {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-4 py-2">{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-medium text-slate-600">
            Cancel
          </button>
          <button type="submit" form="create-tenant"
            disabled={loading || !planId || !name || !countryIso}
            className="flex-1 rounded-full bg-indigo-600 text-white font-black py-2.5 text-sm disabled:opacity-50">
            {loading ? 'Creating…' : 'Create tenant'}
          </button>
        </div>

      </div>
    </div>
  );
}
