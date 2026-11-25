'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Megaphone, RefreshCw, Search, X } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';
import { countryLabel } from '@/lib/countries';
import { matchesSearch } from '@/lib/tenantFilters';
import { BODY_MAX, LINK_LABEL_MAX, TITLE_MAX, type AnnouncementLevel, type AnnouncementStatus } from '@/lib/announcementRules';
import type { AnnouncementListItem } from '@/lib/announcements';

// Anuncios a los salones. El app los muestra arriba de la pantalla (nubelsaas,
// AnnouncementBanner); la vista previa copia ese diseño. Ver docs/features/announcements.md.

type Tenant = { id: string; name: string; admin_email: string | null; country_iso: string | null; plan_id: string | null };
type Plan = { id: string; name: string };

type Form = {
  title: string; body: string; level: AnnouncementLevel; link_url: string; link_label: string;
  plan_ids: string[]; countries: string[]; tenant_ids: string[]; owners_only: boolean;
  starts_at: string; ends_at: string;   // datetime-local, hora del navegador
};

const EMPTY: Form = {
  title: '', body: '', level: 'info', link_url: '', link_label: '',
  plan_ids: [], countries: [], tenant_ids: [], owners_only: false, starts_at: '', ends_at: '',
};

const LEVEL_LABEL: Record<AnnouncementLevel, string> = { info: 'Info', warning: 'Warning', critical: 'Critical' };
const LEVEL_BADGE: Record<AnnouncementLevel, string> = {
  info: 'bg-indigo-50 text-indigo-600', warning: 'bg-amber-50 text-amber-700', critical: 'bg-rose-50 text-rose-600',
};
// Mismos colores que el aviso del app.
const PREVIEW: Record<AnnouncementLevel, { box: string; icon: string }> = {
  info: { box: 'bg-indigo-600 text-white', icon: 'text-indigo-200' },
  warning: { box: 'bg-amber-500 text-slate-950', icon: 'text-amber-900' },
  critical: { box: 'bg-rose-600 text-white', icon: 'text-rose-100' },
};
const STATUS_LABEL: Record<AnnouncementStatus, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended' };

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const labelCls = 'block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1';

