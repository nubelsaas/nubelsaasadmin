'use client';
import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileText, Check, X, Loader2, ChevronDown, ChevronUp,
  Tag, Scissors, Package, Users, RotateCcw, AlertTriangle,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

type SectionId = 'categories' | 'services' | 'inventory' | 'clients';

interface SectionState {
  file: File | null;
  csvData: { headers: string[]; rows: string[][] } | null;
  mapping: Record<string, string>;
  status: 'idle' | 'ready' | 'importing' | 'done' | 'error';
  importCount: number;
  error: string | null;
}

// ── Field definitions ──────────────────────────────────────────────────────────

const CATEGORY_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, aliases: ['nombre', 'name', 'categoria', 'category'] },
  { key: 'type', label: 'Type (service/retail/supply/back_bar)', required: true, aliases: ['tipo', 'type'] },
];

const SERVICE_FIELDS: FieldDef[] = [
  { key: 'name',          label: 'Name',         required: true, aliases: ['nombre', 'name', 'servicio', 'service'] },
  { key: 'category_name', label: 'Category',                     aliases: ['categoria', 'category', 'category_name'] },
  { key: 'price',         label: 'Price',                        aliases: ['precio', 'price', 'valor', 'value'] },
  { key: 'cost_price',    label: 'Cost',                         aliases: ['costo', 'cost', 'cost_price', 'precio_costo'] },
  { key: 'sku',           label: 'SKU',                          aliases: ['sku', 'codigo', 'code'] },
  { key: 'tax_pct',       label: 'Tax %',                        aliases: ['iva', 'tax', 'impuesto', 'tax_pct'] },
];

const INVENTORY_FIELDS: FieldDef[] = [
  { key: 'name',           label: 'Name',                          required: true, aliases: ['nombre', 'name', 'producto', 'product'] },
  { key: 'type',           label: 'Type (retail/supply/back_bar)', required: true, aliases: ['tipo', 'type'] },
  { key: 'category_name',  label: 'Category',                                      aliases: ['categoria', 'category', 'category_name'] },
  { key: 'price',          label: 'Price',                                         aliases: ['precio', 'price', 'valor'] },
  { key: 'cost_price',     label: 'Cost',                                          aliases: ['costo', 'cost', 'cost_price'] },
  { key: 'sku',            label: 'SKU',                                           aliases: ['sku', 'codigo', 'code'] },
  { key: 'brand',          label: 'Brand',                                         aliases: ['marca', 'brand'] },
  { key: 'expected_yield', label: 'Expected yield',                                aliases: ['rendimiento', 'yield', 'expected_yield'] },
];

const CLIENT_FIELDS: FieldDef[] = [
  { key: 'first_name',         label: 'First name',       required: true, aliases: ['nombre', 'first_name', 'primer_nombre', 'name'] },
  { key: 'last_name',          label: 'Last name',                        aliases: ['apellido', 'last_name', 'primer_apellido'] },
  { key: 'phone',              label: 'Phone',                            aliases: ['telefono', 'phone', 'celular', 'movil'] },
  { key: 'email',              label: 'Email',                            aliases: ['email', 'correo', 'mail'] },
  { key: 'document_type',      label: 'Document type',                    aliases: ['tipo_doc', 'document_type', 'tipo_documento'] },
  { key: 'document_number',    label: 'Document number',                  aliases: ['cedula', 'documento', 'document_number', 'numero_documento'] },
  { key: 'birthday',           label: 'Birthday',                         aliases: ['cumpleanos', 'birthday', 'fecha_nacimiento', 'nacimiento'] },
  { key: 'address',            label: 'Address',                          aliases: ['direccion', 'address'] },
  { key: 'instagram_user',     label: 'Instagram',                        aliases: ['instagram', 'instagram_user', 'ig'] },
  { key: 'acquisition_source', label: 'How they found us',                aliases: ['fuente', 'acquisition_source', 'como_nos_conocio', 'referido'] },
];

const SECTION_CONFIGS = [
  { id: 'categories' as SectionId, step: 1, label: 'Categories',  description: 'Service & inventory categories',  icon: <Tag size={18} />,     fields: CATEGORY_FIELDS },
  { id: 'services'   as SectionId, step: 2, label: 'Services',    description: 'Service catalog',                 icon: <Scissors size={18} />, fields: SERVICE_FIELDS   },
  { id: 'inventory'  as SectionId, step: 3, label: 'Inventory',   description: 'Products, supplies & back bar',   icon: <Package size={18} />,  fields: INVENTORY_FIELDS },
  { id: 'clients'    as SectionId, step: 4, label: 'Clients',     description: 'Existing customer base',          icon: <Users size={18} />,    fields: CLIENT_FIELDS    },
];

const INITIAL_SECTION: SectionState = {
  file: null, csvData: null, mapping: {}, status: 'idle', importCount: 0, error: null,
};

