#!/usr/bin/env node
// Corre un comando con las variables de un archivo .env cargadas ANTES que .env.local.
//
//   node scripts/with-env.mjs .env.dev.local next dev -p 3003
//
// Next (@next/env) no pisa variables que ya vienen en process.env, así que las del archivo
// indicado ganan sobre .env.local. Ver docs/features/entornos.md.
//
// Guardas (abortan antes de arrancar):
//   - El archivo debe existir y definir NEXT_PUBLIC_NUBEL_ENV y NEXT_PUBLIC_SUPABASE_URL.
//   - Si NEXT_PUBLIC_NUBEL_ENV no es "prod", su Supabase debe ser distinto al de .env.local
//     (evita creer que se está en DEV cuando en realidad se escribe en PROD).
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [envFile, ...command] = process.argv.slice(2);
if (!envFile || command.length === 0) {
  console.error('Uso: node scripts/with-env.mjs <archivo.env> <comando> [args...]');
  process.exit(1);
}

function parseEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const envPath = resolve(envFile);
if (!existsSync(envPath)) {
  console.error(`[with-env] No existe ${envFile}. Copia .env.example y completa los valores del entorno.`);
  process.exit(1);
}

const vars = parseEnv(envPath);
const target = vars.NEXT_PUBLIC_NUBEL_ENV;
if (!target || !vars.NEXT_PUBLIC_SUPABASE_URL) {
  console.error(`[with-env] ${envFile} debe definir NEXT_PUBLIC_NUBEL_ENV y NEXT_PUBLIC_SUPABASE_URL.`);
  process.exit(1);
}

const prodPath = resolve('.env.local');
if (target !== 'prod' && existsSync(prodPath)) {
  const prodUrl = parseEnv(prodPath).NEXT_PUBLIC_SUPABASE_URL;
  if (prodUrl && prodUrl === vars.NEXT_PUBLIC_SUPABASE_URL) {
    console.error(`[with-env] ${envFile} dice "${target}" pero apunta al mismo Supabase que .env.local (${prodUrl}). Aborto.`);
    process.exit(1);
  }
}

const ref = vars.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./i)?.[1] ?? '?';
console.log(`[with-env] Entorno ${target.toUpperCase()} · Supabase ${ref}`);

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...vars },
});
child.on('exit', code => process.exit(code ?? 1));
