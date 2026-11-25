// Comparación de la estructura de dos bases (DEV y PROD) y chequeo de lo que el portal necesita.
// Sin dependencias: se prueba con node --test. La lectura está en lib/schemaSnapshot.ts.

export type Column = { name: string; type: string; nullable: boolean; default: string | null };
export type FunctionDef = { name: string; args: string; returns: string; security_definer: boolean; hash: string };
export type TriggerDef = { table: string; name: string; enabled: boolean; hash: string };
export type PolicyDef = { schema: string; table: string; name: string; cmd: string; permissive: string; hash: string };
export type IndexDef = { table: string; name: string; hash: string };

export type SchemaSnapshot = {
  /** 'catalog' = admin_schema_snapshot() (completo); 'api' = solo lo que publica la API REST. */
  source: 'catalog' | 'api';
  env: string;           // 'dev' | 'prod' | lo que diga NEXT_PUBLIC_NUBEL_ENV
  project: string;       // referencia del proyecto Supabase
  generated_at: string;
  tables: Record<string, { rls: boolean | null; columns: Column[] }>;
  views: string[];
  functions: FunctionDef[];
  triggers: TriggerDef[];
  policies: PolicyDef[];
  indexes: IndexDef[];
  enums: Record<string, string[]>;
  extensions: Record<string, string>;
};

export type DiffKind = 'only_here' | 'only_there' | 'changed';
export type DiffCategory = 'table' | 'column' | 'rls' | 'view' | 'function' | 'trigger' | 'policy' | 'index' | 'enum' | 'extension';
export type DiffItem = { category: DiffCategory; kind: DiffKind; name: string; detail?: string };

export const CATEGORY_LABEL: Record<DiffCategory, string> = {
  table: 'Tables', column: 'Columns', rls: 'RLS', view: 'Views', function: 'Functions', trigger: 'Triggers',
  policy: 'Policies', index: 'Indexes', enum: 'Enums', extension: 'Extensions',
};

/** Compara dos listas por clave: lo que falta de un lado y lo que difiere. */
function compareBy<T>(
  category: DiffCategory, here: T[], there: T[], key: (x: T) => string, same: (a: T, b: T) => string | null,
): DiffItem[] {
  const a = new Map(here.map(x => [key(x), x]));
  const b = new Map(there.map(x => [key(x), x]));
  const out: DiffItem[] = [];
  for (const [k, x] of Array.from(a)) {
    const y = b.get(k);
    if (!y) out.push({ category, kind: 'only_here', name: k });
    else {
      const why = same(x, y);
      if (why) out.push({ category, kind: 'changed', name: k, detail: why });
    }
  }
  for (const k of Array.from(b.keys())) if (!a.has(k)) out.push({ category, kind: 'only_there', name: k });
  return out;
}

const fnKey = (f: FunctionDef) => `${f.name}(${f.args})`;

/**
 * Diferencias de `here` respecto de `there`. Si alguno de los dos vino de la API (sin catálogo),
 * solo se comparan nombres de tablas, columnas y funciones: lo demás no se puede saber.
 */
export function diffSnapshots(here: SchemaSnapshot, there: SchemaSnapshot): DiffItem[] {
  const full = here.source === 'catalog' && there.source === 'catalog';
  const out: DiffItem[] = [];

  const tablesHere = Object.keys(here.tables);
  const tablesThere = Object.keys(there.tables);
  out.push(...compareBy('table', tablesHere, tablesThere, t => t, () => null));

  for (const t of tablesHere.filter(x => there.tables[x])) {
    const ta = here.tables[t], tb = there.tables[t];
    out.push(...compareBy('column', ta.columns, tb.columns, c => `${t}.${c.name}`, (x, y) => {
      // La API no da el tipo exacto ni si es NOT NULL: sin catálogo solo cuenta que exista.
      if (!full) return null;
      if (x.type !== y.type) return `type ${x.type} vs ${y.type}`;
      if (x.nullable !== y.nullable) return x.nullable ? 'nullable here, NOT NULL there' : 'NOT NULL here, nullable there';
      if (full && (x.default ?? '') !== (y.default ?? '')) return `default ${x.default ?? 'none'} vs ${y.default ?? 'none'}`;
      return null;
    }));
    if (full && ta.rls !== tb.rls) out.push({ category: 'rls', kind: 'changed', name: t, detail: ta.rls ? 'RLS on here, off there' : 'RLS off here, on there' });
  }

  if (full) {
    out.push(...compareBy('view', here.views, there.views, v => v, () => null));
    out.push(...compareBy('function', here.functions, there.functions, fnKey, (x, y) => {
      if (x.returns !== y.returns) return `returns ${x.returns} vs ${y.returns}`;
      if (x.security_definer !== y.security_definer) return x.security_definer ? 'SECURITY DEFINER here only' : 'SECURITY DEFINER there only';
      return x.hash !== y.hash ? 'body differs' : null;
    }));
    out.push(...compareBy('trigger', here.triggers, there.triggers, x => `${x.table}.${x.name}`, (x, y) =>
      x.hash !== y.hash ? 'definition differs' : x.enabled !== y.enabled ? (x.enabled ? 'enabled here, disabled there' : 'disabled here, enabled there') : null));
    out.push(...compareBy('policy', here.policies, there.policies, x => `${x.schema}.${x.table}: ${x.name}`, (x, y) =>
      x.hash !== y.hash || x.cmd !== y.cmd || x.permissive !== y.permissive ? 'definition differs' : null));
    out.push(...compareBy('index', here.indexes, there.indexes, x => `${x.table}.${x.name}`, (x, y) => (x.hash !== y.hash ? 'definition differs' : null)));
    out.push(...compareBy('enum', Object.keys(here.enums), Object.keys(there.enums), e => e, (e) => {
      const x = here.enums[e].join(','), y = there.enums[e].join(',');
      return x !== y ? `values ${x} vs ${y}` : null;
    }));
    out.push(...compareBy('extension', Object.keys(here.extensions), Object.keys(there.extensions), e => e, (e) =>
      here.extensions[e] !== there.extensions[e] ? `version ${here.extensions[e]} vs ${there.extensions[e]}` : null));
  } else {
    // Sin catálogo solo se saben los nombres de las funciones expuestas.
    const names = (s: SchemaSnapshot) => Array.from(new Set(s.functions.map(f => f.name)));
    out.push(...compareBy('function', names(here), names(there), f => f, () => null));
  }
  return out;
}

