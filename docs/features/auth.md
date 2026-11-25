# Acceso al portal

**Archivos:** `lib/assertSuperadmin.ts` · `app/(admin)/layout.tsx` · `app/mfa/page.tsx` · `app/login/page.tsx`

---

## Qué se exige

Toda página de `(admin)` y toda ruta `/api` pide las tres cosas:

1. **Sesión válida.** Se usa `getUser()`, que valida el token con Supabase. `getSession()` solo lee la cookie: el id de usuario que devuelve se puede falsificar, así que no se usa para autorizar. El middleware sí lo usa, pero solo para redirigir a `/login`.
2. **Registro en `admin_superadmins`.**
3. **MFA (`aal2`).** Con solo contraseña, las rutas responden `403` y las páginas redirigen a `/mfa`.

`assertSuperadmin()` devuelve `{ user }` o `null`.

---

## MFA

Autenticador TOTP de Supabase. La primera vez, `/mfa` muestra el QR para enrolarse; después pide el código de 6 dígitos en cada inicio de sesión. Cada entorno tiene su propio `auth.users`, así que hay que enrolarse en DEV y en PROD por separado.

**Antes de desplegar:** confirmar en Supabase → Authentication → Multi-Factor que TOTP está activo en PROD. Si no, nadie puede enrolarse ni entrar al portal.

**Teléfono perdido** (verificado en DEV con `tests/e2e/mfa-recovery-e2e.mjs`):

```bash
node scripts/reset-mfa.mjs <email> .env.dev.local   # DEV
node scripts/reset-mfa.mjs <email> .env.local       # PROD: pide escribir la referencia del proyecto
```

- Solo actúa sobre usuarios de `admin_superadmins`. Registra `admin.mfa_reset` en `admin_audit_logs` antes de borrar (`admin_email` = `script:<usuario del sistema>`); si no puede registrar, no toca nada.
- Al entrar de nuevo con la contraseña, el portal manda a `/mfa`, que muestra un QR nuevo. Los códigos del autenticador perdido dejan de servir.
- Equivale a borrar el factor en Supabase → Authentication → Users, que sigue sirviendo si no hay una terminal a mano.
- **Las sesiones abiertas siguen vivas** hasta que vencen: borrar el factor no cierra sesión. Para un teléfono perdido no importa. **Si se sospecha que la cuenta está comprometida**, el corte inmediato es borrar a la persona de `admin_superadmins`: `assertSuperadmin()` lo consulta en cada pedido. Después, cambiar la contraseña y volver a agregarla.
