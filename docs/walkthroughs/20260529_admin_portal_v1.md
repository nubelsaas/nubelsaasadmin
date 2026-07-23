# Walkthrough: Nubel Admin Portal v1

**Fecha:** 2026-05-29  
**Scope:** Construcción completa del portal de administración `nubel-admin`

---

## Contexto

El portal de administración es una aplicación Next.js 14 **separada** del app principal (`nubelsaas`), pero que comparte el mismo proyecto de Supabase. Permite a los superadmins de Nubel gestionar tenants, configurar feature flags, impersonar usuarios y preparar entornos de demo/entrenamiento.

---

## Sprint 1 — Scaffolding y Tenants CRUD

### Lo que se construyó

- Proyecto Next.js 14 con App Router, TypeScript, Tailwind CSS
- Autenticación con `@supabase/ssr` (cookie-based, compatible con App Router)
- Layout con sidebar (desktop) y bottom nav (mobile): Dashboard, Tenants, Clone, Import, Feature Flags, Impersonate
- Migración SQL `admin_superadmins` — tabla con prefijo `admin_` para distinguir tablas del portal vs. tablas del app principal
- Login page con redirect post-auth
- Tenants list con búsqueda
- Tenant detail con stats (usuarios activos, sucursales, última venta)
- Modal de creación de tenant
- `AdminHeader` component reutilizable

### Decisiones de arquitectura

**Writes siempre por API route con service role:**  
Las tablas del app principal tienen RLS que bloquea INSERT/UPDATE desde el anon key. Se estableció el patrón obligatorio: lecturas con `createClient()` (browser), escrituras con `createAdminClient()` (service role) siempre vía API route que primero valida superadmin.

**Prefijo `admin_` para tablas propias:**  
Todas las tablas creadas para este módulo usan prefijo `admin_` para coexistir sin ambigüedad con las tablas del app principal en el mismo Supabase.

---

## Sprint 2 — Feature Flags, Impersonación y Estadísticas

### Lo que se construyó

- Feature Flags (`/flags`): dos paneles, 6 boolean toggles + `assistant_base_fee`, escribe en `tenants.feature_overrides` (JSONB)
- Impersonación (`/impersonate`): genera magic links con `auth.admin.generateLink`, copy + open in app
- Estadísticas en tenant detail: activeUsers, branches count, last sale (usa `date_time` no `created_at`)

### Problemas resueltos

- `column s.created_at does not exist` → `sales` usa `date_time` como columna temporal
- `UserSwitch` no existe en lucide-react → reemplazado por `UserCog`

---

## Sprint 3 — Clone / Onboarding / Demo Seed

### Iteración 1 → Iteración 2: UUID Remapping

Primera versión copiaba IDs del origen. Fix: construir `Map<old_id, new_uuid>` para cada tabla, insertar en orden topológico (5 niveles), remapar todos los FK columns.

### Pivot de diseño: Onboarding vs. Demo Seed

Se identificó que "Full clone" copiaba datos sensibles de producción. Rediseño a dos modos fundamentalmente distintos:

- **Onboarding**: copia catálogo, para nuevos clientes en producción
- **Demo Seed**: copia catálogo + genera 3 meses de transacciones 100% sintéticas

El generador sintético usa los triggers de BD para calcular comisiones (no duplica lógica), y construye nóminas desde los totales reales post-trigger → nóminas cuadran con ventas exactamente.

### Reglas de privacidad permanentes

| Dato | Regla |
|---|---|
| Clientes reales | Nunca se copian — siempre 50 mocks |
| `users.document_number` | Siempre null en destino |
| `users.pos_pin` | Siempre null en destino |
| `users.email` | `usuario-{uuid}@demo.test` |
| `users.first_name/last_name` | "Usuario N" |

---

## Sprint 4 — Refinamientos y correcciones

### Modal de creación de tenant rediseñado

El modal original tenía solo nombre y email, y fallaba con `null value in column "plan_id"`.

**Nuevo modal** con 5 secciones:
- Identity, Location (país required), Contact (email + teléfono con prefijo auto), Configuration (moneda y timezone auto-rellenados del país), Plan (selector)
- Logo upload: `POST /api/upload/logo` → Supabase Storage bucket `empresa-logos`