const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null);
const formatDate = (iso: string) => new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reach, setReach] = useState<{ salons: number; people: number } | null>(null);
  const [salonSearch, setSalonSearch] = useState('');
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const res = await fetch('/api/announcements');
    const json = await res.json().catch(() => null);
    if (res.ok) setItems(json);
    else setListError(json?.error ?? 'Could not load announcements');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    Promise.all([fetch('/api/tenants'), fetch('/api/plans')]).then(async ([t, p]) => {
      if (t.ok) setTenants(await t.json());
      if (p.ok) setPlans(await p.json());
    });
  }, [load]);

  // Alcance: se recalcula al cambiar el público, con una pausa corta para no pedir en cada clic.
  const audienceKey = JSON.stringify([form.plan_ids, form.countries, form.tenant_ids, form.owners_only]);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      const [plan_ids, countries, tenant_ids, owners_only] = JSON.parse(audienceKey);
      const res = await fetch('/api/announcements/reach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_ids, countries, tenant_ids, owners_only }),
      });
      if (!stale) setReach(res.ok ? await res.json() : null);
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [audienceKey]);

  const countries = useMemo(
    () => Array.from(new Set(tenants.map(t => t.country_iso).filter((c): c is string => Boolean(c)))).sort(),
    [tenants],
  );
  const tenantName = useCallback((id: string) => tenants.find(t => t.id === id)?.name ?? id.slice(0, 8), [tenants]);
  const salonMatches = salonSearch.trim()
    ? tenants.filter(t => matchesSearch(t, salonSearch) && !form.tenant_ids.includes(t.id)).slice(0, 8)
    : [];

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => ({ ...f, [key]: value }));

  const startsLater = form.starts_at && new Date(form.starts_at).getTime() > Date.now();

  async function submit() {
    setSaving(true);
    setFormError(null);
    setSaved(null);
    const payload = { ...form, starts_at: fromLocal(form.starts_at), ends_at: fromLocal(form.ends_at) };
    const res = await fetch(editingId ? `/api/announcements/${editingId}` : '/api/announcements', {
      method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setSaved(editingId ? 'Changes saved.' : startsLater ? 'Scheduled.' : 'Published. Salons see it the next time the app checks (on open, or when they come back to it).');
      setForm(EMPTY);
      setEditingId(null);
      await load();
    } else {
      setFormError(json?.error ?? 'Could not save the announcement');
    }
    setSaving(false);
  }

  function edit(a: AnnouncementListItem) {
    setEditingId(a.id);
    setSaved(null);
    setFormError(null);
    setForm({
      title: a.title, body: a.body, level: a.level, link_url: a.link_url ?? '', link_label: a.link_label ?? '',
      plan_ids: a.plan_ids ?? [], countries: a.countries ?? [], tenant_ids: a.tenant_ids ?? [], owners_only: a.owners_only,
      starts_at: toLocal(a.starts_at), ends_at: toLocal(a.ends_at),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function end(a: AnnouncementListItem) {
    setEnding(a.id);
    const res = await fetch(`/api/announcements/${a.id}/end`, { method: 'POST' });
    const json = await res.json().catch(() => null);
    if (!res.ok) setListError(json?.error ?? 'Could not end the announcement');
    setConfirmEnd(null);
    setEnding(null);
    if (editingId === a.id) { setEditingId(null); setForm(EMPTY); }
    await load();
  }

  function audienceText(a: Pick<AnnouncementListItem, 'plan_ids' | 'countries' | 'tenant_ids' | 'owners_only'>) {
    const parts: string[] = [];
    if (a.tenant_ids) parts.push(a.tenant_ids.map(tenantName).join(', '));
    if (a.plan_ids) parts.push(`plan ${a.plan_ids.map(id => plans.find(p => p.id === id)?.name ?? id.slice(0, 8)).join(' / ')}`);
    if (a.countries) parts.push(a.countries.map(countryLabel).join(', '));
    const who = a.owners_only ? 'Owners' : 'Everyone';
    return parts.length ? `${who} · ${parts.join(' · ')}` : `${who} · all salons`;
  }

  const groups: AnnouncementStatus[] = ['live', 'scheduled', 'ended'];
  const previewLink = form.link_url.trim();
  const PreviewIcon = form.level === 'info' ? Megaphone : AlertTriangle;

  return (
    <>
      <AdminHeader title="Announcements" />
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">

        {/* ── Formulario ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-black text-slate-700">{editingId ? 'Edit scheduled announcement' : 'New announcement'}</p>
            {editingId && (
              <button onClick={() => { setEditingId(null); setForm(EMPTY); }} className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600">
                Cancel edit
              </button>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="ann-title">Title</label>
                <input id="ann-title" value={form.title} maxLength={TITLE_MAX} onChange={e => set('title', e.target.value)} className={inputCls}
                  placeholder="Mantenimiento programado hoy a las 10 pm" />
              </div>
              <div>
                <label className={labelCls} htmlFor="ann-body">Message <span className="normal-case font-medium tracking-normal">(optional)</span></label>
                <textarea id="ann-body" value={form.body} maxLength={BODY_MAX} rows={3} onChange={e => set('body', e.target.value)} className={inputCls}
                  placeholder="Salons read this in the app, so write it in Spanish." />
              </div>
              <div>
                <p className={labelCls}>Level</p>
                <div className="flex gap-2">
                  {(['info', 'warning', 'critical'] as AnnouncementLevel[]).map(l => (
                    <button key={l} type="button" onClick={() => set('level', l)} aria-pressed={form.level === l}
                      className={`text-xs font-bold rounded-full px-3 py-1.5 border ${form.level === l ? `${LEVEL_BADGE[l]} border-current` : 'border-slate-200 text-slate-500'}`}>
                      {LEVEL_LABEL[l]}
                    </button>
                  ))}
                </div>
                {form.level === 'critical' && <p className="text-xs text-slate-500 mt-1.5">Critical can&apos;t be closed in the app, only minimized, until it ends.</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className={labelCls} htmlFor="ann-link">Link <span className="normal-case font-medium tracking-normal">(optional, https)</span></label>
                  <input id="ann-link" value={form.link_url} onChange={e => set('link_url', e.target.value)} className={inputCls} placeholder="https://" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="ann-link-label">Link text</label>
                  <input id="ann-link-label" value={form.link_label} maxLength={LINK_LABEL_MAX} onChange={e => set('link_label', e.target.value)} className={inputCls} placeholder="Ver más" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} htmlFor="ann-start">Starts</label>
                  <input id="ann-start" type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} className={inputCls} />
                  <p className="text-[11px] text-slate-400 mt-1">Empty = now</p>
                </div>
                <div>
                  <label className={labelCls} htmlFor="ann-end">Ends</label>
                  <input id="ann-end" type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} className={inputCls} />
                  <p className="text-[11px] text-slate-400 mt-1">Empty = until you end it</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className={labelCls}>Who sees it</p>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.owners_only} onChange={e => set('owners_only', e.target.checked)} />
                  Owners only <span className="text-xs text-slate-400">(otherwise everyone in the salon)</span>
                </label>
              </div>
              <div>
                <p className={labelCls}>Plans <span className="normal-case font-medium tracking-normal">(none selected = all)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {plans.map(p => (
                    <button key={p.id} type="button" onClick={() => set('plan_ids', toggle(form.plan_ids, p.id))} aria-pressed={form.plan_ids.includes(p.id)}
                      className={`text-xs rounded-full px-3 py-1 border ${form.plan_ids.includes(p.id) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={labelCls}>Countries <span className="normal-case font-medium tracking-normal">(none selected = all)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {countries.map(c => (
                    <button key={c} type="button" onClick={() => set('countries', toggle(form.countries, c))} aria-pressed={form.countries.includes(c)}
                      className={`text-xs rounded-full px-3 py-1 border ${form.countries.includes(c) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
                      {countryLabel(c)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={labelCls}>Specific salons <span className="normal-case font-medium tracking-normal">(none = all)</span></p>
                {form.tenant_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.tenant_ids.map(id => (
                      <span key={id} className="flex items-center gap-1 text-xs rounded-full px-2.5 py-1 bg-indigo-50 text-indigo-700">
                        {tenantName(id)}
                        <button type="button" onClick={() => set('tenant_ids', form.tenant_ids.filter(x => x !== id))} aria-label={`Remove ${tenantName(id)}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={salonSearch} onChange={e => setSalonSearch(e.target.value)} placeholder="Add a salon..." aria-label="Search salons"
                    className={`${inputCls} pl-8`} />
                </div>
                {salonMatches.length > 0 && (
                  <div className="mt-1 rounded-xl border border-slate-200 divide-y divide-slate-50">
                    {salonMatches.map(t => (
                      <button key={t.id} type="button" onClick={() => { set('tenant_ids', [...form.tenant_ids, t.id]); setSalonSearch(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">{t.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-sm text-slate-700" data-testid="reach">
                {reach ? <>Reaches <b>{reach.salons}</b> salon{reach.salons === 1 ? '' : 's'}, <b>{reach.people}</b> {reach.people === 1 ? 'person' : 'people'}.</> : 'Counting...'}
                {reach?.salons === 0 && <span className="block text-xs text-amber-700">No salon matches every filter.</span>}
              </p>

              <div>
                <p className={labelCls}>Preview</p>
                <div className="rounded-2xl bg-slate-100 p-4 flex justify-center">
                  <div className={`w-full max-w-md rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 ${PREVIEW[form.level].box}`}>
                    <PreviewIcon size={18} className={`shrink-0 mt-0.5 ${PREVIEW[form.level].icon}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{form.title.trim() || 'Title'}</p>
                      {form.body.trim() && <p className="text-xs mt-0.5 whitespace-pre-line opacity-90 break-words">{form.body.trim()}</p>}
                      {previewLink && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold underline mt-1.5">
                          {form.link_label.trim() || 'Ver más'} <ExternalLink size={12} />
                        </span>
                      )}
                    </div>
                    {form.level === 'critical' ? <span className="text-xs opacity-80">▲</span> : <X size={16} className="shrink-0 opacity-80" />}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {formError && <p className="text-sm text-rose-600">{formError}</p>}
          {saved && <p className="text-sm text-emerald-600">{saved}</p>}
          <div className="flex justify-end">
            <button onClick={submit} disabled={saving || !form.title.trim() || reach?.salons === 0}
              className="rounded-full bg-indigo-600 text-white font-black text-sm px-5 py-2 disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Save changes' : startsLater ? 'Schedule' : 'Publish now'}
            </button>
          </div>
        </div>

        {/* ── Lista ── */}
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[11px] font-black text-slate-400 uppercase tracking-wider">Announcements</p>
          <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-600 disabled:opacity-50" aria-label="Refresh announcements">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {listError && <p className="text-sm text-rose-600">{listError}</p>}
        {items && items.length === 0 && <p className="text-sm text-slate-400">No announcements yet.</p>}

        {items && groups.map(status => {
          const group = items.filter(a => a.status === status);
          if (!group.length) return null;
          return (
            <section key={status} className="space-y-2">
              <p className="text-xs font-bold text-slate-500">{STATUS_LABEL[status]} · {group.length}</p>
              {group.map(a => (
                <div key={a.id} data-announcement={a.id} className={`bg-white rounded-2xl border border-slate-200 p-4 ${status === 'ended' ? 'opacity-70' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-bold text-slate-800">
                        <span className={`mr-2 text-[10px] font-bold rounded-full px-2 py-0.5 ${LEVEL_BADGE[a.level]}`}>{LEVEL_LABEL[a.level]}</span>
                        {a.title}
                      </p>
                      {a.body && <p className="text-xs text-slate-600 whitespace-pre-line line-clamp-3">{a.body}</p>}
                      <p className="text-xs text-slate-500">{audienceText(a)}</p>
                      <p className="text-[11px] text-slate-400">
                        {status === 'scheduled' ? 'Starts' : 'Started'} {formatDate(a.starts_at)}
                        {a.ended_at ? ` · ended ${formatDate(a.ended_at)} by ${a.ended_by_email}` : a.ends_at ? ` · ends ${formatDate(a.ends_at)}` : ''}
                        {` · by ${a.created_by_email}`}
                      </p>
                      {status !== 'scheduled' && (
                        <p className="text-xs text-slate-600">Seen by <b>{a.seen}</b> · closed by <b>{a.dismissed}</b></p>
                      )}
                    </div>
                    {status !== 'ended' && (
                      <div className="flex flex-col items-end gap-1.5">
                        {status === 'scheduled' && (
                          <button onClick={() => edit(a)} className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50">Edit</button>
                        )}
                        {confirmEnd === a.id ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setConfirmEnd(null)} className="text-xs rounded-full border border-slate-200 px-3 py-1 text-slate-600">Keep</button>
                            <button onClick={() => end(a)} disabled={ending === a.id}
                              className="text-xs rounded-full bg-rose-600 text-white font-black px-3 py-1 disabled:opacity-50">
                              {status === 'live' ? 'End now' : 'Cancel it'}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmEnd(a.id)} className="text-xs rounded-full border border-rose-200 px-3 py-1 text-rose-600 hover:bg-rose-50">
                            {status === 'live' ? 'End' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
