# Walkthrough: Creación de usuario admin al crear tenant + panel de usuarios

**Fecha:** 2026-06-18

---

## Contexto

El flujo de creación de tenants guardaba `admin_email` como dato de contacto pero no creaba ningún usuario. Para que el administrador del tenant pudiera ingresar a nubelsaas necesitaba tres cosas que no existían: un registro en `auth.users`, un `role` y un registro en la tabla `users` con `can_do_everything: true`.

Adicionalmente, la pantalla de detalle del tenant mostraba "Active Users" como stat pero no era accionable, y no existía forma de gestionar usuarios desde nubel-admin.

---

## Bugs corregidos

### 1. POST /api/tenants ignoraba la mayoría de campos

El INSERT original solo guardaba `name`, `admin_email` y `plan_id`. Los campos `logo_url`, `phone`, `city`, `country_iso`, `phone_prefix`, `currency_code` y `timezone` se perdían silenciosamente.

**Fix:** `app/api/tenants/route.ts` — INSERT expandido con todos los campos del body.

### 2. GET /api/tenants/[id]/users seleccionaba `full_name` (columna inexistente)

La tabla `users` tiene `first_name` y `last_name` por separado. El select retornaba `null` para todos los usuarios.

**Fix:** `app/api/tenants/[id]/users/route.ts` — cambiado a `first_name, last_name` + join con `roles(id, name, type)`.

---

## Features implementadas

### Lib compartida: `createAdminUserForTenant`

**Archivo:** `lib/createAdminUser.ts`

Función central usada en dos endpoints. Recibe `{ tenantId, email, adminName?, password? }` y ejecuta en secuencia:
1. INSERT en `roles` con `type: 'admin'` (excluido del picker de staff que filtra `type = 'operative'`)
2. Si `password` → `createUser({ email_confirm: true })` / Si no → `inviteUserByEmail`
3. Si el email ya existe en auth.users → reutiliza el UUID
4. INSERT en `users` con `can_do_everything: true`, `wage_type: 'monthly'`
5. Rollback del role si los pasos posteriores fallan

### Auto-creación de admin al crear tenant

`POST /api/tenants` llama `createAdminUserForTenant` cuando se provee `admin_email`. El tenant se crea siempre; si el admin falla, se retorna `adminCreated: false` + `adminError` pero el tenant existe.

### Campo "Admin name" en TenantCreateModal

Aparece condicionalmente cuando se escribe un `admin_email`. El valor se envía como `admin_name` y se split en `first_name` / `last_name` (primer espacio = punto de corte).

### Nuevo endpoint: POST /api/tenants/[id]/admin

Para tenants ya existentes sin usuario admin. Acepta `{ email, admin_name?, password? }`. Rechaza con 409 si ya existe un usuario con `can_do_everything: true` en ese tenant.

### Stat "Users" como link navegable

En `/tenants/[id]`, la card de "Active users" se convirtió en `<Link href="/tenants/[id]/users">` con hover indigo.

### Nueva página: /tenants/[id]/users

Panel completo de gestión de usuarios del tenant.

**Banner sin admin:**
- Si el tenant tiene `admin_email` guardado → muestra el email con dos botones: "Yes, create admin" (crea directo) y "Use different email" (abre form pre-llenado)
- Si no hay `admin_email` → banner simple con link al formulario

**Formulario de creación con dos modos:**
- `Send invite` — `inviteUserByEmail`, el usuario recibe email para setear su contraseña
- `Create manually` — `createUser` con password definido en el form, sin email enviado

**Acciones por usuario (panel expandible):**
Cada usuario tiene un chevron que expande "Registration actions" con:
- **Resend invite** — reenvía el email de invitación
- **Generate magic link** — genera URL de un solo uso, copyable, para compartir por cualquier canal

### Nuevo endpoint: POST /api/tenants/[id]/users/[userId]/resend

Acepta `{ action: 'invite' | 'magic_link' }`. Resuelve el email del usuario desde la tabla `users` antes de llamar a Supabase.

---

## Fix en nubelsaas: PasswordChangeCard — primera vez sin contraseña

**Archivo:** `src/components/home/PasswordChangeCard.tsx`

**Problema:** Usuarios que entran por magic link no tienen contraseña. El componente llamaba `signInWithPassword` para verificar la contraseña actual antes de actualizar — esa llamada siempre fallaba.

**Fix:** Se agregó estado `isFirstTime` y componente `FirstTimeToggle`. Cuando está activo:
- Se oculta el campo "Contraseña actual"
- Se salta el `signInWithPassword`
- Se llama directamente `supabase.auth.updateUser({ password: newPassword })` (seguro con sesión activa)
- El botón cambia a "Establecer contraseña"

El toggle se activa con el link: *"¿Entraste por link de invitación? Establecer contraseña por primera vez"*

---

## Configuración de URLs (Supabase + entorno)

Se corrigió la URL de producción de `app.nubel.co` a `app.nubel.tech` en todos los archivos:
- `.env.local` (MAIN_APP_URL, NEXT_PUBLIC_MAIN_APP_URL)
- `lib/createAdminUser.ts` (fallback)
- `app/api/tenants/[id]/users/[userId]/resend/route.ts` (fallback)
- `app/api/impersonate/route.ts` (fallback)
- `app/(admin)/tenants/[id]/page.tsx` (link "Open app")

**Regla:** `MAIN_APP_URL` en `.env.local` de nubel-admin determina el `redirectTo` de todos los magic links e invitaciones. Supabase valida que la URL esté en la lista de Redirect URLs permitidas — si no está, usa el Site URL por defecto.

**URLs requeridas en Supabase → Authentication → URL Configuration:**
- `http://localhost:3000/**`
- `https://nubelsaas-qa.vercel.app/**`
- `https://app.nubel.tech/**`
- `https://app.nubel.tech/reset-password`

---

## Archivos creados / modificados

### nubel-admin
| Archivo | Cambio |
|---|---|
| `lib/createAdminUser.ts` | **Nuevo** — función compartida de creación de admin |
| `app/api/tenants/route.ts` | POST expandido: todos los campos + admin creation |
| `app/api/tenants/[id]/admin/route.ts` | **Nuevo** — crear admin en tenant existente |
| `app/api/tenants/[id]/users/route.ts` | Fix full_name + join roles |
| `app/api/tenants/[id]/users/[userId]/resend/route.ts` | **Nuevo** — resend invite / magic link |
| `app/(admin)/tenants/[id]/page.tsx` | Stat "Users" → Link navegable |
| `app/(admin)/tenants/[id]/users/page.tsx` | **Nueva** — panel completo de usuarios |
| `components/tenants/TenantCreateModal.tsx` | Campo "Admin name" condicional |
| `.env.local` | nubel.co → nubel.tech |

### nubelsaas
| Archivo | Cambio |
|---|---|
| `src/components/home/PasswordChangeCard.tsx` | Modo first-time sin contraseña actual |
