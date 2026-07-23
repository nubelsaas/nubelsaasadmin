# Clone Tenant

**Ruta:** `/clone`  
**Archivos:** `app/(admin)/clone/page.tsx` · `app/api/clone/stream/route.ts`  
**Tipo:** Client Component + SSE API Route

---

## Propósito

Herramienta para crear nuevos tenants a partir de uno existente. Tiene tres modos de operación:

| Modo (`mode=`) | Caso de uso | Qué hace |
|---|---|---|
| `onboarding` | Nuevo cliente comienza a operar | Copia estructura/catálogo |
| `demo` | Demostración y entrenamiento | Copia estructura + genera 3 meses de datos sintéticos |
| `rollback` | Deshacer una clonación | Borra todo el contenido del tenant destino |

---

## UX general — Streaming en vivo

Todos los modos usan **Server-Sent Events (SSE)**. La UI recibe cada línea en tiempo real y la muestra en un panel tipo terminal, sin necesidad de refrescar la página. El botón activo muestra un estado de "en progreso" mientras el stream está abierto.

### Colores del log

| Prefijo | Color | Significado |
|---|---|---|
| `✅` | verde | Completado con éxito |
| `❌` | rojo | Error |
| `↩️` | azul cielo | Rollback completado |
| `⚠️` | ámbar | Advertencia |
| `──` / `📅` / `📋` | gris | Separadores de fase |

---

## Modo Onboarding

### Tablas copiadas (8)
```
branches · roles · product_categories
payment_accounts · commission_rules · products_services
service_recipes · branch_stock
```

> **`expense_categories` no se clona.** Desde 2026-06-18 las categorías de gastos son globales (`tenant_id IS NULL`) y todos los tenants las comparten via RLS. El tenant destino las hereda automáticamente sin necesidad de copiarlas.

### Transforms aplicados
| Dato | Transformación |
|---|---|
| Todos los `id` | Nuevo UUID generado — nunca se reusan IDs del origen |
| `tenant_id` | Cambia al tenant destino |
| FK entre tablas copiadas | Se remapea al nuevo UUID del registro referenciado |
| `products_services.price` | +2 (marca visual para distinguir datos de demo) |
| `products_services.cost_price` | +2 |
| `branch_stock.current_stock` | 0 (default) o valor real si se activa "Copy stock values" |

### Por qué los IDs se regeneran siempre
Los UUIDs son únicos en la BD. Si se copian los mismos IDs del origen:
- Conflicto de PK si el destino ya tiene algún registro
- FK cruzadas entre tenants

La regeneración + remapping de FKs garantiza aislamiento completo.

### Dedup de `roles` por nombre

Todo tenant se crea con un rol "Administrador" (`type: 'administrative'`) bootstrap junto a su superadmin. Para no duplicarlo al clonar, `roles` se **deduplica por nombre** (`DEDUP_BY_NAME` en `runOnboarding`):

- Si el destino ya tiene un rol con el mismo `name`, el id del rol origen se **mapea al rol existente** (no se genera UUID nuevo ni se inserta fila).
- Las FK que apuntan a ese rol (`commission_rules.role_id`, `users.role_id`) se remapean al rol existente.
- El log muestra `(N merged)` cuando ocurre.

Esto refleja la misma lógica con la que `check-target` ya excluye al **usuario** admin bootstrap del chequeo de vacío. Ver walkthrough `20260619_admin_role_type_and_clone_dedup.md`.

### Orden de inserción (topológico)
```
L0: branches · roles · product_categories
L1: payment_accounts · commission_rules · products_services
L2: service_recipes · branch_stock
```
Cada nivel solo se inserta después de que sus padres existen, para respetar FK constraints.

---

## Modo Demo Seed

### Fase 1 — Onboarding extendido
Copia las 9 tablas del Onboarding más `users` (staff del tenant origen).

**Obfuscación de usuarios — regla permanente:**
| Campo | Valor en destino |
|---|---|
| `first_name` | "Usuario" |
| `last_name` | índice secuencial (1, 2, 3…) |
| `email` | `usuario-{uuid[0:8]}@demo.test` (único garantizado) |
| `phone` / `alias` | null |
| `document_number` / `document_type` | null (dato personal — nunca se copia) |
| `pos_pin` | null (PIN de seguridad — se resetea) |
| Permisos, comisiones, salario, branch, role | Se copian sin cambios |

Los usuarios clonados tienen **UUID nuevo** → no existe entry en `auth.users` → **no pueden iniciar sesión**. Para que el tenant clonado sea usable, el flujo ahora **exige crear un superadmin nuevo** (ver §"Superadmin obligatorio del clon"). Los staff clonados siguen siendo solo datos de relleno (Staff/Nómina/ventas) y nunca son cuentas de login.

### Fase 2 — 50 clientes mock
Se crean 50 clientes con nombres ficticios en español. Los clientes reales **nunca se copian** (dato crítico de privacidad — regla permanente).

### Fase 3 — 3 meses de datos sintéticos
Para los 3 meses calendario completos inmediatamente anteriores a hoy:

