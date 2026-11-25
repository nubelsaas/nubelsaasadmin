// Compara la estructura de dos bases (sin filas) y lista las diferencias y lo que le falta al
// portal en cada una. Ver docs/features/schema.md.
//
//   node scripts/schema-diff.mjs                       # DEV (.env.dev.local) contra PROD (.env.local)
//   node scripts/schema-diff.mjs .env.dev.local otro.json   # contra un snapshot descargado de /schema
//   node scripts/schema-diff.mjs --save snapshot.json  # además guarda los dos snapshots
//
// Cada lado es un archivo .env (usa NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY; solo
// llama a admin_schema_snapshot() o lee el esquema de la API: no escribe nada) o un .json
// descargado de la página Schema. Las claves nunca se imprimen.
import { readFileSync, writeFileSync } from 'node:fs';
import { CATEGORY_LABEL, checkRequirements, diffSnapshots, parseSnapshot } from '../lib/schemaDiff.ts';
import { loadSnapshot } from '../lib/schemaSnapshot.ts';

const args = process.argv.slice(2);
const saveAt = args.indexOf('--save');
const save = saveAt >= 0 ? args.splice(saveAt, 2)[1] : null;
const [a = '.env.dev.local', b = '.env.local'] = args;

function readEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return vars;
}

async function load(path) {
  if (path.endsWith('.json')) {
    const s = parseSnapshot(readFileSync(path, 'utf8'));
    if (!s) throw new Error(`${path} is not a schema snapshot`);
    return s;
  }
  const env = readEnv(path);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(`${path} has no Supabase URL or service key`);
  return loadSnapshot({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, env: env.NEXT_PUBLIC_NUBEL_ENV ?? path });
}

const [here, there] = await Promise.all([load(a), load(b)]);
const name = s => `${s.env.toUpperCase()} (${s.project})`;
if (save) writeFileSync(save, JSON.stringify({ [here.env]: here, [there.env]: there }, null, 2));

console.log(`\nSchema: ${name(here)} vs ${name(there)}`);
for (const s of [here, there]) {
  if (s.source !== 'catalog') console.log(`  ! ${name(s)} has no admin_schema_snapshot(): only table, column and function names are compared.`);
}

const items = diffSnapshots(here, there);
const order = ['only_there', 'only_here', 'changed'];
const head = { only_there: `Only in ${name(there)}`, only_here: `Only in ${name(here)}`, changed: 'Different' };
for (const cat of Object.keys(CATEGORY_LABEL)) {
  const group = items.filter(i => i.category === cat);
  if (!group.length) continue;
  console.log(`\n${CATEGORY_LABEL[cat]} (${group.length})`);
  for (const kind of order) {
    const g = group.filter(i => i.kind === kind);
    if (!g.length) continue;
    console.log(`  ${head[kind]}:`);
    for (const i of g) console.log(`    - ${i.name}${i.detail ? `: ${i.detail}` : ''}`);
  }
}
if (!items.length) console.log('\nNo differences.');

for (const s of [here, there]) {
  const missing = checkRequirements(s).filter(r => !r.ok);
  console.log(`\nPortal readiness on ${name(s)}: ${missing.length ? `${missing.length} missing` : 'all present'}`);
  for (const r of missing) console.log(`  - ${r.name} (${r.kind}): ${r.breaks}. SQL: ${r.source}`);
}
console.log('');
