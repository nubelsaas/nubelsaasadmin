'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';

type Tenant = { id: string; name: string; feature_overrides: Record<string, unknown> | null; settings: Record<string, unknown> | null; is_audit_enabled: boolean };

type BoolFlag = { key: string; label: string; description: string; defaultOn: boolean };

type SettingFlag = { key: string; label: string; description: string };

const SETTINGS_FLAGS: SettingFlag[] = [
  { key: 'show_checkout_preview', label: 'Checkout Preview',    description: 'Show thermal receipt preview panel before confirming sale' },
  { key: 'auto_print_receipt',    label: 'Auto-print Receipt',  description: 'Automatically print receipt after each sale is completed'  },
];

const BOOL_FLAGS: BoolFlag[] = [
  { key: 'enableShifts',               label: 'Cash Register Shifts',        description: 'Explicit shift open/close in POS (Z-Read)',              defaultOn: true  },
  { key: 'enableEmployeeLoans',        label: 'Employee Loans & Advances',   description: 'Deductions tab in payroll and cash advances for staff',   defaultOn: false },
  { key: 'enableCustomerAdvancements', label: 'Customer Advances',           description: 'Credit balance / advances in the clients module',         defaultOn: false },
  { key: 'enableGiftCards',            label: 'Gift Cards',                  description: 'Sale and redemption of gift cards',                       defaultOn: false },
  { key: 'enableTips',                 label: 'Tips',                        description: 'Record tips per stylist on sales',                        defaultOn: false },
  { key: 'enableCourtesy',             label: 'Courtesy Tickets',            description: 'Tickets marked as courtesy (amount $0)',                  defaultOn: false },
  { key: 'enableScheduler',            label: 'Scheduler (Agenda)',          description: 'Calendar view for managing appointments and block times', defaultOn: false },
];

// Canales del recordatorio de citas al cliente. Flag ANIDADO en
// feature_overrides.clientReminders = { email, whatsapp, sms }.
// Fase 1: solo Email es activable (default ON); WhatsApp/SMS se muestran
// bloqueados (irán en planes independientes).
type ReminderChannel = { key: string; label: string; description: string; defaultOn: boolean; locked: boolean };

const REMINDER_CHANNELS: ReminderChannel[] = [
  { key: 'email',    label: 'Email',    description: 'Appointment reminder + confirmation by email',   defaultOn: true,  locked: false },
  { key: 'whatsapp', label: 'WhatsApp', description: 'Coming soon — separate plan',                    defaultOn: false, locked: true  },
  { key: 'sms',      label: 'SMS',      description: 'Requires a provider (Twilio, etc.) — later',     defaultOn: false, locked: true  },
];