// ── CSV parser (no external library) ─────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (!lines.length) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let inQuote = false;
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if ((ch === ',' || ch === ';') && !inQuote) {
        result.push(current.trim()); current = '';
      } else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const r = parseRow(line);
    while (r.length < headers.length) r.push('');
    return r;
  });
  return { headers, rows };
}

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function autoMatch(headers: string[], fields: FieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const norm = normalize(header);
    for (const field of fields) {
      if (!used.has(field.key) && field.aliases.includes(norm)) {
        mapping[header] = field.key;
        used.add(field.key);
        break;
      }
    }
  }
  return mapping;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DropZone({ onFile, file }: { onFile: (f: File) => void; file: File | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.csv')) onFile(f);
  }, [onFile]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
        dragging ? 'border-indigo-400 bg-indigo-50' :
        file     ? 'border-emerald-300 bg-emerald-50' :
                   'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-slate-100'
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ''; }} />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-emerald-700">
          <FileText size={18} /><span className="font-bold text-sm">{file.name}</span>
        </div>
      ) : (
        <div className="text-slate-400">
          <Upload size={22} className="mx-auto mb-1.5" />
          <p className="text-sm font-bold">Drag your CSV here or click to select</p>
          <p className="text-[11px] mt-0.5">Comma or semicolon separated · UTF-8</p>
        </div>
      )}
    </div>
  );
}

