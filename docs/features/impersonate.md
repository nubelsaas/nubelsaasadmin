# Impersonate

**Ruta:** `/impersonate`  
**Archivo:** `app/(admin)/impersonate/page.tsx`  
**Tipo:** Client Component

---

## Propósito

Permite a un superadmin iniciar sesión como cualquier usuario del app principal sin conocer su contraseña. Útil para soporte, debugging y demostraciones.

---

## Límites

- Hay que escribir un **motivo**; queda en `admin_audit_logs`.
- Solo usuarios de un tenant. Rechaza emails que no estén en `users` (`404`) y admins del portal (`403`), porque entrar como ellos daría sus permisos sin su MFA.
- Lo que se hace en la sesión queda en `audit_log` del app a nombre del usuario **y** con el admin en `impersonated_by` / `impersonated_by_email` (ver abajo).
- **No cubierto:** las rutas del app que escriben `audit_log` con el service role (`/api/staff/create`, `/api/staff/provision`, `/api/staff/reset-password`) no llevan el JWT a la base, así que esas filas no quedan marcadas.

---

## Interfaz

Layout de dos paneles:
- **Panel izquierdo:** búsqueda de tenant → muestra lista de usuarios de ese tenant
- **Panel derecho (o inline):** al hacer click en "Sign in as", se genera y muestra un magic link

---

## Flujo completo

```
1. Buscar tenant (debounced 300ms, ilike por nombre)
2. Seleccionar tenant → carga usuarios activos del tenant
   → supabase.from('users').select('id, first_name, last_name, email').eq('tenant_id', t.id).eq('is_active', true)
3. Click "Sign in as [usuario]"
   → POST /api/impersonate  { email: usuario.email }
4. La API abre la sesión en el servidor (lib/impersonation.ts):
   generateLink → verifyOtp con el token_hash → lee session_id del JWT
   → lo guarda en admin_impersonation_sessions (si falla, cierra la sesión y no entrega nada)
5. Devuelve MAIN_APP_URL#access_token=…&refresh_token=… y la pantalla ofrece:
   - "Copy" → copia al clipboard (el link no se muestra en pantalla)
   - "Open in app" → el app principal toma la sesión del fragmento, igual que con un magic link
```

---

## API Route `POST /api/impersonate`

**Archivo:** `app/api/impersonate/route.ts`

Requiere `reason` (mínimo 5 caracteres). Registra `impersonate` en `admin_audit_logs` antes de abrir la sesión.

## Atribución en el app principal

Tabla y trigger en el repo nubelsaas: `docs/database/audit_impersonation.sql`.

- `admin_impersonation_sessions`: una fila por sesión de soporte (`session_id` = `auth.sessions.id`, admin, usuario, tenant, motivo). Solo service role.
- `audit_log.impersonated_by` / `impersonated_by_email`: los llena un trigger `BEFORE INSERT` buscando el claim `session_id` del JWT en esa tabla. Siempre los sobrescribe, así nadie los puede falsear.

Prueba: `tests/e2e/impersonate-e2e.mjs`.

---

## Seguridad

- Solo accesible para superadmins (validado en middleware y en la API route)
- El link no se envía por email ni se muestra en pantalla: solo Copy / Open in app
- **El link entra directo mientras el access token sea válido (~1 hora) y se puede reabrir.** Un magic link era de un solo uso. Tratarlo como una contraseña: no compartirlo
- Cada link generado queda en `admin_audit_logs` (acción `impersonate`, ver `docs/features/audit.md`)

---

## Variables de entorno requeridas

| Variable | Uso |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Necesaria para `auth.admin.generateLink` |
| `MAIN_APP_URL` | Redirect destino del magic link (server-side) |
| `NEXT_PUBLIC_MAIN_APP_URL` | Para el botón "Open in app" (client-side) |

---

## Archivos relacionados

- `app/(admin)/impersonate/page.tsx`
- `app/api/impersonate/route.ts`