export default function FlagsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [flags, setFlags] = useState<Record<string, unknown>>({});
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [auditEnabled, setAuditEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingTenants, setLoadingTenants] = useState(false);

  const loadTenants = useCallback(async () => {
    setLoadingTenants(true);
    const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    const res = await fetch(`/api/tenants${params}`);
    const data = res.ok ? await res.json() : [];
    setTenants(data);
    setLoadingTenants(false);
  }, [search]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  function selectTenant(t: Tenant) {
    setSelected(t);
    const fo = (t.feature_overrides ?? {}) as Record<string, unknown>;
    setFlags(fo);
    setSettings((t.settings ?? {}) as Record<string, unknown>);
    setAuditEnabled(t.is_audit_enabled ?? true);
    setSaved(false);
  }

  function getFlagValue(key: string, defaultOn: boolean): boolean {
    if (key in flags) return Boolean(flags[key]);
    return defaultOn;
  }

  function toggleFlag(key: string, defaultOn: boolean) {
    setFlags(prev => ({ ...prev, [key]: !getFlagValue(key, defaultOn) }));
  }

  // Flag anidado feature_overrides.clientReminders.{channel}
  function getReminderChannel(channel: string, defaultOn: boolean): boolean {
    const cr = (flags.clientReminders ?? {}) as Record<string, unknown>;
    if (channel in cr) return Boolean(cr[channel]);
    return defaultOn;
  }

  function toggleReminderChannel(channel: string, defaultOn: boolean) {
    setFlags(prev => {
      const cr = { ...((prev.clientReminders ?? {}) as Record<string, unknown>) };
      const current = channel in cr ? Boolean(cr[channel]) : defaultOn;
      cr[channel] = !current;
      return { ...prev, clientReminders: cr };
    });
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    const newFlags: Record<string, unknown> = { ...flags };

    const res = await fetch(`/api/tenants/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_overrides: newFlags, settings, is_audit_enabled: auditEnabled }),
    });

    if (res.ok) {
      setSelected(prev => prev ? { ...prev, feature_overrides: newFlags, settings, is_audit_enabled: auditEnabled } : prev);
      setTenants(prev => prev.map(t => t.id === selected.id ? { ...t, feature_overrides: newFlags, settings, is_audit_enabled: auditEnabled } : t));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  return (
    <>
      <AdminHeader title="Feature Flags" />
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden h-full">

        <div className="w-full md:w-72 md:border-r border-slate-200 flex flex-col bg-white">
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search tenant..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {loadingTenants ? (
              <p className="text-xs text-slate-400 text-center py-8">Loading...</p>
            ) : tenants.map(t => (
              <button key={t.id} onClick={() => selectTenant(t)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${
                  selected?.id === t.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'
                }`}>
                <p className="text-sm font-medium truncate">{t.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {!selected ? (
            <div className="flex items-center justify-center h-48 text-sm text-slate-400">
              Select a tenant to edit its feature flags
            </div>
          ) : (
            <div className="max-w-xl space-y-6">
              <h2 className="text-base font-black text-slate-900">{selected.name}</h2>

              {/* Feature Overrides */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Feature Flags</p>
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {BOOL_FLAGS.map(({ key, label, description, defaultOn }) => {
                    const on = getFlagValue(key, defaultOn);
                    return (
                      <div key={key} className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                          <p className="text-[10px] font-mono text-slate-300 mt-0.5">{key}</p>
                        </div>
                        <button type="button" onClick={() => toggleFlag(key, defaultOn)} className={on ? 'text-indigo-500' : 'text-slate-300'}>
                          {on ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Client Reminders (flag anidado por canal) */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Client Reminders</p>
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {REMINDER_CHANNELS.map(({ key, label, description, defaultOn, locked }) => {
                    const on = getReminderChannel(key, defaultOn);
                    return (
                      <div key={key} className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 flex items-center gap-2">
                            {label}
                            {locked && (
                              <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                Blocked
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                          <p className="text-[10px] font-mono text-slate-300 mt-0.5">clientReminders.{key}</p>
                        </div>
                        <button type="button" disabled={locked}
                          onClick={() => !locked && toggleReminderChannel(key, defaultOn)}
                          className={locked ? 'text-slate-200 cursor-not-allowed' : on ? 'text-indigo-500' : 'text-slate-300'}>
                          {on ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Settings */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Settings</p>
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {SETTINGS_FLAGS.map(({ key, label, description }) => {
                    const on = Boolean(settings[key]);
                    return (
                      <div key={key} className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                          <p className="text-[10px] font-mono text-slate-300 mt-0.5">{key}</p>
                        </div>
                        <button type="button"
                          onClick={() => setSettings(prev => ({ ...prev, [key]: !prev[key] }))}
                          className={on ? 'text-indigo-500' : 'text-slate-300'}>
                          {on ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Platform controls */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Platform</p>
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">Audit Log</p>
                      <p className="text-xs text-slate-400 mt-0.5">Enable the audit logging system for this tenant</p>
                      <p className="text-[10px] font-mono text-slate-300 mt-0.5">is_audit_enabled</p>
                    </div>
                    <button type="button" onClick={() => setAuditEnabled(p => !p)}
                      className={auditEnabled ? 'text-indigo-500' : 'text-slate-300'}>
                      {auditEnabled ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
                    </button>
                  </div>
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-6 py-2.5 text-sm disabled:opacity-50">
                <Save size={15} />
                {saved ? 'Saved!' : saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