**Por cada día laboral (L–S) de cada sucursal:**
- 1 turno de caja cerrado (08:00–19:30)
- ~2 ventas distribuidas aleatoriamente (objetivo: 50 ventas/mes en total)
  - Producto: servicio aleatorio del catálogo
  - Estilista: usuario activo de esa sucursal con `can_receive_commissions = true`
  - Cliente: uno de los 50 mocks aleatorio
  - `generated_commission` → calculado por el trigger de BD al hacer INSERT
  - 1 pago de transacción vinculado (`transaction_payments`)
  - 1 movimiento contable de entrada (`account_balance_entries`, `entry_type = 'pos_income'`)

**Al final de cada mes:**
- 1 gasto por cada categoría de gasto activa (montos por tipo: OPEX Fijo $200k–600k, COGS $100k–400k, Otros $50k–300k) + movimiento contable de salida
- 1 registro de asistencia por empleado (mes completo, ~22 días, `status: 'approved'`)
- 1 nómina por empleado (`status: 'paid'`):
  - `total_gross_commissions` = SUM exacto de `generated_commission` post-trigger
  - `net_to_pay` = comisiones + pago de asistencia (según `wage_type`)

### Por qué las nóminas cuadran con las ventas
1. Se insertan las ventas → el trigger de BD calcula `generated_commission` automáticamente
2. Se hace SELECT de los totales por estilista (post-trigger)
3. Las nóminas usan esos totales exactos — no se duplica la lógica de comisiones

### Cobertura de módulos del app principal

| Módulo | Datos generados |
|---|---|
| Dashboard | Ventas de 3 meses + métricas |
| Ventas (POS) | `sales` + `transaction_payments` + `cash_register_shifts` |
| Clientes | 50 mocks navegables |
| Cuentas | `account_balance_entries` (ingresos + gastos) |
| Gastos | `expenses_purchases` por categoría |
| Staff | Usuarios con roles y comisiones (obfuscados) |
| Nómina | `payrolls` + `attendance_records` por mes |

---

## Modo Rollback

### Cuándo se activa

**Automático:** si cualquier operación de Onboarding o Demo Seed lanza una excepción, el `catch` del route handler llama a `rollback()` antes de cerrar el stream. El usuario ve el progreso del rollback en el mismo log terminal.

**Manual (Undo clone):** después de una clonación exitosa, aparece en la UI un banner ámbar con el botón **"Undo clone"**. Al hacer click, envía `mode=rollback` al endpoint con solo el `target`. La UI muestra el mismo streaming en vivo.

### Algoritmo

Borra todas las filas del tenant destino en orden topológico inverso (hijos antes que padres), respetando FK constraints:

```
transaction_payments → tips → sales
→ expenses_purchases → inventory_movements → payroll_advances_loans
→ payrolls → attendance_records → bonification_records
→ account_balance_entries → period_locks → customer_advances
→ cash_register_shifts → customers
→ service_recipes → branch_stock
→ products_services → commission_rules → payment_accounts → users
→ branches → roles → product_categories
```

> **`expense_categories` excluida del rollback.** Las categorías son globales — no fueron creadas por el clone y nunca deben borrarse.

```
```

Cada tabla se borra con `DELETE WHERE tenant_id = targetId`. El registro del tenant en la tabla `tenants` **no se toca** — el tenant queda vacío pero existe.

### Garantías
- Si un tenant estaba vacío antes del clone y algo falla, el rollback lo deja vacío de nuevo
- No borra datos de ningún otro tenant (filtro estricto por `tenant_id`)
- Si el rollback mismo falla en alguna tabla, continúa con las siguientes (sin abortar)

### Compatibilidad con el guard de superadmin (`trg_guard_last_superadmin`)
La BD de nubelsaas tiene un trigger que **aborta** cualquier borrado/actualización que deje al tenant **sin superadmin activo** mientras el tenant exista (sin bypass de sesión). Un `DELETE FROM users` masivo abortaría entero si intentara borrar al último superadmin.

Por eso el rollback **conserva exactamente un guardián**:
1. Preferentemente el **admin real** (usuario con `email = tenants.admin_email` que sea superadmin activo).
2. Si no existe (p. ej. un Demo Seed viejo cuyo `admin_email` no matchea a nadie), conserva **cualquier** superadmin activo y emite `⚠️` indicando que para vaciar del todo hay que **borrar el tenant** (el cascade desde `tenants` sí está exento del guard).

> El superadmin que crea el flujo de clone queda registrado en `tenants.admin_email`, así que en clones nuevos el rollback siempre preserva al admin real y elimina todo el resto (incluidos los staff demo con `can_do_everything`).

---

## Validación del tenant destino

Antes de iniciar cualquier clone, la UI verifica que el tenant destino esté completamente vacío consultando:
- `branches` · `users` · `products_services` · `sales`

Si cualquiera tiene filas, el clone se bloquea con error visual en la UI (no llega al servidor).

---

## Superadmin obligatorio del clon

Tras un clone (Onboarding **o** Demo Seed), el tenant destino **no tiene ningún usuario con login**: los staff clonados están ofuscados y sin identidad de auth. Por eso ambos modos **exigen crear un superadmin nuevo** antes de poder ejecutar.

