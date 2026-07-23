# Walkthrough: Security hardening — API routes del portal de admin

**Fecha:** 2026-06-01  
**Archivos modificados:**
- `lib/assertSuperadmin.ts` — nueva utilidad centralizada
- `app/api/plans/route.ts`
- `app/api/upload/logo/route.ts`
- `app/api/tenants/[id]/route.ts`
- `app/api/audit/route.ts`
- `app/api/import/route.ts`
- `app/api/impersonate/route.ts`
- `app/api/clone/stream/route.ts`
- `app/api/tenants/route.ts`
- `app/api/tenants/[id]/users/route.ts`
- `app/api/clone/check-target/route.ts`

**Tipo de cambio:** Seguridad — 3 vulnerabilidades corregidas + refactor de mantenibilidad

---

## Problema 1 (🔴 Crítico): `upload/logo` sin verificación de superadmin

`POST /api/upload/logo` solo verificaba que existiera una sesión activa (`if (!session)`), no que el usuario fuera superadmin. Dado que el portal comparte proyecto Supabase con el app principal, cualquier usuario autenticado del app (`nubelsaas`) con un JWT válido podía subir archivos arbitrarios al bucket `empresa-logos`.

**Fix:** reemplazado `session` check por `assertSuperadmin()`.

---

## Problema 2 (🟡 Importante): `GET /api/plans` sin verificación de superadmin

Solo verificaba sesión activa. Cualquier usuario autenticado podía obtener la lista de planes de suscripción con nombres y precios.

**Fix:** reemplazado `session` check por `assertSuperadmin()`.

---

## Problema 3 (🟡 Importante): Mass assignment en `PATCH /api/tenants/[id]`

El handler pasaba el body del request directamente a `db.from('tenants').update(body)` sin filtrar campos. Un superadmin podía enviar cualquier columna de la tabla `tenants` y sobreescribirla.

**Fix:** whitelist explícita de campos permitidos:

```ts
const PATCHABLE_FIELDS = new Set(['name', 'admin_email', 'phone', 'city', 'plan_id', 'feature_overrides']);
```

El body se filtra campo a campo antes de llegar al `update()`. Campos fuera de la whitelist se descartan silenciosamente. Si no queda ningún campo válido, retorna 400.

---

## Problema 4 (🟠 Mantenibilidad): `assertSuperadmin()` duplicada en 8 archivos

La función estaba copiada inline (o como función local) en cada route handler. Un cambio en la lógica de autorización requería actualizarla en todos los lugares.

**Fix:** centralizada en `lib/assertSuperadmin.ts`. Todos los route handlers ahora importan de ahí.

```ts
// lib/assertSuperadmin.ts
export async function assertSuperadmin() {
  const supabase = createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: admin } = await supabase
    .from('admin_superadmins').select('id').eq('user_id', session.user.id).single();
  return admin ? session : null;
}
```

Uso estándar en cada handler:
```ts
if (!await assertSuperadmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```
