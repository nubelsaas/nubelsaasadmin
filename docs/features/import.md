# Import CSV

**Ruta:** `/import`  
**Archivo:** `app/(admin)/import/page.tsx`  
**Estado:** Pendiente de implementar

---

## Propósito

Importación masiva de datos vía CSV para onboarding acelerado de tenants (productos, clientes, usuarios, etc.).

---

## Estado actual

La pantalla muestra un placeholder con un ícono de upload y el mensaje "CSV import — coming soon". No tiene funcionalidad implementada.

---

## Diseño propuesto (pendiente)

El flujo esperado sería:
1. Seleccionar tenant destino
2. Seleccionar tipo de entidad (products, customers, users, etc.)
3. Subir archivo CSV
4. Preview de las filas a importar (validación)
5. Confirmar import → inserción vía service role API

---

## Tablas candidatas para import

| Entidad | Tabla | Campos clave |
|---|---|---|
| Productos/Servicios | `products_services` | name, type, price, cost_price, category |
| Clientes | `customers` | first_name, last_name, email, phone |
| Usuarios/Staff | `users` | first_name, last_name, email, role |
| Categorías | `product_categories` | name, type |

---

## Notas de implementación futura

- Validar columnas requeridas antes de insertar
- Manejar duplicados (by email, by name)
- Insertar vía `createAdminClient()` (service role) — nunca con anon key
- Reportar filas con error sin abortar el import completo
