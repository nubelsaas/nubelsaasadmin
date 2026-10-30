# Entornos: PROD y DEV

El portal puede trabajar contra **dos bases de datos**. Cuál se usa lo decide el comando con
que se arranca; no hay un selector dentro del portal.

| Comando | Archivo de variables | Base (Supabase) | App principal | URL local |
|---|---|---|---|---|
| `npm run dev` | `.env.local` | **PROD** `buhljsqr…` | `https://app.nubel.tech` | http://localhost:3002 |
| `npm run dev:dev` | `.env.dev.local` (gana sobre `.env.local`) | **DEV** `pwssiwhr…` | `https://nubelsaas-dev-gamma.vercel.app` | http://localhost:3003 |

Los dos pueden correr al mismo tiempo: DEV usa otro puerto y su propia carpeta de build
(`NEXT_DIST_DIR=.next-dev`). Las sesiones no se mezclan, porque Supabase nombra la cookie con
la referencia del proyecto. Cada base tiene su propio `auth.users` y su propia
`admin_superadmins`: en DEV se entra con un usuario que exista **en DEV**.

## Cómo se ve en qué base se está

- **Franja superior fija** (`components/shared/EnvBanner.tsx`), también en `/login`:
  rosa "PRODUCCIÓN · <ref>" o ámbar "DESARROLLO · <ref>". La referencia sale de
  `NEXT_PUBLIC_SUPABASE_URL`, así que muestra la base real aunque la etiqueta esté mal puesta.
  Si falta `NEXT_PUBLIC_NUBEL_ENV`, la franja va en gris oscuro: "Entorno sin definir".
- **Pestaña del navegador:** en DEV el título es "[DEV] Nubel Admin".

## Cómo funciona

- `scripts/with-env.mjs <archivo> <comando>` carga el archivo en `process.env` y luego corre el
  comando. Next (`@next/env`) no pisa variables que ya vienen en el proceso, por eso las de
  `.env.dev.local` ganan sobre `.env.local`. Funciona igual en macOS y Windows.
- **Guardas del lanzador** (abortan antes de arrancar):
  - el archivo debe existir y definir `NEXT_PUBLIC_NUBEL_ENV` y `NEXT_PUBLIC_SUPABASE_URL`;
  - si dice algo distinto de `prod`, su Supabase debe ser distinto al de `.env.local`.
- `lib/environment.ts` (`getNubelEnv()`) expone el entorno y la referencia del proyecto.

## Variables

| Variable | `.env.local` (PROD) | `.env.dev.local` (DEV) |
|---|---|---|
| `NEXT_PUBLIC_NUBEL_ENV` | `prod` | `dev` |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | proyecto PROD | proyecto DEV (mismos valores que `nubelsaas/.env.dev.local`) |
| `MAIN_APP_URL` · `NEXT_PUBLIC_MAIN_APP_URL` | `https://app.nubel.tech` | `https://nubelsaas-dev-gamma.vercel.app` |
| `NEXT_DIST_DIR` | — | `.next-dev` |

Plantilla: `.env.example`. Los dos archivos están en `.gitignore`.

## Ramas de git

`main` y `dev` en GitHub (`nubelsaas/nubelsaasadmin`). Las ramas organizan el código; **no**
cambian la base: eso lo decide solo el comando de arranque.
