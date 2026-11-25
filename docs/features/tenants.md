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
- **Búsqueda** por nombre o correo de contacto, sin distinguir tildes ni mayúsculas. Varias palabras deben aparecer todas. Un `%` o `_` es texto, no comodín.
- **Filtros:** plan (o sin plan), estado (activo / suspendido), país (o sin país), salud y **Needs attention**, y arranque (**Setup incomplete** / **Stuck**, ver *Setup* en el detalle).
- **Insignia de arranque:** `Stuck 3/5` (ámbar) o `Setup 6/7` (gris, solo desde `sm`) en los salones sin terminar; el título dice el paso que falta. La da `GET /api/tenants/onboarding`, que llega aparte como la salud.
- **Orden:** nombre A–Z, más nuevos o más antiguos. Dentro de cada país se respeta el orden elegido.
- **Agrupación por país** con emoji flags, y contador "N of M tenants".
- **Los filtros viven en la URL** (`?q=&plan=&status=&country=&health=&setup=&sort=`): al volver desde un salón la lista sigue filtrada, y se puede compartir el enlace. **Clear filters** los quita.
- **Crear nuevo tenant** — botón "New" abre el `TenantCreateModal`

La lista y los filtros salen de `lib/tenantFilters.ts` (probado en `tests/tenantFilters.test.mjs`). La API `GET /api/tenants?search=` usa la misma búsqueda, así que la del encabezado (`AdminHeader`) también encuentra por correo.

**Salud:** `GET /api/tenants/health` devuelve por salón `{ status, needsAttention }`. Es la misma lectura que el dashboard (6 meses de ventas, `lib/tenantHealth.ts`) y tarda más, así que la lista se muestra primero y las insignias aparecen después. Mientras no llega, el filtro de salud muestra "Loading...". **Needs attention** son los avisos altos por salón del dashboard: auditoría apagada, sin dueño activo, o contacto desactivado.

Sin paginación: son pocos salones y se filtran en el navegador. Revisar si pasan de unos cientos.

### Columnas mostradas por tenant
| Campo | Descripción |
|---|---|
| `name` | Nombre del tenant |
| `admin_email` | Correo de contacto del salón (ver abajo) |
| Plan | Nombre del plan (`plan_id` → `subscription_plans.name`) |
| Salud | Insignia de estado y **Needs attention** (ver arriba) |
| `created_at` | Fecha formateada en inglés (oculta en mobile) |
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
| Logo | — | Imagen PNG/JPG/WebP, máx 2 MB (lo valida el servidor; SVG no, puede llevar scripts). Se sube a Storage antes del POST |

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
| Last sale | `date_time` de la transacción más reciente en `transactions` | — |

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
| Country | `country_iso` |
| Currency | `currency_code` — derivada del país, `readOnly` en la UI |
| Timezone | `timezone` — derivada del país, `readOnly` en la UI |
| Phone prefix | `phone_prefix` — derivado del país, `readOnly` en la UI |

Todos vía `PATCH /api/tenants/[id]` (service role).

**Región bloqueada:** con movimientos en `transactions`, `expenses_purchases` o `account_balance_entries`, cambiar país, moneda, zona horaria o prefijo responde `409` y el selector queda deshabilitado (`lib/regionLock.ts`). Corregirlo en un salón con datos es una operación manual, con plan de conversión.

> **Este panel es la ÚNICA superficie de la configuración regional del tenant.** País, moneda, zona
> horaria y prefijo telefónico definen la constitución del tenant (cambiar la moneda de un salón con
> ventas históricas corrompe los importes ya registrados; la zona horaria mueve el corte de día de
> toda la contabilidad), así que no se editan desde el app del salón. Al elegir el país, los otros
> tres se derivan de `COUNTRY_DEFAULTS` y viajan juntos en el mismo PATCH — si se agrega un país
> nuevo hay que darle las cuatro claves. Ver `nubelsaas/docs/plans/20260922_settings_region_a_nubel_admin_plan.md`.

### Quick links

Botones de acceso rápido a: Feature Flags, Impersonate, Clone, Audit log, Open app.

### Setup (arranque del salón)