function ColumnMapper({ headers, fields, mapping, onChange }: {
  headers: string[];
  fields: FieldDef[];
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Column mapping</p>
      {headers.map(header => (
        <div key={header} className="flex items-center gap-2">
          <span className="w-36 text-xs font-bold text-slate-500 truncate bg-slate-100 px-2.5 py-1.5 rounded-lg shrink-0" title={header}>
            {header}
          </span>
          <span className="text-slate-300 text-xs shrink-0">→</span>
          <select
            value={mapping[header] || ''}
            onChange={e => onChange({ ...mapping, [header]: e.target.value })}
            className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700 min-w-0"
          >
            <option value="">— Ignore —</option>
            {fields.map(f => (
              <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({ headers, rows, mapping, fields }: {
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
  fields: FieldDef[];
}) {
  const mappedHeaders = headers.filter(h => mapping[h]);
  if (!mappedHeaders.length) return null;

  return (
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
        Preview ({rows.length} rows · showing first 5)
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {mappedHeaders.map(h => {
                const field = fields.find(f => f.key === mapping[h]);
                return (
                  <th key={h} className="px-3 py-2 text-left font-bold text-slate-600 whitespace-nowrap">
                    {field?.label || h}{field?.required && <span className="text-rose-400 ml-0.5">*</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                {mappedHeaders.map(h => {
                  const idx = headers.indexOf(h);
                  return <td key={h} className="px-3 py-2 text-slate-700 max-w-[160px] truncate">{row[idx] || '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ImportSections({ tenantId }: { tenantId: string }) {
  const [sections, setSections] = useState<Record<SectionId, SectionState>>({
    categories: { ...INITIAL_SECTION },
    services:   { ...INITIAL_SECTION },
    inventory:  { ...INITIAL_SECTION },
    clients:    { ...INITIAL_SECTION },
  });
  const [openSection, setOpenSection] = useState<SectionId | null>('categories');

  const updateSection = (id: SectionId, patch: Partial<SectionState>) =>
    setSections(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleFile = useCallback((sectionId: SectionId, fields: FieldDef[], file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const csvData = parseCSV(e.target?.result as string);
      const mapping = autoMatch(csvData.headers, fields);
      updateSection(sectionId, { file, csvData, mapping, status: 'ready', error: null, importCount: 0 });
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleImport = async (sectionId: SectionId) => {
    const state = sections[sectionId];
    if (!state.csvData) return;

    const missingRequired = SECTION_CONFIGS
      .find(s => s.id === sectionId)!.fields
      .filter(f => f.required && !Object.values(state.mapping).includes(f.key))
      .map(f => f.label);

    if (missingRequired.length > 0) {
      updateSection(sectionId, { error: `Required fields not mapped: ${missingRequired.join(', ')}`, status: 'error' });
      return;
    }

    updateSection(sectionId, { status: 'importing', error: null });

    const { headers, rows } = state.csvData;
    const { mapping } = state;
    const get = (row: string[], key: string): string => {
      const header = Object.entries(mapping).find(([, v]) => v === key)?.[0];
      if (!header) return '';
      const idx = headers.indexOf(header);
      return idx >= 0 ? (row[idx] || '').trim() : '';
    };
    const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;

    try {
      let records: Record<string, unknown>[] = [];

      if (sectionId === 'categories') {
        records = rows.filter(r => get(r, 'name')).map(r => ({
          name: get(r, 'name'), type: get(r, 'type') || 'service',
        }));
      } else if (sectionId === 'services') {
        records = rows.filter(r => get(r, 'name')).map(r => ({
          name: get(r, 'name'), type: 'service',
          category_name: get(r, 'category_name') || null,
          price: num(get(r, 'price')), cost_price: num(get(r, 'cost_price')),
          sku: get(r, 'sku') || null, tax_pct: num(get(r, 'tax_pct')),
          is_active: true,
        }));
      } else if (sectionId === 'inventory') {
        const validTypes = new Set(['retail', 'supply', 'back_bar']);
        records = rows.filter(r => get(r, 'name') && validTypes.has(get(r, 'type'))).map(r => ({
          name: get(r, 'name'), type: get(r, 'type'),
          category_name: get(r, 'category_name') || null,
          price: num(get(r, 'price')), cost_price: num(get(r, 'cost_price')),
          sku: get(r, 'sku') || null, brand: get(r, 'brand') || null,
          expected_yield: parseInt(get(r, 'expected_yield')) || 1,
          is_active: true,
        }));
      } else if (sectionId === 'clients') {
        records = rows.filter(r => get(r, 'first_name')).map(r => ({
          first_name: get(r, 'first_name'), last_name: get(r, 'last_name') || null,
          phone: get(r, 'phone') || null, email: get(r, 'email') || null,
          document_type: get(r, 'document_type') || null, document_number: get(r, 'document_number') || null,
          birthday: get(r, 'birthday') || null, address: get(r, 'address') || null,
          instagram_user: get(r, 'instagram_user') || null, acquisition_source: get(r, 'acquisition_source') || null,
          is_active: true,
        }));
      }

      if (!records.length) {
        updateSection(sectionId, { error: 'No valid records found. Check required fields.', status: 'error' });
        return;
      }

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, entity: sectionId, records }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed');
      updateSection(sectionId, { status: 'done', importCount: json.count });
    } catch (err: unknown) {
      updateSection(sectionId, { status: 'error', error: err instanceof Error ? err.message : 'Import failed' });
    }
  };

  function statusBadge(state: SectionState) {
    if (state.status === 'done')      return <span className="flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full"><Check size={11} /> {state.importCount} imported</span>;
    if (state.status === 'error')     return <span className="flex items-center gap-1 text-[10px] font-black text-rose-500 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full"><X size={11} /> Error</span>;
    if (state.status === 'importing') return <span className="flex items-center gap-1 text-[10px] font-black text-indigo-500 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full"><Loader2 size={11} className="animate-spin" /> Importing…</span>;
    if (state.file)                   return <span className="flex items-center gap-1 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full"><FileText size={11} /> Ready</span>;
    return <span className="text-[10px] font-black text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">Pending</span>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4">
        <p className="font-black text-indigo-800 text-sm mb-1">Import order matters</p>
        <p className="text-xs text-indigo-600">
          Import in the order shown: Categories first, then Services and Inventory (which reference categories), then Clients.
        </p>
      </div>

      {SECTION_CONFIGS.map(section => {
        const state = sections[section.id];
        const isOpen = openSection === section.id;
        const canImport = state.status === 'ready' || state.status === 'error';

        return (
          <div key={section.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setOpenSection(isOpen ? null : section.id)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left">
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-black shrink-0">
                {section.step}
              </div>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                state.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'
              }`}>
                {state.status === 'done' ? <Check size={16} /> : section.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-slate-800">{section.label}</p>
                <p className="text-[11px] text-slate-400">{section.description}</p>
              </div>
              {statusBadge(state)}
              <div className="text-slate-400 shrink-0 ml-1">
                {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {isOpen && (
              <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
                {/* Field badges */}
                <div className="flex flex-wrap gap-1.5">
                  {section.fields.map(f => (
                    <span key={f.key} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      f.required ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>
                      {f.label}{f.required ? ' *' : ''}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400"><span className="text-rose-500 font-bold">*</span> required field</p>

                <DropZone file={state.file} onFile={f => handleFile(section.id, section.fields, f)} />

                {state.csvData && (
                  <>
                    <ColumnMapper headers={state.csvData.headers} fields={section.fields}
                      mapping={state.mapping} onChange={m => updateSection(section.id, { mapping: m })} />
                    <PreviewTable headers={state.csvData.headers} rows={state.csvData.rows}
                      mapping={state.mapping} fields={section.fields} />
                  </>
                )}

                {state.error && (
                  <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                    <AlertTriangle size={15} className="text-rose-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-rose-700 font-bold">{state.error}</p>
                  </div>
                )}

                {state.status === 'done' && (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Check size={15} className="text-emerald-600" />
                      <p className="text-xs font-black text-emerald-700">{state.importCount} records imported successfully</p>
                    </div>
                    <button type="button" onClick={() => updateSection(section.id, { ...INITIAL_SECTION })}
                      className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-600 transition-colors">
                      <RotateCcw size={11} /> Re-import
                    </button>
                  </div>
                )}

                {canImport && state.csvData && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => handleImport(section.id)}
                      disabled={state.status === 'importing'}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-full font-black text-sm disabled:opacity-50">
                      {state.status === 'importing'
                        ? <><Loader2 size={15} className="animate-spin" /> Importing…</>
                        : <><Upload size={15} /> Import {state.csvData.rows.length} records</>}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
