# Tenants

**Rutas:** `/tenants` · `/tenants/[id]` · `/tenants/[id]/users`  
**Archivos:** `app/(admin)/tenants/page.tsx` · `app/(admin)/tenants/[id]/page.tsx` · `app/(admin)/tenants/[id]/users/page.tsx`  
**Tipo:** Client Components

---

## Propósito

Gestión completa de tenants: listado con búsqueda, creación de nuevos tenants (incluyendo creación automática del usuario administrador), vista de detalle con estadísticas operativas y gestión de usuarios del tenant.

---

## Pantalla de listado `/tenants`

### Funcionalidades
- **Búsqueda en tiempo real** por nombre (debounced 300ms, query `ilike`)
- **Agrupación por país** con emoji flags
- **Crear nuevo tenant** — botón "New" abre el `TenantCreateModal`

### Columnas mostradas por tenant
| Campo | Descripción |
|---|---|
| `name` | Nombre del tenant |
| `admin_email` | Email del administrador principal |
| `created_at` | Fecha formateada en inglés |
| `country_iso` | Usado para la agrupación |

---

## Modal de creación `TenantCreateModal`

**Archivo:** `components/tenants/TenantCreateModal.tsx`

### Campos del formulario

| Campo | Requerido | Descripción |
|---|---|---|
| Business name | ✓ | Nombre del tenant |
| Country | ✓ | Determina currency, timezone y phone prefix |
| City | — | Ciudad del negocio |
| Admin email | ✓ | Email del Súper Administrador. **Obligatorio** — todo tenant nace con su admin. Crea el usuario admin automáticamente |
| Admin name | — | Nombre del usuario admin (si se omite, se usa "Administrador") |
| Phone | — | Teléfono de contacto |
| Currency | — | Auto-llenado por país, editable |
| Timezone | — | Auto-llenado por país, editable |
| Plan | ✓ | Plan de suscripción |
| Logo | — | Imagen PNG/JPG/SVG, máx 2 MB. Se sube a Storage antes del POST |

### Flujo de creación con admin_email (obligatorio)

`admin_email` es **obligatorio**: garantiza que todo tenant nazca con su Súper Administrador. El `POST /api/tenants`:
1. Valida `admin_email` (responde `400` si falta) además de `plan_id`.
2. Inserta el tenant en `tenants`.
3. Crea un `role` administrativo (`{ name: 'Administrador', type: 'administrative' }`) para ese tenant.
4. Llama `inviteUserByEmail` → Supabase envía email de invitación al admin.
5. Crea fila en `users` con `permissions: { can_do_everything: true }`.

**Atomicidad:** si la creación del admin falla (pasos 3-5), el tenant insertado en el paso 2 se **elimina** (`db.from('tenants').delete()`) y la API responde `500`. Ningún tenant queda persistido sin Súper Administrador.

El response de éxito es `{ id, adminCreated: true, adminError: null }` (201).

> **Nota:** el botón inline "Create new tenant" del flujo de Clone ([clone/page.tsx](../../app/(admin)/clone/page.tsx) → `handleCreateTarget`) envía solo `{ name }`, por lo que falla la validación (`plan_id`/`admin_email` requeridos). Crear el tenant destino debe hacerse vía el `TenantCreateModal`; el destino del clone debe ser un tenant ya creado con su admin.

### Upload del logo

Antes del POST de creación, si hay logo seleccionado:
1. `POST /api/upload/logo` → sube a Storage bucket `empresa-logos`
2. Retorna la URL pública
3. La URL se incluye como `logo_url` en el POST del tenant

---

## Pantalla de detalle `/tenants/[id]`

### Estadísticas del tenant

| Stat | Query | Acción al click |
|---|---|---|
| Users | `COUNT(*) WHERE tenant_id = id AND is_active = true` en `users` | Navega a `/tenants/[id]/users` |
| Branches | `COUNT(*) WHERE tenant_id = id AND is_active = true` en `branches` | — |
| Last sale | `date_time` de la venta más reciente en `sales` | — |

### Sección de Logo