Tarjeta **Setup** debajo de los quick links (`components/tenants/OnboardingCard.tsx`): qué pasos ya hizo el salón, con lo que se encontró o qué falta. Abierta mientras falte algo; cerrada cuando está completa.

| Paso | Hecho cuando | Notas |
|---|---|---|
| Owner signed in | Un dueño activo (`can_do_everything`) tiene `last_sign_in_at` en Auth | Auth guarda solo el último ingreso, no el primero |
| Services added | `products_services` con `type = 'service'` y `is_active` | Retail e insumos no cuentan |
| Payment methods set up | `payment_accounts` activa | Un salón nuevo no trae ninguna: sin esto el POS no registra ventas |
| Team added | Más de un usuario activo | **Opcional**: no cuenta para el progreso (salón de una persona) |
| Customers added | Al menos un `customers` | Se pueden importar de un CSV |
| First appointment | Al menos un `appointments` | Solo si el Scheduler está encendido (override o, si no hay, el plan) |
| Public booking on | `feature_overrides.publicAllowedServices` no vacío | Solo con Scheduler |
| First sale | `transactions` no anulada; la fecha es la más antigua | |

**Stuck:** 14 días o más desde el alta (`created_at`) y todavía sin la primera venta: nunca arrancó. Un salón que vende pero no publicó su agenda está **incompleto**, no atascado.

Reglas en `lib/onboardingRules.ts` (`tests/onboardingRules.test.mjs`), lectura en `lib/onboarding.ts`: solo conteos (`head: true`) y fechas, sin datos de clientes ni de ventas, por eso no se registra como lectura. Rutas: `GET /api/tenants/[id]/onboarding` (detalle) y `GET /api/tenants/onboarding` (resumen de todos para la lista).

### Integraciones

Tarjeta **Integrations** debajo de los quick links (`components/tenants/IntegrationsCard.tsx`). Muestra, para los últimos 30 días, el estado de cada integración según lo que el app principal registra: **Working**, **Check**, **Failing**, **Off** o **N/A** (no existe en esta base). La primera que falla se abre sola con sus errores recientes.

| Integración | Lee | Failing | Check |
|---|---|---|---|
| Email | `notification_jobs` de tipo `*_email_*`, `clientReminders.email`, `admin_email` | Un recordatorio `dead` | Uno reintentando (`last_error` con intentos) |
| WhatsApp | `whatsapp_integrations`, `whatsapp_outbound_messages` | Todas las conexiones caídas, o el último mensaje falló | Fallos anteriores con envíos buenos después |
| Google Calendar | `user_google_tokens` (sin leer tokens), `appointments.google_event_id` | Acceso vencido y sin refresh token: hay que reconectar | Sin refresh token, aún sin vencer |
| Push | `push_devices`, `notification_delivery_log`, `notification_jobs` que no son de email | Un recordatorio al equipo `dead` | Entregas `FAILED`/`REJECTED`, o todas las suscripciones vencidas |

**Límites:** los correos de confirmación, recibo y login no dejan registro, así que sus fallas no aparecen. PROD (`main`) aún no tiene el log de mensajes de WhatsApp ni las columnas de estado de la conexión: la tarjeta lo dice y muestra lo que hay.

Reglas en `lib/integrationRules.ts` (probadas en `tests/integrationRules.test.mjs`), lectura en `lib/integrationHealth.ts`: una tabla o columna inexistente se muestra como N/A, no rompe la tarjeta. Nunca pide `access_token`, `refresh_token`, `verify_token` ni las llaves de push: de `user_google_tokens` solo saber si hay refresh token, con un filtro.

### Exportar datos

Tarjeta **Export data** en el detalle. Pide un motivo y descarga un ZIP con un CSV por tabla y un `LEEME.txt` (`lib/tenantExport.ts`). También funciona con un tenant suspendido, porque solo lee.

- **Lista permitida:** `EXPORT_SPECS` nombra cada tabla y columna; una nueva no sale hasta agregarla. Toda columna debe existir en PROD y en DEV.
- **Fuera:** fotos y adjuntos, números de documento, PIN, datos bancarios y permisos del equipo, clientes eliminados, tokens, audit logs, soporte y asistente.
- **Todo o nada:** cada tabla se compara contra su conteo exacto. Si una falla, responde `500` y no se descarga nada.
- **Sin copias:** el ZIP se arma en memoria y no se guarda. Hay que entregarlo por un canal seguro, nunca como adjunto de correo.

