# nubel-admin — Instrucciones para Claude

## Documentación del portal

```
docs/
├── features/          ← Una doc por sección del menú
│   ├── dashboard.md
│   ├── tenants.md
│   ├── clone.md       ← Onboarding + Demo Seed (leer antes de tocar clone)
│   ├── flags.md
│   ├── impersonate.md
│   └── import.md      ← Pendiente de implementar
├── walkthroughs/
│   └── 20260529_admin_portal_v1.md
└── plans/
    └── admin_portal_sprints.md  ← Estado de sprints + pendientes
```

## Stack
Next.js 14 (App Router) · TypeScript · Supabase (mismo proyecto que nubelsaas) · Tailwind CSS · Zustand · lucide-react

## Convención de nombres de tablas

Todas las tablas creadas exclusivamente para este módulo de administración deben usar el prefijo `admin_`.

**Ejemplos:**
- `admin_superadmins` — usuarios con acceso al portal de admin
- `admin_audit_logs` — logs de acciones administrativas (futuro)

**Motivo:** Las tablas del admin conviven en el mismo Supabase que las tablas del app principal (`tenants`, `users`, `sales`, etc.). El prefijo las identifica visualmente y evita colisiones de nombres.

**No aplica a:** tablas del app principal que el admin solo *lee* (e.g. `tenants`, `users`, `branches`). Esas no se renombran.

## Regla obligatoria — Verificar schema antes de codificar

**Antes de escribir cualquier query de Supabase que acceda a una tabla existente del app principal, leer primero:**

```
/Users/johnladino/Documents/nubelsaas/docs/database/schema.md
```

Verificar columna por columna los campos que se van a usar en `select`, `insert`, `update` o `filter`. No asumir nombres de columnas. Si el campo no aparece en el schema, no existe.

**Tablas del app principal más usadas en este portal:**

| Tabla | Columnas clave a verificar |
|---|---|
| `tenants` | `id`, `name`, `admin_email`, `phone`, `city`, `feature_overrides`, `settings`, `created_at` — **NO tiene** `is_active`, `slug`, `contact_email`, `plan` |
| `users` | `id`, `tenant_id`, `email`, `full_name`, `is_active`, `branch_id` |
| `branches` | `id`, `tenant_id`, `name`, `is_active` |
| `sales` | `id`, `tenant_id`, `date_time` (no `created_at`) |

Este chequeo es obligatorio incluso si la tarea parece obvia. El costo de leer el schema es cero; el costo de corregir código con columnas inexistentes es alto.

## Regla obligatoria — Writes siempre por API route (service role)

El cliente browser usa la **anon key** y está sujeto a RLS. Las tablas del app principal (`tenants`, `users`, etc.) tienen RLS que bloquea inserts/updates desde el portal.

**Patrón obligatorio:**
- **Lecturas** (`SELECT`): cliente browser (`createClient()`) — OK si hay política SELECT para el usuario autenticado.
- **Escrituras** (`INSERT`, `UPDATE`, `DELETE`): siempre via API route (`/api/...`) que usa `createAdminClient()` (service role, bypasa RLS). La API route valida que el caller sea superadmin antes de ejecutar.

Rutas ya creadas:
- `POST /api/tenants` — crear tenant
- `PATCH /api/tenants/[id]` — actualizar tenant (name, admin_email, phone, city, feature_overrides, etc.)
- `POST /api/impersonate` — generar magic link
- `GET /api/clone/stream` — SSE clone progress

## Auth
- La autenticación usa `auth.users` de Supabase (mismo proyecto).
- Para verificar si un usuario es admin se consulta `admin_superadmins` por `user_id`.
- La `SUPABASE_SERVICE_ROLE_KEY` se usa solo en rutas API server-side (impersonación, clone stream).

## UI
- **Librería de iconos: solo `lucide-react`.**
- **Sin librerías de componentes UI.** Todo con Tailwind CSS.
- **Paleta:** indigo (acción primaria), slate (neutrales), emerald (éxito), rose (error), amber (advertencia).
- **Responsive:** sidebar en `md+`, bottom nav (5 items) en mobile.
- **Layout de página:** `AdminHeader` + contenido con `p-4 md:p-8`.
- **Cards/secciones:** `bg-white rounded-2xl border border-slate-200`.
- **Botón primario:** `rounded-full bg-indigo-600 text-white font-black`.

## Variables de entorno
| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente browser y server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente browser y server |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo rutas API server-side |
| `MAIN_APP_URL` | Redirect post-impersonación (server-side) |
| `NEXT_PUBLIC_MAIN_APP_URL` | Links al app principal en UI |