`lib/countries.ts` centraliza configs de 20 países (nombre, bandera, prefijo, moneda, timezone). Al cambiar el país, los demás campos se auto-rellenan y son editables.

### API `/api/plans`

El selector de planes del modal no podía leer `subscription_plans` desde el browser client (posible RLS). Se creó `GET /api/plans` que usa el admin client, siguiendo el patrón establecido.

### Dashboard y Tenants agrupados por país

`groupByCountry<T>()` en `lib/countries.ts` es genérica y compartida por ambas páginas. Antes existía duplicado en cada archivo.

- Bug fix: `Clock` → `Globe` en la stat card de Countries en el Dashboard
- Fix: query con `.order('country_iso', { nullsFirst: false })` para que tenants sin país aparezcan al final en lugar de perderse

### Favicon distintivo

`app/icon.svg` — fondo indigo con texto "adm". Referenciado en `layout.tsx` metadata.

---

## Sprint 5 — Rollback

### Problema

Si el clone falla a mitad (ej. error en la tabla 7 de 10), el tenant destino queda con datos parciales — ni vacío ni completo.

### Rollback automático

En el `catch` del route handler SSE, después de emitir el error, se llama a `rollback(targetId, db, send)`. El usuario ve el progreso del rollback en el mismo log terminal sin acción adicional.

### Undo manual

Después de una clonación exitosa, la variable `clonedTarget` se setea con el tenant destino. Aparece un banner ámbar con el botón **"Undo clone"**. Al hacer click:
- `mode=rollback` se envía al endpoint (solo requiere `target`, no `source`)
- El mismo log terminal muestra cada tabla borrada con su count
- Al terminar, `clonedTarget` se limpia y el banner desaparece

### Algoritmo de rollback

Orden topológico inverso (hijos antes que padres) para respetar FK constraints. Cubre todas las tablas con `tenant_id`, incluyendo las generadas por Demo Seed (sales, payrolls, etc.). El registro del tenant en `tenants` no se toca — queda vacío pero existente.

### Código externo reutilizado

El loop SSE de lectura se extrajo a `readStream(url, onLine)` en la UI. Tanto `handleRun` como `handleUndo` la usan — el código de lectura no se duplica.

---

## Estado final del portal

| Sección | Estado |
|---|---|
| Auth (login/logout) | ✅ Completo |
| Dashboard (agrupado por país) | ✅ Completo |
| Tenants (list + detail + create modal completo) | ✅ Completo |
| Feature Flags | ✅ Completo |
| Impersonate | ✅ Completo |
| Onboarding (clone catálogo) | ✅ Completo |
| Demo Seed (datos sintéticos 3 meses) | ✅ Completo |
| Rollback automático en error | ✅ Completo |
| Undo clone manual | ✅ Completo |
| Logo upload | ✅ Completo (requiere bucket `empresa-logos`) |
| Import CSV | 🚧 Pendiente |
| Subscription/Plan management | 🚧 Pendiente |

---

## Problemas conocidos y soluciones documentadas

| Problema | Causa | Solución |
|---|---|---|
| Tenants page stuck on "Loading" | Corrupción del `.next` cache | `rm -rf .next` + reinicio |
| RLS error al crear tenant | Anon key bloqueado por RLS en INSERT | Writes siempre vía service role API route |
| `null value in column "plan_id"` | Modal no enviaba `plan_id` | Selector de plan en el modal + validación en API |
| Combo "Loading plans…" perpetuo | RLS bloqueaba SELECT en `subscription_plans` | `GET /api/plans` con admin client |
| `column s.created_at does not exist` | `sales` usa `date_time` | Ver schema antes de codificar |
| Tenant sin país no aparece en lista | `ORDER BY country_iso` con NULLs | `{ nullsFirst: false }` en Supabase order |
| `UserSwitch` not in lucide-react | Ícono inexistente | Usar `UserCog` |
| Clone parcial sin rollback | No había mecanismo de limpieza | Rollback automático en catch + Undo manual |