### Regla de email — identidad nueva y exclusiva
El email del superadmin **no puede existir ya en `auth.users`**. Un email en Supabase Auth es único a nivel global y mapea a **un solo** perfil/tenant (`self_heal_user_profile` resuelve el tenant por email en el login). Reusar un email ya registrado ataría un mismo login a dos tenants, lo cual el modelo no permite. Por eso se exige un email **nuevo**.

| Capa | Mecanismo |
|---|---|
| UI (feedback en vivo) | `GET /api/clone/check-admin-email?email=` → `{ available, reason }` (debounced 400ms). El botón de inicio se bloquea si el email no está disponible. |
| Servidor (autoridad) | `createAdminUserForTenant({ requireNew: true })` rechaza si el email ya está en `auth.users` (HTTP 409). |

### Dos modos de creación (igual que `tenants/[id]/users`)
| Modo | Qué hace |
|---|---|
| `invite` (default) | Envía email de invitación; el admin define su propia contraseña. |
| `manual` | Crea con contraseña directa (mín. 8 caracteres, confirmada). No se envía email. |

### Orquestación
La creación corre **después** de que el clone termina con éxito, desde la UI, vía `POST /api/tenants/{target}/admin` con `require_new: true`. El resultado se muestra en el mismo log terminal:
- `✅ Superadmin invited/created …` → el banner "Undo clone" aparece (clone completo).
- `❌ Superadmin creation failed …` → el dato quedó sembrado pero sin admin; se sugiere "Undo clone" o reintentar desde Tenants → Users. El clone **no** se marca como completado.

El superadmin se crea con rol `Administrador` (`type: administrative`) y `permissions.can_do_everything = true`. El rol se deduplica por nombre con el rol clonado (misma lógica `DEDUP_BY_NAME`).

---

## Flujo de la UI paso a paso

```
1. Seleccionar modo (Onboarding / Demo Seed)
2. Buscar tenant origen (debounced 300ms)
3. Buscar / crear tenant destino → validación de vacío
4. [Onboarding only] Checkbox "Copy real stock values"
5. **Definir el superadmin nuevo** (obligatorio): email (validado disponible en vivo),
   nombre, modo invite/manual + contraseña. El botón de inicio se bloquea hasta que sea válido.
6. Click "Start Onboarding" / "Start Demo Seed"
   → botón pasa a estado "Setting up…" / "Seeding…"
   → log terminal recibe líneas en tiempo real (SSE)
   → al finalizar el seed, la UI crea el superadmin y loguea el resultado
   → al terminar con ✅ aparece banner ámbar "Undo clone"
   → al terminar con ❌ el rollback corre automáticamente en el mismo log

7. [Opcional] Click "Undo clone" en el banner ámbar
   → botón pasa a "Undoing…" (running = true)
   → el log muestra cada tabla borrada con su count
   → al finalizar con ↩️ el banner desaparece
```

---

## Seguridad

- Auth check: session activa requerida (middleware + route handler)
- Admin check: el usuario debe existir en `admin_superadmins`
- `mode=rollback` solo requiere `target` (no `source`) — no puede afectar al tenant origen
- Los datos reales de clientes **nunca** se transfieren (regla de negocio permanente)

---

## API — parámetros del endpoint SSE

`GET /api/clone/stream`

| Param | Requerido | Valores |
|---|---|---|
| `target` | siempre | UUID del tenant destino |
| `source` | excepto rollback | UUID del tenant origen |
| `mode` | siempre | `onboarding` · `demo` · `rollback` |
| `copyStock` | no | `1` para copiar stock real (solo Onboarding) |

### Endpoints auxiliares del superadmin

`GET /api/clone/check-admin-email?email=` → `{ available: boolean, reason: string|null }`. Verifica que el email no exista en `auth.users`. Solo superadmin.

`POST /api/tenants/{id}/admin` → crea el superadmin del tenant. Body: `{ email, admin_name, password|null, require_new }`. Con `require_new: true` rechaza emails ya registrados (HTTP 409). Reusa el helper `lib/createAdminUser.ts`.

---

## Archivos relacionados

| Archivo | Rol |
|---|---|
| `app/(admin)/clone/page.tsx` | UI: modos, búsqueda, **sub-formulario superadmin**, log terminal, banner Undo |
| `app/api/clone/stream/route.ts` | Lógica: Onboarding, Demo Seed, Rollback (SSE) |
| `app/api/clone/check-admin-email/route.ts` | Verifica disponibilidad del email del superadmin |
| `app/api/tenants/[id]/admin/route.ts` | Crea el superadmin (acepta `require_new`) |
| `lib/createAdminUser.ts` | Helper: rol + auth user + perfil; opción `requireNew` |
| `lib/countries.ts` | `countryLabel`, `groupByCountry`, `COUNTRIES` config |
| `lib/supabaseAdmin.ts` | Cliente service role para todos los writes |
| `app/api/tenants/route.ts` | POST para crear tenant nuevo desde la UI |
| `app/api/plans/route.ts` | GET planes disponibles (usado en modal de creación) |
