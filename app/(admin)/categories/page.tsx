'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Check, X, Tag } from 'lucide-react';
import AdminHeader from '@/components/layout/AdminHeader';

type Category = { id: string; name: string; type: string; is_active: boolean; code: string | null };

const TYPES = [
  { value: 'COGS',          label: 'Costo Directo',  color: 'bg-rose-100 text-rose-700 border-rose-200'   },
  { value: 'OPEX Fijo',     label: 'Gasto Fijo',     color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'OPEX Variable', label: 'Gasto Variable', color: 'bg-blue-100 text-blue-700 border-blue-200'   },
  { value: 'No Operacional',label: 'No Operacional', color: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const SYSTEM_CODES = [
  { code: 'GATEWAY_FEE',     label: 'GATEWAY_FEE',     desc: 'Comisiones de pasarela de pago (auto-liquidadas)' },
  { code: 'PAYROLL_ADVANCE', label: 'PAYROLL_ADVANCE',  desc: 'Anticipos de nómina en efectivo'                  },
  { code: 'PAY_SALARIES',    label: 'PAY_SALARIES',     desc: 'Pago de nómina al marcar periodo como pagado'      },
  { code: 'MARKETING',       label: 'MARKETING',        desc: 'Inversión en marketing/publicidad — única base del CAC (no auto-genera gastos)' },
];

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [newName, setNewName]       = useState('');
  const [newType, setNewType]       = useState('COGS');
  const [creating, setCreating]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editName, setEditName]     = useState('');
  const [saving, setSaving]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/categories/expense');
    setCategories(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    await fetch('/api/categories/expense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, type: newType }),
    });
    setNewName(''); setNewType('COGS'); setShowForm(false);
    setCreating(false);
    load();
  }

  async function handleToggleActive(cat: Category) {
    setSaving(cat.id);
    await fetch(`/api/categories/expense/${cat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !cat.is_active }),
    });
    setSaving(null);
    load();
  }

  async function handleSaveName(cat: Category) {
    if (!editName.trim() || editName.trim() === cat.name) { setEditingId(null); return; }
    setSaving(cat.id);
    await fetch(`/api/categories/expense/${cat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setSaving(null); setEditingId(null);
    load();
  }

  async function handleCodeChange(cat: Category, code: string) {
    setSaving(cat.id);
    await fetch(`/api/categories/expense/${cat.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code || null }),
    });
    setSaving(null);
    load();
  }

  const assignedCodes = new Set(categories.map(c => c.code).filter(Boolean));

  return (
    <>
      <AdminHeader title="Expense Categories" />
      <div className="p-4 md:p-8 space-y-6 max-w-3xl">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Global categories shared across all tenants.
          </p>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-full bg-indigo-600 text-white font-black px-4 py-2 text-sm">
              <Plus size={15} /> New category
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 p-5 flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Name <span className="text-rose-500">*</span></label>
              <input autoFocus required value={newName} onChange={e => setNewName(e.target.value)}
                className={inputCls} placeholder="Arriendo local" />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-slate-500 mb-1">Type <span className="text-rose-500">*</span></label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className={inputCls}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <button type="submit" disabled={creating || !newName.trim()}
              className="rounded-full bg-indigo-600 text-white font-black px-4 py-2 text-sm disabled:opacity-50">
              {creating ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setNewName(''); }}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-500">
              Cancel
            </button>
          </form>
        )}

        {/* Categories grouped by type */}
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-12">Loading…</p>
        ) : (
          <div className="space-y-5">
            {TYPES.map(({ value: type, label, color }) => {
              const group = categories.filter(c => c.type === type);
              if (!group.length) return null;
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-black border rounded-full px-2 py-0.5 ${color}`}>{label}</span>
                    <span className="text-xs text-slate-400">{group.length}</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                    {group.map(cat => (
                      <div key={cat.id} className={`flex items-center gap-3 px-4 py-3 ${!cat.is_active ? 'opacity-50' : ''}`}>
                        {/* Name / edit */}
                        <div className="flex-1 min-w-0">
                          {editingId === cat.id ? (
                            <div className="flex items-center gap-2">
                              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(cat); if (e.key === 'Escape') setEditingId(null); }}
                                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                              <button onClick={() => handleSaveName(cat)} className="text-emerald-600 hover:text-emerald-700"><Check size={15} /></button>
                              <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-slate-800 truncate">{cat.name}</p>
                              <button onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                                className="text-slate-300 hover:text-slate-500 flex-shrink-0"><Pencil size={12} /></button>
                            </div>
                          )}
                        </div>

                        {/* System code selector */}
                        <select
                          value={cat.code ?? ''}
                          onChange={e => handleCodeChange(cat, e.target.value)}
                          disabled={saving === cat.id}
                          className="text-xs rounded-lg border border-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-600 disabled:opacity-50">
                          <option value="">— no code —</option>
                          {SYSTEM_CODES.map(sc => (
                            <option key={sc.code} value={sc.code}
                              disabled={assignedCodes.has(sc.code) && cat.code !== sc.code}>
                              {sc.label}
                            </option>
                          ))}
                        </select>

                        {/* Active toggle */}
                        <button onClick={() => handleToggleActive(cat)} disabled={saving === cat.id}
                          className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors disabled:opacity-50 ${
                            cat.is_active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
                          }`}>
                          {cat.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* System codes reference */}
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-3">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Tag size={12} /> System Codes
          </p>
          <div className="space-y-2">
            {SYSTEM_CODES.map(sc => (
              <div key={sc.code} className="flex items-start gap-3">
                <code className="text-[11px] font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-indigo-600 flex-shrink-0 mt-0.5">
                  {sc.code}
                </code>
                <p className="text-xs text-slate-500">{sc.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            Each code can be assigned to only one category. The COGS codes (GATEWAY_FEE, PAYROLL_ADVANCE, PAY_SALARIES) auto-create expense records; MARKETING only classifies the marketing spend for the CAC metric. Unassigned codes are silently skipped.
          </p>
        </div>
      </div>
    </>
  );
}
