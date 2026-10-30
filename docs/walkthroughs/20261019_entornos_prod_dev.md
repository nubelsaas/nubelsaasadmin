# Entornos PROD y DEV en el portal

**Fecha:** 2026-10-19 · **Doc:** `docs/features/entornos.md`

## Problema

El portal leía siempre `.env.local`, que apuntaba a PROD. No había forma de trabajar contra
DEV salvo editar ese archivo a mano (base, llaves y URL de la app principal) y acordarse de
devolverlo, ni nada en pantalla que dijera en qué base se estaba escribiendo.

## Cambios

- `scripts/with-env.mjs`: lanzador que carga un archivo `.env` antes que `.env.local`, con
  guardas (archivo existente, variables mínimas, DEV ≠ base de PROD).
- `package.json`: `npm run dev:dev` → `.env.dev.local`, puerto 3003.
- `next.config.mjs`: `distDir` desde `NEXT_DIST_DIR` (DEV usa `.next-dev`) para correr junto a
  PROD sin pisar el build. `.gitignore` y `tsconfig.json` incluyen `.next-dev`.
- `lib/environment.ts` + `components/shared/EnvBanner.tsx` en `app/layout.tsx`: franja fija
  con entorno y referencia del proyecto; título "[DEV] Nubel Admin" en DEV.
- `.env.example` documenta los dos archivos. `.env.dev.local` creado localmente con las llaves
  de `nubelsaas/.env.dev.local`; `.env.local` recibió `NEXT_PUBLIC_NUBEL_ENV=prod`.
- Ramas `main` y `dev` en GitHub.

## Verificación

- `npx tsc --noEmit` sin errores; `next lint` solo con la advertencia previa de `<img>`.
- PROD (puerto temporal) y DEV corriendo a la vez: `/login` muestra "Producción ·
  buhljsqr…" / "Desarrollo · pwssiwhr…" y el título "[DEV] Nubel Admin" solo en DEV; cada uno
  con su carpeta de build.
- Guardas: un archivo "dev" con la URL de PROD aborta; un archivo inexistente aborta.
- **No probado:** iniciar sesión en DEV (requiere un superadmin con contraseña en DEV) ni
  correr el lanzador en Windows.
- La app de DEV es `nubelsaas-dev-gamma.vercel.app`: es el único dominio del proyecto Vercel
  `nubelsaas-dev` (API de Vercel, 2026-10-19). `nubelsaas-dev.vercel.app`, que también usa la
  base DEV, **no** pertenece a ese proyecto; al principio se configuró por error.