Permite subir, reemplazar o eliminar el logo del tenant. El upload llama `POST /api/upload/logo` y luego `PATCH /api/tenants/[id]` con la URL resultante. El logo se guarda en el bucket de Storage `empresa-logos`.

### Campos editables del tenant

| Campo | Columna |
|---|---|
| Name | `name` |
| Admin email | `admin_email` |
| Phone | `phone` |
| City | `city` |
| Subscription plan | `plan_id` |

Todos vía `PATCH /api/tenants/[id]` (service role).

### Quick links

Botones de acceso rápido a: Feature Flags, Impersonate, Clone, Audit log, Open app.

---

## Pantalla de usuarios `/tenants/[id]/users`

**Archivo:** `app/(admin)/tenants/[id]/users/page.tsx`

### Propósito

Ver y gestionar los usuarios del tenant, con especial foco en asegurar que exista un usuario administrador con acceso completo al app principal.

### Banner de alerta — sin admin

Si no existe ningún usuario con `permissions.can_do_everything = true`:

**Caso A — tenant tiene `admin_email`:**
Se muestra el email guardado en el tenant con dos opciones:
- **"Yes, create admin"** → llama `POST /api/tenants/[id]/admin` con ese email directamente
- **"Use different email"** → abre el formulario pre-llenado con ese email

**Caso B — sin `admin_email`:**
Banner simple con link "Create admin →" que abre el formulario vacío.

### Formulario de creación de admin

Tiene dos modos seleccionables:

| Modo | Comportamiento |
|---|---|
| **Send invite** | Llama `inviteUserByEmail` → el admin recibe email para establecer su contraseña |
| **Create manually** | Llama `createUser` con contraseña definida en el formulario → sin email, acceso inmediato |

Campos: email (requerido), name (opcional), password + confirm (solo en modo manual, mín. 8 chars).

### Lista de usuarios

Cada usuario muestra: avatar con iniciales, nombre completo, email, badge del rol, badge "Admin" (indigo) si `can_do_everything`, badge "Inactive" si `is_active = false`.

### Acciones por usuario — panel expandible

Cada fila tiene un chevron `⌄` que expande un panel **"Registration actions"** con:

| Acción | Descripción |
|---|---|
| **Resend invite** | Reenvía el email de invitación vía `inviteUserByEmail` |
| **Generate magic link** | Genera un link de un solo uso que el admin puede copiar y compartir por cualquier canal (WhatsApp, etc.). El link autentica al usuario directamente sin contraseña |

El magic link es válido una sola vez y expira. Se puede regenerar desde el mismo panel.

---

## Flujo completo de onboarding de un nuevo tenant

```
1. Admin crea tenant en /tenants (con admin_email + admin_name)
   → tenant creado en BD
   → role 'Administrador' (type: 'administrative') creado
   → invite email enviado al admin del tenant
   → fila en users con can_do_everything: true

2. Admin del tenant no recibe el email / no lo encuentra:
   → Admin de Nubel va a /tenants/[id]/users
   → Expande el usuario → Generate magic link
   → Comparte el link al usuario por otro canal

3. Usuario abre el magic link → autenticado en app.nubel.tech
   → En pantalla de inicio: PasswordChangeCard
   → Click "¿Entraste por link de invitación?"
   → Establece nueva contraseña sin necesidad de contraseña actual
```

---

## API Routes

### `GET /api/tenants`
Retorna lista para el listado: `id, name, admin_email, created_at, country_iso`.

### `POST /api/tenants`
Crea tenant + opcionalmente el usuario admin. Acepta:
```json
{
  "name": "string",
  "plan_id": "uuid",
  "admin_email": "string|null",
  "admin_name": "string|null",
  "phone": "string|null",
  "city": "string|null",
  "country_iso": "string|null",
  "phone_prefix": "string|null",
  "currency_code": "string|null",
  "timezone": "string|null",
  "logo_url": "string|null"
}
```
Retorna: `{ id, adminCreated: boolean, adminError: string|null }`

