# Clone: superadmin obligatorio del tenant destino

**Fecha:** 2026-06-27
**Tipo:** Feature — cambio de flujo en Clone
**Módulo:** `/clone`

---

## Problema

Tras un clone (Onboarding o Demo Seed), el tenant destino quedaba **sin ningún usuario con login**:
- Los staff de Demo Seed se clonan **ofuscados** y con UUID nuevo → no existen en `auth.users` → no pueden iniciar sesión.
- Crear el tenant destino (`POST /api/tenants`) solo inserta la fila en `tenants`; no crea admin.

Resultado: el usuario clonaba data pero **no podía entrar** al tenant resultante. El mensaje final solo decía "Staff has no auth credentials — re-invite from the main app", sin resolverlo.

## Solución

El flujo de clone ahora **exige crear un superadmin nuevo** como parte del proceso, para ambos modos.

### Regla de email — identidad nueva
El email del superadmin **no puede existir ya en `auth.users`**. Un email en Supabase Auth es único globalmente y mapea a un solo tenant (`self_heal_user_profile` resuelve el tenant por email en el login), así que reusar uno ataría un login a dos tenants. Por eso se exige email nuevo.

- **Validación en vivo (UX):** `GET /api/clone/check-admin-email` con debounce; el botón de inicio se bloquea si no está disponible.
- **Validación autoritativa (servidor):** `createAdminUserForTenant({ requireNew: true })` rechaza emails ya registrados (HTTP 409).

### Orquestación
Después de que el seed termina con éxito, la UI llama a `POST /api/tenants/{target}/admin` con `require_new: true`. Resultado en el mismo log terminal. El clone solo se marca completo si el admin se creó.

## Archivos modificados / creados

| Archivo | Cambio |
|---|---|
| `lib/createAdminUser.ts` | Nueva opción `requireNew` — rechaza si el email ya está en `auth.users` |
| `app/api/tenants/[id]/admin/route.ts` | Acepta `require_new`; mapea rechazo a HTTP 409 |
| `app/api/clone/check-admin-email/route.ts` | **Nuevo** — disponibilidad del email (superadmin-gated) |
| `app/(admin)/clone/page.tsx` | Sub-formulario de superadmin (invite/manual), chequeo en vivo, gate del botón, creación post-seed, resumen en el modal de confirmación |
| `docs/features/clone.md` | Sección "Superadmin obligatorio del clon", flujo UI, endpoints |

## Decisiones de diseño

- **Reutilización:** se reusó el helper probado `createAdminUserForTenant` y la ruta `tenants/[id]/admin` en lugar de duplicar lógica de creación de auth users.
- **No se tocó el stream SSE:** la creación del admin se orquesta desde la UI tras el seed, evitando exponer la contraseña en una URL GET y minimizando el radio de cambio.
- **Ambos modos:** Onboarding y Demo crean tenants sin login → ambos exigen el superadmin.
- **Modos invite/manual:** mismos dos modos que la pantalla existente de creación de admin, para consistencia.

## Notas / pendientes

- Si la creación del admin falla *después* del seed (p. ej. carrera donde el email se registró entremedio), el dato queda sembrado sin admin; el log lo indica y se puede usar "Undo clone" o reintentar desde Tenants → Users. No es atómico con el seed por diseño (el pre-chequeo de email cubre el caso común).

---

## Anexo — Bug del rollback vs. guard de superadmin (mismo día)

### Síntoma
Tras hacer "Undo clone" de un Demo Seed **sin superadmin** y luego intentar re-clonar, el tenant destino mostraba **"Tenant already has data → Non-empty: users"**.

### Causa raíz
El rollback ejecutaba `DELETE FROM users WHERE tenant_id=X AND email != admin_email`. Cuando `admin_email` no coincide con ningún usuario (Demo Seed sin admin real), el delete apuntaba a **todos** los usuarios, incluidos los superadmins demo. El trigger `trg_guard_last_superadmin` (nubelsaas, `BEFORE DELETE`, sin bypass) **aborta** cualquier operación que deje al tenant sin superadmin activo → el `DELETE` entero falla → quedan todos los usuarios.

Verificado en prod: tenant "Salon D'Pruebas" con 14 users `@demo.test` (ninguno en `auth.users`, 4 superadmins activos), 0 branches/products/sales.

### Fix
1. **`lib/createAdminUser.ts`** — al crear el superadmin, registra `tenants.admin_email = email` (si estaba NULL), para que rollback/check-target reconozcan al admin real.
2. **`app/api/clone/stream/route.ts` (rollback)** — conserva **un guardián** explícito (por `id`): el admin real si existe, o cualquier superadmin activo como fallback (con aviso `⚠️`). El delete ya nunca aborta por el guard. Las `roles` se preservan según el `role_id` del guardián.

### Limpieza del incidente (prod)
Se eliminó el tenant atascado `7e999444-…` ("Salon D'Pruebas") con `DELETE FROM tenants` en transacción verificada: el cascade desde `tenants` está exento del guard, así que borró los 14 users limpiamente. Para vaciar por completo un tenant atascado, **borrar el tenant** es la vía (el guard impide dejarlo en 0 superadmins mientras exista).
