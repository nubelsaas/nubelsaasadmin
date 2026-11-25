// Lee la estructura de una base para la página Schema y para scripts/schema-diff.mjs.
// Solo fetch, sin dependencias del portal: el script lo importa tal cual con node.
// Primero admin_schema_snapshot() (catálogo completo); si no existe todavía en esa base, lo que
// publica la API REST (tablas, columnas y funciones expuestas).
import type { SchemaSnapshot } from './schemaDiff.ts';

export type SnapshotTarget = { url: string; serviceKey: string; env: string };

export function projectRef(url: string): string {
  return url.match(/https:\/\/([a-z0-9]+)\./i)?.[1] ?? '?';
}

export async function loadSnapshot({ url, serviceKey, env }: SnapshotTarget): Promise<SchemaSnapshot> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const base = { env, project: projectRef(url) };

  const rpc = await fetch(`${url}/rest/v1/rpc/admin_schema_snapshot`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store',
  });
  if (rpc.ok) {
    const s = await rpc.json();
    return { source: 'catalog', ...base, ...s };
  }
  const body = await rpc.json().catch(() => null);
  // PGRST202 = la función no existe en esta base. Cualquier otro error se informa.
  if (body?.code !== 'PGRST202') throw new Error(`admin_schema_snapshot: ${body?.message ?? rpc.status}`);

  const res = await fetch(`${url}/rest/v1/`, { headers: { ...headers, Accept: 'application/openapi+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read the REST API schema (${res.status})`);
  const api = await res.json() as {
    definitions?: Record<string, { properties?: Record<string, { format?: string; type?: string }>; required?: string[] }>;
    paths?: Record<string, unknown>;
  };
  const tables: SchemaSnapshot['tables'] = {};
  for (const [name, def] of Object.entries(api.definitions ?? {})) {
    tables[name] = {
      rls: null,
      columns: Object.entries(def.properties ?? {}).map(([col, p]) => ({
        name: col, type: p.format ?? p.type ?? '?', nullable: !(def.required ?? []).includes(col), default: null,
      })),
    };
  }
  const functions = Object.keys(api.paths ?? {})
    .filter(p => p.startsWith('/rpc/'))
    .map(p => ({ name: p.slice(5), args: '', returns: '', security_definer: false, hash: '' }));

  return {
    source: 'api', ...base, generated_at: new Date().toISOString(),
    tables, views: [], functions, triggers: [], policies: [], indexes: [], enums: {}, extensions: {},
  };
}