/** Conteo por categoría. Las columnas de una tabla que está de un solo lado no se listan: cuenta la tabla. */
export function summarize(items: DiffItem[]): Record<DiffCategory, { only_here: number; only_there: number; changed: number }> {
  const zero = () => ({ only_here: 0, only_there: 0, changed: 0 });
  const out = Object.fromEntries(Object.keys(CATEGORY_LABEL).map(k => [k, zero()])) as Record<DiffCategory, ReturnType<typeof zero>>;
  for (const i of items) out[i.category][i.kind]++;
  return out;
}

// ── Lo que necesita el portal ───────────────────────────────────────────────

export type Requirement = {
  kind: 'table' | 'column' | 'function';
  name: string;            // 'tabla', 'tabla.columna' o 'funcion'
  /** Qué deja de funcionar si falta. */
  breaks: string;
  /** Dónde está el SQL que lo crea. */
  source: string;
};

const PORTAL = 'nubelsaasadmin supabase/migrations';
const APP = 'nubelsaas docs/database';

export const PORTAL_REQUIREMENTS: Requirement[] = [
  { kind: 'table', name: 'admin_superadmins', breaks: 'Nobody can sign in to the portal', source: `${PORTAL}/20260528_superadmins.sql` },
  { kind: 'table', name: 'admin_audit_logs', breaks: 'Every portal write fails (the audit log is written first)', source: `${PORTAL}/20261031_admin_audit_logs.sql` },
  { kind: 'column', name: 'tenants.suspended_at', breaks: 'Tenant list, detail and suspension fail', source: `${APP}/tenants_integrity.sql (20261101130000_tenant_suspension)` },
  { kind: 'column', name: 'tenants.plan_id', breaks: 'Plans, flags and health', source: 'main app schema' },
  { kind: 'table', name: 'subscription_plans', breaks: 'Plans, flags and health', source: 'main app schema' },
  { kind: 'table', name: 'admin_impersonation_sessions', breaks: 'Opening a support session fails', source: `${APP}/audit_impersonation.sql` },
  { kind: 'column', name: 'admin_impersonation_sessions.ended_at', breaks: 'Support session list and End fail', source: `${APP}/audit_impersonation.sql (20261125113409)` },
  { kind: 'function', name: 'admin_cap_support_session', breaks: 'Opening a support session fails (the 60-minute cap is required)', source: `${APP}/audit_impersonation.sql (20261125113409)` },
  { kind: 'function', name: 'admin_end_support_session', breaks: 'End on a support session fails', source: `${APP}/audit_impersonation.sql (20261125113409)` },
  { kind: 'function', name: 'admin_support_session_status', breaks: 'Support session list fails', source: `${APP}/audit_impersonation.sql (20261125113409)` },
  { kind: 'column', name: 'audit_log.impersonated_by', breaks: 'Actions in a support session are not marked as support', source: `${APP}/audit_impersonation.sql` },
  { kind: 'table', name: 'admin_tenant_notes', breaks: 'Internal notes card shows an error', source: `${PORTAL}/20261125_admin_tenant_notes.sql` },
  { kind: 'table', name: 'admin_announcements', breaks: 'Announcements page fails', source: `${APP}/announcements.sql` },
  { kind: 'table', name: 'admin_announcement_receipts', breaks: 'Announcement counts fail', source: `${APP}/announcements.sql` },
  { kind: 'function', name: 'get_my_announcements', breaks: 'Salons never see announcements (app side)', source: `${APP}/announcements.sql` },
  { kind: 'function', name: 'admin_schema_snapshot', breaks: 'This page only sees tables and columns', source: `${PORTAL}/20261125_admin_schema_snapshot.sql` },
];

export function checkRequirements(s: SchemaSnapshot, reqs = PORTAL_REQUIREMENTS): (Requirement & { ok: boolean })[] {
  const fns = new Set(s.functions.map(f => f.name));
  return reqs.map(r => {
    if (r.kind === 'table') return { ...r, ok: Boolean(s.tables[r.name]) };
    if (r.kind === 'function') return { ...r, ok: fns.has(r.name) };
    const [table, column] = r.name.split('.');
    return { ...r, ok: Boolean(s.tables[table]?.columns.some(c => c.name === column)) };
  });
}

/** Un archivo subido: valida la forma mínima antes de comparar. */
export function parseSnapshot(text: string): SchemaSnapshot | null {
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object' || typeof s.tables !== 'object' || !Array.isArray(s.functions)) return null;
    if (s.source !== 'catalog' && s.source !== 'api') return null;
    return {
      views: [], triggers: [], policies: [], indexes: [], enums: {}, extensions: {}, env: 'unknown', project: 'unknown', generated_at: '',
      ...s,
    };
  } catch {
    return null;
  }
}
