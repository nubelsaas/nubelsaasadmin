# Audit Log

**Ruta:** `/audit`  
**Archivos:** `app/(admin)/audit/page.tsx` · `app/api/audit/route.ts` · `app/api/audit/admin/route.ts` · `lib/adminAudit.ts`  
**Tipo:** Client Component

---

## Dos vistas

| Vista | Tabla | Qué muestra |
|---|---|---|
| **Tenant activity** | `audit_log` | Lo que pasa dentro de cada tenant. La escriben triggers del app principal. |
| **Admin actions** | `admin_audit_logs` | Lo que hacen los superadmins desde este portal. |

`audit_log` no sirve para las acciones del portal: su `tenant_id` es obligatorio, su `user_id` apunta a `users` del tenant, y el app principal también la lee.

---

## Tabla `admin_audit_logs`

Migración: `supabase/migrations/20261031_admin_audit_logs.sql` (se corre a mano en DEV y en PROD desde el SQL editor de Supabase).

| Columna | Contenido |
|---|---|
| `admin_user_id`, `admin_email` | Quién hizo la acción |
| `action` | Ver tabla abajo |
| `tenant_id` | Tenant afectado; null en acciones globales |
| `details` | Datos de la acción |
| `created_at` | Cuándo |

Sin foreign keys, para que el registro sobreviva al borrado del tenant o del admin. RLS activo sin políticas: solo el service role la lee y escribe.

---

## Regla para rutas nuevas

**Toda ruta que escribe llama a `logAdminAction()` antes de ejecutar. Si devuelve `false`, aborta con `AUDIT_FAILED`.** Ninguna acción queda sin registro; a cambio, si la tabla no está disponible, las escrituras del portal fallan.

Consecuencias:

- El registro indica que la acción se **intentó**: se escribe antes, así que puede existir aunque la acción haya fallado después.
- `details` nunca lleva contraseñas ni tokens.
- Única excepción: `clone.auto_rollback` no bloquea, porque un clone a medias debe limpiarse igual.
- `POST /api/upload/logo` no se registra: solo sube el archivo. El cambio queda en `tenant.update` al guardar `logo_url`.

---

## Acciones registradas

| Acción | Ruta | `details` |
|---|---|---|
| `impersonate` | `POST /api/impersonate` | `email` |
| `user.magic_link` · `user.invite_resend` | `POST /api/tenants/[id]/users/[userId]/resend` | `email` |
| `tenant.create` | `POST /api/tenants` | `name`, `admin_email`, `plan_id` |
| `tenant.update` | `PATCH /api/tenants/[id]` | `changes` (flags incluidos) |
| `tenant.delete` | `DELETE /api/tenants/[id]` | `name`, `admin_email`, `users` (emails) |
| `tenant.admin_create` | `POST /api/tenants/[id]/admin` | `email`, `mode` |
| `clone.onboarding` · `clone.demo` · `clone.rollback` | `POST /api/clone/stream` | `source`, `copyStock`, `exclude` |
| `clone.auto_rollback` | `POST /api/clone/stream` | `error` |
| `import` | `POST /api/import` | `entity`, `records` (cantidad) |
| `category.create` · `category.update` | `/api/categories/expense` | `name`, `type` · `id`, `changes` |
