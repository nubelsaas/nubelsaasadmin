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
- **Pendiente en el app principal:** lo que se hace al impersonar queda en `audit_log` a nombre del usuario. Solo `admin_audit_logs` indica que un admin generó el link.

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
4. API genera magic link via Supabase auth.admin.generateLink
5. Link se muestra con dos acciones:
   - "Copy link" → copia al clipboard
   - "Open in app" → abre MAIN_APP_URL con el token en una nueva pestaña
```

---

## API Route `POST /api/impersonate`

**Archivo:** `app/api/impersonate/route.ts`

```typescript
// Genera un magic link que permite iniciar sesión como el usuario
const { data } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: email,
  options: { redirectTo: MAIN_APP_URL },
});
```

El link resultante tiene una vida útil corta (definida por Supabase, típicamente 1 hora).

---

## Seguridad

- Solo accesible para superadmins (validado en middleware y en la API route)
- El magic link se muestra solo en pantalla — no se envía por email al usuario
- El link se puede usar una sola vez
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
