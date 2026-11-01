# Import CSV

**Ruta:** `/import`
**Archivos:** `app/(admin)/import/page.tsx` · `components/import/ImportSections.tsx` · `app/api/import/route.ts` · `app/api/import/undo/route.ts` · `lib/importFields.ts`

---

## Propósito

Carga masiva por CSV de categorías, servicios, inventario y clientes, para el onboarding de un tenant.

---

## Flujo

1. Elegir tenant, subir el CSV y mapear columnas.
2. **Check:** `POST /api/import` con `dryRun: true`. No escribe nada y responde `{ fresh, duplicates, live }`.
3. **Import:** inserta solo los registros nuevos, en un único `INSERT`: si una fila falla no entra ninguna.
4. **Undo:** la lista **Recent imports** permite deshacer durante 1 hora. Sale de `admin_audit_logs`, así que sobrevive a recargar.

---

## Duplicados

El servidor los descarta siempre, también si se llama a la API sin pasar por la pantalla (`splitDuplicates`).

| Entidad | Es duplicado si coincide |
|---|---|
| Categorías | Nombre y tipo |
| Servicios e inventario | SKU, o nombre y tipo |
| Clientes | Documento, email o teléfono (7 dígitos o más). Ignora clientes eliminados |

Un cliente solo con nombre no se puede comprobar y siempre entra como nuevo: dos "Ana Gómez" pueden ser personas distintas.

---

## Salón en operación

Si el tenant tiene movimientos (`hasFinancialHistory`), la importación responde `409` sin `confirmLive: true`. La pantalla lo avisa en el paso Check. Si no se puede verificar, se trata como salón en operación.

---

## Deshacer

`POST /api/import/undo` con `{ importId }`, el id del registro `import.finished`. Borra solo los ids de esa importación, una sola vez. Lo que ya se usó, como un cliente con una venta, lo protege su FK: queda en su lugar y la respuesta lo informa en `kept`.

Si el registro ya se editó después de importar, Undo lo borra igual.
