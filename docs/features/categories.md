# Categories

**Ruta:** `/categories`  
**Archivos:** `app/(admin)/categories/page.tsx` · `app/api/categories/expense/route.ts` · `app/api/categories/expense/[id]/route.ts`  
**Tipo:** Client Component + API Routes (service role)

---

## Propósito

Gestión de las categorías de gastos globales compartidas por todos los tenants. Desde 2026-06-18 las categorías ya no son configurables por cada tenant desde nubelsaas — son definidas una sola vez aquí y todos los tenants las heredan via RLS (`tenant_id IS NULL`).

---

## UI

Layout de página con lista agrupada por tipo ERP:

```
/categories
├── Header: "Expense Categories" + botón "New category"
├── Form inline (cuando se crea nueva categoría): nombre + tipo
└── Lista agrupada por type:
    ├── COGS — Costo Directo
    ├── OPEX Fijo — Gasto Fijo
    ├── OPEX Variable — Gasto Variable
    └── No Operacional
        Cada fila: nombre | system code selector | toggle Activo/Inactivo
└── Sección "System Codes": referencia de los 3 códigos reservados
```

### Acciones por categoría

| Acción | Comportamiento |
|---|---|
| Editar nombre | Click en ícono lápiz → input inline; Enter o ✓ para guardar |
| Toggle activo/inactivo | Botón pill verde/gris; si inactiva deja de aparecer en todos los tenants |
| Asignar system code | Dropdown — solo permite el código si no está asignado a otra categoría |

---

## System Codes

| Código | Type | Uso |
|---|---|---|
| `GATEWAY_FEE` | `COGS` | Comisiones de pasarela auto-liquidadas en traslados card/transfer |
| `PAYROLL_ADVANCE` | `COGS` | Gastos auto-generados al registrar adelantos de nómina |
| `PAY_SALARIES` | `COGS` | Gastos auto-generados al pagar nómina |
| `MARKETING` | `OPEX Variable` | **No** auto-genera gastos: clasifica la categoría de marketing/publicidad como la **única base del "Marketing Spend" y el CAC** del dashboard. Ver `nubelsaas/docs/business_rules/dashboard_rules.md §5.1`. |

Los tres primeros (`GATEWAY_FEE`, `PAYROLL_ADVANCE`, `PAY_SALARIES`) deben ser `type = COGS` porque auto-generan gastos. `MARKETING` es distinto: no auto-genera nada, solo etiqueta la categoría de marketing (típicamente `type = OPEX Variable`) para que el CAC sume **solo** ese gasto y no todo el OPEX Variable. Ver `expenses_rules.md §13` y `dashboard_rules.md §4/§5.1` para el razonamiento.

Un código solo puede estar asignado a una categoría (índice único en BD, solo para globales `tenant_id IS NULL`). El dropdown deshabilita códigos ya asignados.

---

## API Routes

### `GET /api/categories/expense`
Retorna todas las categorías globales (`tenant_id IS NULL`) ordenadas por `type`, `name`.

### `POST /api/categories/expense`
Crea una nueva categoría global. Body: `{ name, type }`. Inserta con `tenant_id = null`.

### `PATCH /api/categories/expense/[id]`
Actualiza campos de una categoría global. Campos permitidos: `name`, `is_active`, `code`. El filtro `.is('tenant_id', null)` garantiza que nunca se toquen categorías legadas.

Todas las rutas usan `createAdminClient()` (service role) y requieren superadmin autenticado.

---

## Impacto en nubelsaas

Cualquier cambio aquí (nombre, activación, asignación de código) se refleja inmediatamente en todos los tenants sin necesidad de sincronización:

- **Desactivar una categoría** → desaparece del selector de gastos en todos los tenants
- **Cambiar un nombre** → el nuevo nombre aparece en formularios y reportes (históricos conservan el nombre del momento del gasto via `expenses_purchases`)
- **Revocar un system code** → los futuros gastos auto-generados de ese tipo quedan sin categoría (`expense_category_id = null`)

---

## Impacto en Clone

Las categorías globales no se clonan ni se eliminan en ningún modo del clone:
- `expense_categories` fue eliminada de `ONBOARDING_ORDER` — el tenant destino las hereda por RLS
- `expense_categories` fue eliminada de `ROLLBACK_ORDER` — nunca se borran por rollback
- El Demo Seed lee categorías globales directamente en `readDemoStructure()`

---

## Archivos relacionados

| Archivo | Rol |
|---|---|
| `app/(admin)/categories/page.tsx` | UI de gestión |
| `app/api/categories/expense/route.ts` | GET + POST |
| `app/api/categories/expense/[id]/route.ts` | PATCH |
| `components/layout/AdminSidebar.tsx` | Link "Categories" en nav |
| `app/api/clone/stream/route.ts` | Clone actualizado para excluir expense_categories |
