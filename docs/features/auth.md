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

**Teléfono perdido:** en Supabase → Authentication → Users, eliminar el factor del usuario. Al entrar, `/mfa` vuelve a enrolar.
