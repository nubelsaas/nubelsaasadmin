// Resuelve "@/x" y rutas relativas sin extensión como lo hace Next, solo para scripts de prueba.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith('@/')) base = resolvePath(ROOT, specifier.slice(2));
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && context.parentURL.endsWith('.ts')) {
      base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (existsSync(candidate) && !candidate.endsWith('/') ) {
          try { return nextResolve(pathToFileURL(candidate).href, context); } catch { /* sigue */ }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
