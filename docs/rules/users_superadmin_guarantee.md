# Regla: Garantía de Súper Administrador en `public.users` (trigger de BD)

**Fecha:** 2026-06-20
**Origen:** Implementado en `nubelsaas` — [docs/database/users_integrity.sql](../../../nubelsaas/docs/database/users_integrity.sql) · [staff_rules.md §7.3](../../../nubelsaas/docs/business_rules/staff_rules.md)
**Aplica a:** todo código de `nubel-admin` que **escriba** sobre la tabla `users` del app principal.

---

## Qué cambió en la BD

El app principal añadió un trigger en `public.users` que hace **inviolable** la invariante:

> Todo tenant conserva SIEMPRE ≥1 usuario con `is_active != false` **Y** `permissions->>'can_do_everything' = true`.

- **Función:** `fn_guard_last_superadmin()` (`SECURITY DEFINER`).
- **Trigger:** `trg_guard_last_superadmin` — `BEFORE UPDATE OR DELETE ON public.users FOR EACH ROW`.
- Aborta la operación que sacaría al **último** superadmin activo del tenant, sea por: desmarcar `can_do_everything`, suspender (`is_active = false`), cambiar de rol (reescribir `permissions`), o eliminar la fila.
- **Señal de error:** `RAISE EXCEPTION ... USING ERRCODE = 'P0001'`, con el mensaje prefijado `LAST_SUPERADMIN:`.

---

## Por qué le importa a `nubel-admin` (CRÍTICO)

Este portal escribe sobre tablas del app principal **vía service role** (`createAdminClient()`) para bypasear RLS. **El trigger NO se bypasea con service role.**

> Service role bypasea **RLS**, no **triggers**. `BEFORE UPDATE/DELETE` se ejecuta para cualquier escritor, incluido el service role.

Es decir: el vector que el plan describía como evadible ("API con service-role") es exactamente lo que hace este portal. Cualquier ruta de admin que **suspenda, demueva o elimine** un usuario que sea el único superadmin del tenant **fallará con `P0001`** — y debe tratarse, no romper con un 500 críptico.

---

## Cómo afecta cada operación del portal

| Operación del portal | Efecto del trigger |
|---|---|
| **GET** `/api/tenants/[id]/users` (lectura) | Sin efecto. El trigger solo corre en UPDATE/DELETE. |
| **POST** `/api/tenants` → `createAdminUserForTenant` (alta del primer admin) | Sin efecto: es un INSERT, y además **crea** al guardián. El trigger garantiza la *conservación*, no el *alta* — el alta sigue siendo responsabilidad de este portal (ver abajo). |
| **DELETE** `/api/tenants` (`db.from('tenants').delete()`) | **Permitido**. El trigger detecta que el tenant ya no existe (cascade) y no bloquea la limpieza de sus `users`. |
| **Cualquier futura** ruta que haga `users.update({ is_active })`, cambie `permissions`/rol, o `users.delete()` | **Puede fallar con `P0001`** si el target es el último superadmin activo. Manejar el error explícitamente. |

---

## Contrato de manejo de error en rutas API

Cuando una ruta de admin escriba sobre `users`, detectar el código y devolver un mensaje claro (no el error crudo):

```ts
const { error } = await createAdminClient()
  .from('users')
  .update({ is_active: false })          // o permissions / role_id / .delete()
  .eq('id', userId)
  .eq('tenant_id', tenantId);

if (error) {
  const isLastSuperadmin =
    error.code === 'P0001' || (error.message || '').includes('LAST_SUPERADMIN');
  if (isLastSuperadmin) {
    return NextResponse.json(
      { error: 'El tenant debe conservar al menos un Súper Administrador activo. Asigna a otro usuario como administrador antes de modificar, suspender o eliminar a este.' },
      { status: 409 },   // conflicto de invariante, no error del servidor
    );
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
```

> ⚠️ Recordatorio del proyecto: Supabase no lanza excepciones, retorna `{ data, error }`. Verificar `error` explícitamente — un UPDATE bloqueado por el trigger llega como `error`, no como throw.

---

## Responsabilidad del portal: seeding del primer superadmin

El trigger garantiza la **conservación**, **no el alta**. La creación del primer superadmin al dar de alta un tenant ocurre **en este portal** (`POST /api/tenants` → `createAdminUserForTenant`, que inserta el usuario con `can_do_everything: true`).

Esa responsabilidad **se mantiene y es ahora la única defensa del lado del alta**:
- Si la creación del admin falla, la ruta ya revierte el tenant (`db.from('tenants').delete()`) para que **ningún tenant quede sin Súper Administrador**. Conservar ese comportamiento.
- No introducir flujos de alta de tenant que dejen la creación del admin como paso opcional o diferido.

---

## Reglas operativas (resumen)

1. **No asumas que el service role te exime del trigger.** Toda escritura a `users` que toque `is_active`, `permissions` o `role_id`, o que elimine filas, está sujeta a la garantía.
2. **Maneja `P0001` / `LAST_SUPERADMIN`** en cualquier ruta nueva que escriba usuarios; devuelve `409` con mensaje claro.
3. **El borrado de tenant (cascade) es seguro** — el trigger lo permite explícitamente.
4. **El alta del primer admin es responsabilidad del portal** — no la del trigger. Mantén la reversión del tenant si el admin no se crea.
5. **Verifica el schema** de `users` (`is_active`, `permissions`, `tenant_id`) en [schema.md](../../../nubelsaas/docs/database/schema.md) antes de codificar cualquier write.
