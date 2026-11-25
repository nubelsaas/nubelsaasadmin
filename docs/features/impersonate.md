# Impersonate

**Ruta:** `/impersonate`  
**Archivo:** `app/(admin)/impersonate/page.tsx`  
**Tipo:** Client Component

---

## Propósito

Permite a un superadmin iniciar sesión como cualquier usuario del app principal sin conocer su contraseña. Útil para soporte, debugging y demostraciones.

---

## Límites

- Hay que escribir un **motivo** (diálogo, mínimo 5 caracteres); queda en `admin_audit_logs`.
- **Dura 60 minutos** (`SUPPORT_SESSION_MINUTES` en `lib/impersonation.ts`). Después Auth no la renueva. Se puede cerrar antes con **End**.
- Solo usuarios de un tenant. Rechaza emails que no estén en `users` (`404`) y admins del portal (`403`), porque entrar como ellos daría sus permisos sin su MFA.
- Lo que se hace en la sesión queda en `audit_log` del app a nombre del usuario **y** con el admin en `impersonated_by` / `impersonated_by_email` (ver abajo).
- **No cubierto:** las rutas del app que escriben `audit_log` con el service role (`/api/staff/create`, `/api/staff/provision`, `/api/staff/reset-password`) no llevan el JWT a la base, así que esas filas no quedan marcadas.

---

## Interfaz

Layout de dos paneles:
- **Panel izquierdo:** búsqueda de tenant → muestra lista de usuarios de ese tenant
- **Panel derecho:** arriba, **Active support sessions**; debajo, los usuarios del tenant elegido. "Sign in as" pide el motivo y entrega el enlace

### Active support sessions

Las sesiones de soporte que siguen vivas en Auth, de todos los salones y admins: usuario, salón, motivo, quién la abrió, cuándo, y cuándo vence. **End** la cierra.

Las sesiones abiertas antes del tope de 60 minutos (2026-11-25) dicen **no time limit**: el app las renovaba sin fin con el refresh token del enlace. Hay que cerrarlas con End.

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
   → admin_cap_support_session: auth.sessions.not_after = ahora + 60 min (si falla, cierra la sesión y no entrega nada)
5. Devuelve MAIN_APP_URL#access_token=…&refresh_token=… y la hora de vencimiento; la pantalla ofrece:
   - "Copy" → copia al clipboard (el link no se muestra en pantalla)
   - "Open in app" → el app principal toma la sesión del fragmento, igual que con un magic link
```

---

## API Route `POST /api/impersonate`

**Archivo:** `app/api/impersonate/route.ts`

Requiere `reason` (mínimo 5 caracteres). Registra `impersonate` en `admin_audit_logs` antes de abrir la sesión. Devuelve `{ link, expiresAt }` (segundos Unix).

## `GET /api/impersonate/sessions`

Sesiones de soporte vivas: filas de `admin_impersonation_sessions` sin `ended_at`, con su estado en Auth (`admin_support_session_status`). Solo superadmin.

## `POST /api/impersonate/sessions/[sessionId]/end`

Registra `impersonate.end` y llama `admin_end_support_session`: borra la fila de `auth.sessions` (y en cascada sus refresh tokens) y guarda `ended_at` / `ended_by_email`. Responde `{ ended, wasLive }`; cerrar dos veces no falla. `404` si no es una sesión de soporte.

Tras End el app ya no puede renovar la sesión y Auth responde que no existe al pedir el usuario. Las consultas directas a la base con el access token ya emitido siguen valiendo hasta que vence (máx. 60 min), porque la base no consulta Auth.

## Atribución en el app principal

Tabla y trigger en el repo nubelsaas: `docs/database/audit_impersonation.sql`.

- `admin_impersonation_sessions`: una fila por sesión de soporte (`session_id` = `auth.sessions.id`, admin, usuario, tenant, motivo, `ended_at`, `ended_by_email`). Solo service role.
- `admin_support_session_status`, `admin_cap_support_session`, `admin_end_support_session`: solo service role, y solo actúan sobre sesiones registradas en esa tabla. No sirven para cerrar ni alargar la sesión normal de un usuario.
- `audit_log.impersonated_by` / `impersonated_by_email`: los llena un trigger `BEFORE INSERT` buscando el claim `session_id` del JWT en esa tabla. Siempre los sobrescribe, así nadie los puede falsear.

Prueba: `tests/e2e/impersonate-e2e.mjs`.

---

## Seguridad

- Solo accesible para superadmins (validado en middleware y en la API route)
- El link no se envía por email ni se muestra en pantalla: solo Copy / Open in app
- **El link entra directo hasta que la sesión vence (60 minutos) y se puede reabrir.** Un magic link era de un solo uso. Tratarlo como una contraseña: no compartirlo, y usar End al terminar
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