### Suspensión

Tarjeta **Suspension** en el detalle. Pide un motivo, que queda en `admin_audit_logs` y no en el tenant, porque el salón puede leer su propia fila. Escribe `tenants.suspended_at`, que solo puede cambiar nubel-admin.

Un salón suspendido queda de **solo lectura**, incluido su dueño (`trg_block_suspended_writes` en nubelsaas). También se apagan la reserva pública, el bot de WhatsApp, los recordatorios y el alta de staff. El chat de soporte sigue activo. Al reactivar, los recordatorios pendientes vuelven a salir.

Requiere la migración `20261101130000_tenant_suspension.sql` de nubelsaas **antes** de desplegar: sin la columna, las pantallas de tenants fallan.

### Clone template

Tarjeta en el detalle que marca o desmarca el tenant como origen de clones (`feature_overrides.cloneTemplate`). Solo un template puede ser origen, porque el clone copia su catálogo, costos y proveedores. No marcar nunca un salón real.

### Borrar tenant

Tarjeta **Delete tenant** al final del detalle. Hay que escribir el nombre exacto del tenant para confirmar, y no se puede deshacer.

**Solo se borran tenants vacíos.** Se usa el criterio del destino de un clone (`findTargetData`) y además se revisan **todas** las tablas con `tenant_id`, leídas en vivo de la API (`lib/tenantTables.ts`): solo pueden tener filas `users`, `roles`, `audit_log` y `admin_audit_logs`. Si se quedó con datos de un clone, primero usar Undo. `audit_log` no bloquea, y su historial se borra con el tenant.

Al borrar:
- Las FK en cascada eliminan `users`, `roles`, `audit_log` y demás filas del tenant. `trg_guard_last_superadmin` no bloquea porque el tenant ya no existe cuando llega la cascada.
- Se eliminan los logins de `auth.users` de sus usuarios, salvo los que estén en `admin_superadmins`. Si quedaran, el email seguiría ocupado para un admin nuevo. Si alguno falla, el tenant ya se borró y la pantalla lista esos emails.
- `admin_audit_logs` conserva el registro, con el nombre del tenant y la cantidad de usuarios. El logo sigue en el bucket `empresa-logos`.

**Para dejar un salón sin uso sin borrarlo:** usar **Suspension** (arriba). Sus usuarios solo pueden leer hasta reactivarlo.

### Public booking page

Tarjeta con el URL público de reservas del salón: `${NEXT_PUBLIC_MAIN_APP_URL}/book/[tenant_id]` (portal servido por el app principal). Botones de **copiar** y **abrir** en nueva pestaña. Un badge indica si el portal está **Enabled** / **Not enabled** según `feature_overrides.publicAllowedServices` (mismo gate que la RPC `get_public_booking_config` del app: si está vacío, el enlace muestra "Salón no encontrado"). Útil para compartir el enlace de agendamiento con el salón.

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

### Acceso de usuarios

En el panel de cada usuario, con motivo obligatorio (`POST /api/tenants/[id]/users/[userId]/access`). Requiere la migración `20261101150000_service_role_user_admin.sql` de nubelsaas: sin ella, `trg_guard_sensitive_user_fields` rechaza estos cambios.

| Acción | Efecto |
|---|---|
| **Deactivate** | `is_active = false` y bloqueo del login. Sin el bloqueo el usuario seguiría entrando, porque la base de datos no revisa `is_active`. Un token ya emitido dura hasta que venza. Rechaza admins del portal |
| **Reactivate** | Revierte lo anterior |
| **Make owner** | Da `can_do_everything`. No cambia `admin_email`. El dueño anterior conserva el acceso hasta desactivarlo |

**Dueño que se va:** Make owner a otra persona y luego Deactivate. Desactivar al único dueño responde `409`. Si no hay más equipo, **Create admin** agrega otro aunque ya exista uno.

**Desactivar al contacto:** si el usuario desactivado es el `admin_email`, el contacto pasa a otro dueño activo.

### `admin_email` es el correo de contacto, no el login

