// Entorno al que apunta el portal (docs/features/entornos.md).
// Lo fija NEXT_PUBLIC_NUBEL_ENV en el archivo .env cargado: .env.local → prod, .env.dev.local → dev.
// La referencia del proyecto sale de la URL de Supabase, para que la franja muestre la base real.

export type NubelEnv = 'prod' | 'dev' | 'unknown';

export function getNubelEnv(): { env: NubelEnv; projectRef: string } {
  const raw = process.env.NEXT_PUBLIC_NUBEL_ENV;
  const env: NubelEnv = raw === 'prod' || raw === 'dev' ? raw : 'unknown';
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./i)?.[1] ?? '?';
  return { env, projectRef };
}
