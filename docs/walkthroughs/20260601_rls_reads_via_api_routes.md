# Walkthrough: Lecturas de tenants vía API routes (fix RLS)

**Fecha:** 2026-06-01  
**Archivos modificados:**
- `app/api/tenants/route.ts` — nuevo `GET`
- `app/api/tenants/[id]/route.ts` — nuevo `GET`
- `app/api/tenants/[id]/users/route.ts` — nueva ruta
- `app/api/clone/check-target/route.ts` — nueva ruta
- `app/(admin)/tenants/page.tsx`
- `app/(admin)/tenants/[id]/page.tsx`
- `app/(admin)/impersonate/page.tsx`
- `app/(admin)/import/page.tsx`
- `app/(admin)/clone/page.tsx`
- `app/(admin)/audit/page.tsx`
- `components/layout/AdminHeader.tsx`

**Tipo de cambio:** Bug fix — datos de tenants ajenos no aparecían en el portal

---

## Problema

Todas las páginas del portal leían tablas (`tenants`, `users`, `branches`, `sales`) directamente desde el browser usando `createClient()` (anon key + sesión del usuario). La tabla `tenants` tiene dos políticas RLS:

```sql
-- Para todos (SELECT): USING(true)
CREATE POLICY "Permitir lectura pública de tenants" ON public.tenants
FOR SELECT TO public USING (true);

-- Para autenticados (ALL): USING(id = get_user_tenant_id())
CREATE POLICY "Tenant aisment" ON public.tenants
FOR ALL TO authenticated USING (id = get_user_tenant_id());
```

En la práctica, el rol `authenticated` solo ve el tenant de su propio usuario (`get_user_tenant_id()`). El superadmin del portal estaba asociado al tenant "CHLOE Hair Studio", por lo que solo ese tenant aparecía en todas las listas. Los tenants nuevos no eran visibles.

## Solución

**Regla establecida:** todas las queries a tablas de datos del app principal deben ir vía API route usando `createAdminClient()` (service role, bypasa RLS). No existe excepción para lecturas.

Se actualizó el `CLAUDE.md` implícitamente — la regla que decía "Lecturas con `createClient()` — OK si hay política SELECT" fue invalidada por este bug.

### Nuevas rutas creadas

| Ruta | Propósito |
|---|---|
| `GET /api/tenants?search=` | Lista/búsqueda de todos los tenants |
| `GET /api/tenants/[id]` | Detalle de tenant + stats (usuarios, sucursales, última venta) |
| `GET /api/tenants/[id]/users` | Usuarios activos de un tenant (para impersonación) |
| `GET /api/clone/check-target?tenant_id=` | Verifica si un tenant destino está vacío antes de clonar |

### Páginas corregidas

Todas las llamadas `createClient().from(...)` en páginas y componentes de UI fueron reemplazadas por `fetch('/api/...')`. Se eliminaron los imports de `@/lib/supabase` en los archivos afectados.

La excepción válida: `supabase.auth.signIn/signOut` en `login/page.tsx` y `AdminSidebar.tsx` — estos no consultan tablas de datos y no están sujetos a RLS.