### `GET /api/tenants/[id]`
Retorna tenant con stats:
```json
{
  "tenant": { "id", "name", "admin_email", "phone", "city", "plan_id", "feature_overrides", "settings", "logo_url", "created_at" },
  "stats": { "activeUsers", "branches", "lastSale" }
}
```

### `PATCH /api/tenants/[id]`
Campos patchables: `name`, `admin_email`, `phone`, `city`, `plan_id`, `feature_overrides`, `logo_url`.

### `GET /api/tenants/[id]/users`
Retorna usuarios del tenant con rol:
```json
[{ "id", "first_name", "last_name", "email", "is_active", "permissions", "roles": { "id", "name", "type" } }]
```

### `POST /api/tenants/[id]/admin`
Crea usuario admin para un tenant existente. Acepta `{ email, admin_name?, password? }`.
- Sin `password`: flujo invite (email de Supabase)
- Con `password`: crea usuario directamente con `email_confirm: true`
- Rechaza con 409 si ya existe un usuario con `can_do_everything: true`

### `POST /api/tenants/[id]/users/[userId]/resend`
Acciones de registro para un usuario existente. Acepta `{ action: 'invite' | 'magic_link' }`:
- `invite`: reenvía email de invitación
- `magic_link`: retorna `{ link }` — URL de un solo uso para autenticación directa

---

## Shared lib: `createAdminUserForTenant`

**Archivo:** `lib/createAdminUser.ts`

Función compartida usada tanto por `POST /api/tenants` como por `POST /api/tenants/[id]/admin`.

```ts
createAdminUserForTenant({
  tenantId: string,
  email: string,
  adminName?: string,   // "Juan Pérez" → first_name: "Juan", last_name: "Pérez"
  password?: string,    // si se provee → createUser; si no → inviteUserByEmail
})
```

Secuencia interna:
1. INSERT `roles` con `type: 'administrative'` (valor canónico; excluido del picker de staff que filtra `type = 'operative'`)
2. `inviteUserByEmail` o `createUser` según `password`
3. Si el email ya existe en `auth.users` → reutiliza el UUID existente
4. INSERT `users` con `can_do_everything: true`, `wage_type: 'monthly'`
5. Rollback del role si algo falla en pasos posteriores

---

## Configuración de Supabase requerida

Para que los redirects de magic links e invitaciones funcionen correctamente, en **Supabase → Authentication → URL Configuration** deben estar registradas todas las URLs de los ambientes:

| URL | Propósito |
|---|---|
| `http://localhost:3000/**` | Desarrollo local |
| `https://nubelsaas-qa.vercel.app/**` | QA |
| `https://app.nubel.tech/**` | Producción |
| `https://app.nubel.tech/reset-password` | Reset de contraseña en producción |

El **Site URL** debe ser `https://app.nubel.tech`. Si el `redirectTo` no coincide con alguna URL permitida, Supabase ignora el parámetro y usa el Site URL.

La variable `MAIN_APP_URL` en `.env.local` de nubel-admin controla el `redirectTo` de todos los links generados.

---

## Columnas que NO existen en `tenants`

La tabla `tenants` **no tiene**: `is_active`, `slug`, `contact_email`, `plan` (text). No agregar queries con esos campos.

---

## Archivos

| Archivo | Rol |
|---|---|
| `app/(admin)/tenants/page.tsx` | Listado con búsqueda y agrupación por país |
| `app/(admin)/tenants/[id]/page.tsx` | Detalle: stats, logo, form edición |
| `app/(admin)/tenants/[id]/users/page.tsx` | Gestión de usuarios del tenant |
| `components/tenants/TenantCreateModal.tsx` | Modal de creación |
| `app/api/tenants/route.ts` | GET lista · POST crear tenant (+admin) |
| `app/api/tenants/[id]/route.ts` | GET detalle+stats · PATCH campos |
| `app/api/tenants/[id]/users/route.ts` | GET usuarios con roles |
| `app/api/tenants/[id]/admin/route.ts` | POST crear admin en tenant existente |
| `app/api/tenants/[id]/users/[userId]/resend/route.ts` | POST resend invite · magic link |
| `lib/createAdminUser.ts` | Shared: crea role + auth user + users row |