En el app principal es el destino de las alertas de caja (`cash-alerts`) y el organizador de las invitaciones de citas, y el salón lo edita en Configuración. Puede ser un correo externo, como `info@salon.co`. El portal no lo usa para identificar al dueño: el dueño es quien tiene `can_do_everything`. Al crear un tenant se usa el email del admin como contacto inicial.

El dashboard avisa si falta (no salen las alertas de caja) o si es de un usuario desactivado.

### Un email, un salón

`users.email` es único en toda la base, así que un email solo puede pertenecer a un salón. Crear un admin con un email que ya está en otro salón responde `409` con el nombre de ese salón, antes de crear el rol o enviar la invitación. El cambio de fondo es del app principal: `nubelsaas/docs/plans/multi_tenant_user_membership_plan.md`.

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

### `GET /api/tenants/[id]/integrations`

Estado de email, WhatsApp, Google Calendar y push del salón: `{ level, integrations: [{ key, label, level, summary, details, errors }], generatedAt }`. Registra `view.integrations` (muestra correos del equipo y errores de envío). `404` si el salón no existe.

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
Campos patchables: `name`, `admin_email`, `phone`, `city`, `plan_id`, `logo_url`, región y `is_audit_enabled` (apagarlo exige `audit_reason`). Los JSON van como `feature_overrides_changes` y `settings_changes`: `{ set, remove }`.

### `DELETE /api/tenants/[id]`
Borra un tenant vacío y sus logins. Acepta `{ confirmName }`, que debe coincidir con `name` (400 si no).
- `409` si el tenant tiene datos; `500` si no se pudo verificar. En ambos casos no se borra nada.
- Retorna `{ ok: true, failedLogins: string[] }`.

### `POST /api/tenants/[id]/export`
Descarga el ZIP. Acepta `{ reason: string }`, obligatorio.

### `POST /api/tenants/[id]/suspension`
Suspende o reactiva. Acepta `{ suspended: boolean, reason: string }`; el motivo es obligatorio. Retorna `{ suspended_at }`.

### `GET /api/tenants/[id]/users`
Retorna usuarios del tenant con rol:
```json
[{ "id", "first_name", "last_name", "email", "is_active", "permissions", "roles": { "id", "name", "type" } }]
```

### `POST /api/tenants/[id]/admin`
Crea usuario admin para un tenant existente. Acepta `{ email, admin_name?, password? }`.
- Sin `password`: flujo invite (email de Supabase)
- Con `password`: crea usuario directamente con `email_confirm: true`
- Rechaza con 409 si ya existe un usuario con `can_do_everything: true`, salvo con `additional: true`

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
| `app/(admin)/tenants/page.tsx` | Listado con búsqueda, filtros, orden y agrupación por país |
| `lib/tenantFilters.ts` | Búsqueda, filtros, orden y filtros en la URL |
| `app/api/tenants/health/route.ts` | GET salud por salón para la lista |
| `app/(admin)/tenants/[id]/page.tsx` | Detalle: stats, logo, form edición |
| `app/(admin)/tenants/[id]/users/page.tsx` | Gestión de usuarios del tenant |
| `components/tenants/TenantCreateModal.tsx` | Modal de creación |
| `app/api/tenants/route.ts` | GET lista · POST crear tenant (+admin) |
| `app/api/tenants/[id]/route.ts` | GET detalle+stats · PATCH campos · DELETE tenant vacío |
| `app/api/tenants/[id]/users/route.ts` | GET usuarios con roles |
| `app/api/tenants/[id]/users/[userId]/access/route.ts` | POST desactivar · reactivar · hacer dueño |
| `lib/regionLock.ts` | Bloqueo de región con movimientos |
| `app/api/tenants/[id]/export/route.ts` | POST exportar datos del tenant |
| `lib/tenantExport.ts` | Lista permitida, CSV y ZIP |
| `app/api/tenants/[id]/suspension/route.ts` | POST suspender · reactivar |
| `app/api/tenants/[id]/admin/route.ts` | POST crear admin en tenant existente |
| `app/api/tenants/[id]/users/[userId]/resend/route.ts` | POST resend invite · magic link |
| `lib/createAdminUser.ts` | Shared: crea role + auth user + users row |
