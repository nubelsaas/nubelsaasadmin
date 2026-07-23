# Walkthrough: Dashboard — fix RLS en Server Component

**Fecha:** 2026-06-02  
**Archivos modificados:**
- `app/(admin)/page.tsx`

**Tipo de cambio:** Bug fix — el tenant recién creado no aparecía en el dashboard

---

## Problema

El dashboard (`app/(admin)/page.tsx`) es un **Server Component** que leía `tenants` con `createServerSupabaseClient()` (anon key + sesión del usuario). La política RLS `"Tenant aisment"` restringe a los usuarios autenticados a leer solo el tenant de su propio `tenant_id`. El superadmin estaba asociado al tenant "CHLOE Hair Studio", por lo que el dashboard solo mostraba ese tenant.

La misma causa raíz que en las páginas cliente, pero en un contexto diferente: al ser un Server Component, la solución no requiere una API route intermedia — se puede usar `createAdminClient()` directamente en el server, que bypasa RLS con service role.

## Solución

```ts
// Antes
import { createServerSupabaseClient } from '@/lib/supabaseServer';
async function getData() {
  const supabase = createServerSupabaseClient();
  // ... queries con RLS activo
}

// Después
import { createAdminClient } from '@/lib/supabaseAdmin';
async function getData() {
  const db = createAdminClient();
  // ... queries sin RLS (service role)
}
```

La service role key solo existe en variables de entorno del servidor (`SUPABASE_SERVICE_ROLE_KEY`) y nunca se expone al browser — su uso en un Server Component es seguro por diseño.

## Patrón establecido

| Contexto | Cliente correcto |
|---|---|
| Server Component (page.tsx async) | `createAdminClient()` directo |
| Client Component (use client) | `fetch('/api/...')` → API route con `createAdminClient()` |
| API route | `createAdminClient()` |

La verificación de superadmin en Server Components se puede hacer con `createServerSupabaseClient()` para leer la sesión, seguido de `createAdminClient()` para los datos. En el dashboard esto no es necesario porque la ruta `(admin)` ya está protegida por el middleware.
