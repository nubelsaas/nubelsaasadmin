# Walkthrough: Clone Tenant — selección de tablas con checkboxes y cascada de dependencias

**Fecha:** 2026-06-01  
**Archivos modificados:**
- `app/(admin)/clone/page.tsx`
- `app/api/clone/stream/route.ts`

**Tipo de cambio:** Feature nueva — elegir qué tablas clonar, con exclusión automática por dependencias FK

---

## Motivación

Algunos clientes nuevos no quieren clonar ciertas tablas (ej. `customers` se sube desde un archivo CSV externo, no se clona del tenant fuente). Era necesario dar control granular sin romper la integridad referencial.

## Tablas disponibles y dependencias

**Onboarding (9 tablas):**
```
branches, roles, product_categories, expense_categories,
payment_accounts, commission_rules, products_services,
service_recipes, branch_stock
```

**Demo Seed añade:** `users`

**Mapa de dependencias FK** (si se excluye el padre, los hijos se excluyen automáticamente):
```
branches           → payment_accounts, branch_stock, users
roles              → commission_rules, users
product_categories → products_services
products_services  → service_recipes, branch_stock
```

## Lógica de cascada

```ts
function computeExcluded(userExcluded: Set<string>): Set<string> {
  const result = new Set(userExcluded);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [table, deps] of Object.entries(DEPENDENTS)) {
      if (result.has(table)) {
        for (const dep of deps) {
          if (!result.has(dep)) { result.add(dep); changed = true; }
        }
      }
    }
  }
  return result;
}
```

Algoritmo de punto fijo: itera hasta que no haya nuevas exclusiones que propagar. Correcto para cadenas de dependencias de cualquier profundidad.

**Distinción `userExcluded` vs `fullyExcluded`:**
- `userExcluded`: tablas que el usuario desmarcó explícitamente
- `fullyExcluded = computeExcluded(userExcluded)`: userExcluded + cascada

Una tabla force-excluida (en `fullyExcluded` pero no en `userExcluded`) muestra su checkbox deshabilitado con mensaje "requires [padre]". Si el usuario re-habilita el padre, la hija vuelve a ser opcional.

## UI

Sección "Tables to clone" colapsable. El header muestra `X/N selected` en tiempo real. Cada tabla:
- Label en español
- Nombre técnico en gris (font-mono)
- Si force-excluida: tachada + `requires [padre]` en amber + checkbox deshabilitado

## Cambios en el stream route

Se añade el parámetro `exclude` (comma-separated) a la URL del stream:
```ts
params.set('exclude', excludedParam); // ej. "customers,branch_stock"
```

En el route handler:
```ts
const excluded = new Set(searchParams.get('exclude')?.split(',').filter(Boolean) ?? []);
const order = ONBOARDING_ORDER.filter(t => !excluded.has(t));
await runOnboarding(sourceId, targetId, order, copyStock, send, db);
```

El log muestra `Skipped: tabla1, tabla2` al inicio de la ejecución.

## Modal de confirmación

Se amplió para mostrar `Tables: X of N` y la lista de tablas omitidas (si hay), antes del botón "Confirm".
