# Walkthrough: Tipo de rol admin canónico + dedup de roles en clone

**Fecha:** 2026-06-19

---

## Problema

Al crear un tenant en nubel-admin con datos de administrador, `createAdminUserForTenant` creaba el rol con `type: 'admin'`. Ese valor **no existe en el sistema** — el tipo canónico para roles administrativos es **`administrative`** (ver `nubelsaas/docs/operations/new_tenant.sql`, que siembra `Administrador` y `Recepcionista` como `administrative`).

Además, al **clonar** un tenant para poblar el catálogo, el clone copiaba la tabla `roles` del origen, **duplicando** el rol "Administrador" que ya había sido creado al crear el tenant. Resultado: dos roles "Administrador" en el destino.

---

## Causa raíz

1. **Valor de tipo incorrecto:** `type: 'admin'` en `lib/createAdminUser.ts`. Valores canónicos de `roles.type`:
   - `administrative` → Administrador, Recepcionista, Auxiliar
   - `operative` → Estilista, Manicurista, Asistente (staff que aparece en pickers de comisiones/POS)
   - `support` → Personal de apoyo

   Funcionalmente `admin` no rompía el login (que va por `permissions.can_do_everything`, no por el tipo de rol), pero es incorrecto y podría romper lógica futura que filtre por `type === 'administrative'`.

2. **Clone sin conciencia del rol bootstrap:** El clone ya excluía al **usuario** admin bootstrap del check de vacío (`app/api/clone/check-target/route.ts` hace `.neq('email', adminEmail)` sobre `users`), pero **no** aplicaba la misma lógica al **rol** admin → lo duplicaba.

---

## Cambios

### A1 — `lib/createAdminUser.ts`
`type: 'admin'` → `type: 'administrative'`.

### A2 — `app/api/clone/stream/route.ts`
Nuevo set `DEDUP_BY_NAME = new Set(['roles'])`. En `runOnboarding`:
- Al construir los ID maps, para las tablas de dedup se cargan los roles del **origen** y del **destino**. Si el destino ya tiene un rol con el mismo `name`, el id del rol origen se mapea al id existente del destino (`merged`) en vez de generar un UUID nuevo.
- En la inserción, las filas `merged` no se re-insertan; sus FK (`commission_rules.role_id`, `users.role_id`) ya apuntan al rol existente vía el idMap.
- El log muestra `(N merged)` cuando ocurre.

Esto hace que `roles` se comporte igual que `users`: el admin bootstrap se reconoce como pre-existente y no se duplica.

### B — Datos del tenant `4a3fc384` (producción)
```sql
UPDATE roles SET type = 'administrative'
WHERE id = 'a3b66339-6049-4435-a26f-4b3a9567a020';   -- rol del superadmin

DELETE FROM roles WHERE id = 'c7bcb0b4-f15c-4147-9225-f534f03fa4c6';  -- duplicado del clone (0 users, 0 comm_rules)
```
Aplicado en transacción con guard previo (verificó 0 referencias antes del DELETE). Resultado: un solo "Administrador" (`administrative`) con el superadmin enganchado.

---

## Estado final del superadmin

| Campo | Valor |
|---|---|
| `permissions.can_do_everything` | `true` |
| rol | "Administrador" |
| `roles.type` | `administrative` (canónico) |

Correcto en ambas dimensiones: tipo de rol canónico + permisos.

---

## Formalización del `type` (prevención de raíz)

El bug nació de un **magic string** (`'admin'`) tecleado a mano. Para que no se repita, dos guardianes:

**1. BD — CHECK constraint (nubelsaas)**
`supabase/migrations/20260619000002_roles_type_check_constraint.sql`:
```sql
ALTER TABLE public.roles ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.roles ADD CONSTRAINT roles_type_check
  CHECK (type IN ('operative', 'administrative', 'support'));
```
Verificado: un `INSERT` con `type='admin'` ahora es **rechazado** por la BD. Aplicado a producción vía `apply-sql.mjs`.

**2. Código — constante única (nubel-admin)**
`lib/roleTypes.ts` expone `ROLE_TYPES` + tipo `RoleType`. `createAdminUser.ts` usa `ROLE_TYPES.ADMINISTRATIVE` en vez del literal.

> **Decisión arquitectónica:** se evaluó globalizar la tabla `roles` (como `expense_categories`) y se **descartó** — `roles` tiene config financiera per-tenant colgada del `role_id` (`commission_rules`) y nombres de negocio per-tenant que deben ser traducibles (multi-lengua). El `type` es el único concepto verdaderamente global, y se formalizó con el CHECK sin romper lo per-tenant.

## Secuela: superadmin enviado a `/staff-app` (mismo origen)

**Síntoma:** el superadmin del tenant entraba y era redirigido a `/staff-app`, sin acceso al menú.

**Causa:** sus `permissions` en BD habían sido sobrescritos con el template **operativo** (`can_use_staff_app: true`, `can_do_everything: false`) → el `RouteGuard` lo trató como usuario solo-staff. Ese template salía de `StaffModal.handleRoleChange`, que decidía por **`roleName.includes('admin')`** (nombre). Como el rol tenía el `type` inválido `'admin'` y/o el matcheo por nombre es frágil, el admin cayó al template operativo.

**Fix de datos (producción):** `UPDATE users SET permissions = permissions || '{"can_do_everything": true, "can_use_staff_app": false}'` para el user `17b2879e`. (Requiere re-login: el `useAuthStore` recarga permisos al inicializar.)

**Hardening (nubelsaas):** `StaffModal.handleRoleChange` ahora decide el template por **`roles.type`** (no por nombre). Un rol `administrative` nunca cae al template operativo; el default administrativo es acceso total. Ver `staff_rules.md §7.2.1`.

> Durante este fix se detectó que `StaffModal.tsx` tenía un **refactor a layout con tabs sin commitear** (de otra sesión) que removió el botón X del header y movió el selector de rol a la tab "Rol y Accesos". Se adaptaron los tests `STF-00c` y `STF-04` a ese layout y se corrigieron los `type` inválidos del fixture (`admin`/`professional` → `administrative`/`operative`).

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `lib/createAdminUser.ts` | `type: 'admin'` → `ROLE_TYPES.ADMINISTRATIVE` |
| `lib/roleTypes.ts` | **Nuevo** — `ROLE_TYPES` + `RoleType` (fuente única) |
| `app/api/clone/stream/route.ts` | Dedup de `roles` por nombre en `runOnboarding` |
| `nubelsaas/supabase/migrations/20260619000002_…` | **Nuevo** — CHECK + NOT NULL en `roles.type` |
| `nubelsaas/src/components/staff/StaffModal.tsx` | `handleRoleChange` decide template por `roles.type` |
| `nubelsaas/src/components/staff/__tests__/StaffModal.test.tsx` | Fixture con tipos canónicos + tests adaptados a tabs |
| `nubelsaas/docs/database/schema.md` · `staff_rules.md` | Taxonomía, constraint y template por tipo |
| (datos) `roles` + `users.permissions` del tenant `4a3fc384` | Fix de tipo, borrado de duplicado, restauración de `can_do_everything` |
