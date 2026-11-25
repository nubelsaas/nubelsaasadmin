# Feature Flags

**Ruta:** `/flags`  
**Archivo:** `app/(admin)/flags/page.tsx`  
**Tipo:** Client Component

---

## Propósito

Activar o desactivar funcionalidades del app principal por tenant. Los flags se almacenan en el campo `feature_overrides` (JSONB) de la tabla `tenants` y son leídos por el app principal al cargar.

---

## Plan y overrides

El plan del tenant define el valor por defecto de cuatro flags: `enableTips`, `enableCustomerAdvancements`, `enableGiftCards` y `enableScheduler` (`subscription_plans.default_features`, equivalencias en `lib/planFeatures.ts`). Una clave en `feature_overrides` gana siempre, y la pantalla la marca como **Override**. **Use plan** la quita al guardar.

`staff_app`, `whatsapp_ia`, `multi_branch` y `electronic_billing` existen en los planes pero aún no tienen efecto: el app no tiene un flag que controlen.

Arriba de los flags, la sección **Plan: <nombre>** lista lo que incluye el plan del salón. Las funciones apagadas en el plan salen tachadas, y las que no tienen flag llevan **no effect yet** (`flagForPlanFeature` en `lib/planFeatures.ts`). Si el salón no tiene plan, lo dice: todos los flags usan su valor por defecto.

Salvo `enableShifts`, que también se lee en SQL, estos flags solo muestran u ocultan funciones en el app.

---

## Interfaz

Layout de dos paneles:
- **Panel izquierdo:** lista de todos los tenants con búsqueda
- **Panel derecho:** toggles de flags para el tenant seleccionado

---

## Flags disponibles

| Flag key | Label | Default |
|---|---|---|
| `enableShifts` | Cash Register Shifts | `true` |
| `enableEmployeeLoans` | Employee Loans & Advances | `false` |
| `enableCustomerAdvancements` | Customer Advances | `false` |
| `enableGiftCards` | Gift Cards | `false` |
| `enableTips` | Tips | `false` |
| `enableCourtesy` | Courtesy Tickets | `false` |
| `enableScheduler` | Scheduler (Agenda) | `false` |

### Flag anidado: `clientReminders` (recordatorios de citas al cliente)
- **Estructura:** objeto por canal en `feature_overrides.clientReminders = { email, whatsapp, sms }`.
- **Sección propia** en la UI ("Client Reminders"), separada de los `BOOL_FLAGS` top-level porque el valor es anidado.
- **Fase 1 — solo Email es activable:**

  | Canal | Key | Default | Estado |
  |---|---|---|---|
  | Email | `clientReminders.email` | `true` (ON) | Activable |
  | WhatsApp | `clientReminders.whatsapp` | `false` | **Bloqueado** (plan independiente) |
  | SMS | `clientReminders.sms` | `false` | **Bloqueado** (requiere proveedor) |

- **Default del Email = ON:** el app principal (nubelsaas) trata la ausencia de la key como `true` (lee `feature_overrides.clientReminders.email !== false`). Por eso el toggle parte de defaultOn y, al apagarlo, persiste `clientReminders.email = false`.
- **Toggles bloqueados:** WhatsApp/SMS se muestran deshabilitados con badge "Blocked"; no son activables en esta fase.
- **Consumidor** (app principal): habilita la pestaña "Recordatorios" en `/settings` y el envío del recordatorio por email. Ver `nubelsaas/docs/business_rules/settings_rules.md §9.A` y `nubelsaas/docs/business_rules/scheduler_rules.md`.

---

## Cómo se guarda

La pantalla envía solo lo que cambió (`feature_overrides_changes` y `settings_changes`, `lib/jsonChanges.ts`), nunca el objeto completo: así no borra lo que el salón escribió mientras estaba abierta. `PATCH /api/tenants/[id]` ya no acepta `feature_overrides` ni `settings` completos. Si el JSON cambió entre leerlo y guardarlo, responde `409` y hay que recargar.

Apagar el Audit Log pide un motivo en un diálogo (mínimo 5 caracteres), que queda en `admin_audit_logs`.

---

## Comportamiento de los flags

```typescript
// Si la key existe en feature_overrides → usar ese valor
// Si NO existe → el valor del plan, si el plan lo define; si no, el defaultOn del flag
function getFlagValue(key: string, defaultOn: boolean): boolean {
  if (key in flags) return Boolean(flags[key]);
  return selectedPlanDefault(key) ?? defaultOn;
}
```

Esto permite que un tenant use el default global sin necesidad de tener la key explícita en su JSONB.

---

## Flujo de datos

### Lectura
```
Selección de tenant → selectTenant(t)
  → lee t.feature_overrides y t.settings (ya cargados con la lista)
  → llena los estados flags y settings
```

La lista de tenants incluye `feature_overrides` en el `select`, así no hay query adicional al seleccionar.

### Escritura
```
Save → handleSave()
  → si se apaga el Audit Log, pide el motivo (diálogo)
  → PATCH /api/tenants/[id]  { feature_overrides_changes, settings_changes, is_audit_enabled, audit_reason }
     (diffJson: solo lo que cambió, como { set, remove })
  → actualiza el estado local con lo que devuelve la API (no recarga)
```

---

## Archivos relacionados

- `app/(admin)/flags/page.tsx`
- `app/api/tenants/[id]/route.ts` (PATCH)

---

## Notas

- La búsqueda de tenants en este panel es inmediata (no debounced) porque la lista completa se recarga con cada cambio de texto.
- El feedback "Saved!" desaparece automáticamente a los 2 segundos.
- `assistant_base_fee` ya no se edita aquí: si un salón lo tiene en `feature_overrides`, se conserva al guardar porque solo se envía lo que cambió.
