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
- `details` nunca lleva contraseñas ni tokens, y evita datos personales que no hagan falta.
- No hay política de retención: los registros no se borran, incluidos los emails de `impersonate`.
- Excepción: `clone.auto_rollback` y los registros de cierre (`clone.finished`, `clone.rollback_finished`, `clone.rollback_failed`) no bloquean, porque el trabajo ya se hizo o debe limpiarse igual.
- Los registros `clone.*` e `import.*` también son estado: Undo los lee para decidir qué se puede deshacer. No borrarlos ni renombrarlos.
- `POST /api/upload/logo` no se registra: solo sube el archivo. El cambio queda en `tenant.update` al guardar `logo_url`.

---

## Lecturas

Ver datos de un salón también queda registrado (`logAdminView`): el detalle, el equipo con sus emails y permisos, y su actividad. La exportación ya registra `tenant.export`.

- Una vez por hora como mucho, por admin, vista y salón: recargar no llena el log.
- Si no se puede registrar, la ruta no devuelve los datos (`500`), igual que con las escrituras.
- **Admin actions** las oculta por defecto. Se ven con **Include views** o filtrando por acción.
- No se registran el listado de tenants, el dashboard ni los planes: no muestran datos de un salón en particular.

## Acciones registradas

| Acción | Ruta | `details` |
|---|---|---|
| `view.tenant` · `view.staff` · `view.activity` | `GET /api/tenants/[id]` · `GET /api/tenants/[id]/users` · `GET /api/audit` | — (el salón va en `tenant_id`; `null` si se miró la actividad de todos) |
| `impersonate` | `POST /api/impersonate` | `email`, `reason` |
| `user.magic_link` · `user.invite_resend` | `POST /api/tenants/[id]/users/[userId]/resend` | `email` |
| `user.deactivate` · `user.reactivate` · `user.make_owner` | `POST /api/tenants/[id]/users/[userId]/access` | `email`, `reason` |
| `tenant.create` | `POST /api/tenants` | `name`, `admin_email`, `plan_id` |
| `tenant.update` | `PATCH /api/tenants/[id]` | `changes` (flags incluidos) |
| `tenant.export` · `tenant.export_finished` | `POST /api/tenants/[id]/export` | `reason` · `rows` (cantidad por archivo) |
| `tenant.suspend` · `tenant.reactivate` | `POST /api/tenants/[id]/suspension` | `reason` |
| `tenant.delete` | `DELETE /api/tenants/[id]` | `name`, `users` (cantidad) |
| `tenant.admin_create` | `POST /api/tenants/[id]/admin` | `email`, `mode` |
| `clone.onboarding` · `clone.demo` · `clone.rollback` | `POST /api/clone/stream` | `source`, `copyStock`, `exclude` |
| `clone.finished` · `clone.rollback_finished` · `clone.rollback_failed` | `POST /api/clone/stream` | — (`error` si falló) |
| `clone.auto_rollback` | `POST /api/clone/stream` | `error` |
| `import` | `POST /api/import` | `entity`, `records`, `skipped`, `live` |
| `import.finished` | `POST /api/import` | `entity`, `inserted`, `skipped`, `ids` (para Undo; la pantalla muestra la cantidad) |
| `import.undone` · `import.undo_finished` | `POST /api/import/undo` | `importId`, `entity` · `removed`, `kept` |
| `category.create` · `category.update` | `/api/categories/expense` | `name`, `type` · `id`, `changes` |
