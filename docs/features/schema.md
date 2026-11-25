# Schema

**Ruta:** `/schema`
**Archivos:** `app/(admin)/schema/page.tsx` · `app/api/schema/route.ts` · `lib/schemaSnapshot.ts` · `lib/schemaDiff.ts` · `scripts/schema-diff.mjs`
**SQL:** `supabase/migrations/20261125_admin_schema_snapshot.sql` (correr en DEV y en PROD)

---

## Para qué

Saber en qué difieren DEV y PROD **antes** de desplegar, en vez de enterarse cuando algo falla (columnas de `sales`, `whatsapp_sessions`, scripts pendientes de PROD). Solo lee la estructura de la base, nunca filas.

## Cómo lee la base

- **Completo:** `admin_schema_snapshot()` devuelve tablas, columnas (tipo, nulabilidad, default), RLS, vistas, funciones, triggers, políticas (`public` y `storage`), índices, enums y extensiones. De funciones, triggers, políticas e índices trae un md5 de la definición: alcanza para saber si cambió. `SECURITY DEFINER`, solo para `service_role`.
- **Sin la función** (todavía no instalada en esa base): lo que publica la API REST. Solo nombres de tablas, columnas y funciones expuestas. La página lo avisa y la comparación se limita a nombres.
- Objetos de extensiones (`pg_trgm`, etc.) se comparan por la versión de la extensión, no uno a uno.

## Página

1. **This database:** entorno, referencia del proyecto y conteos. **Download snapshot** baja el JSON.
2. **Portal readiness:** lo que el portal necesita en esta base (`PORTAL_REQUIREMENTS` en `lib/schemaDiff.ts`), qué se rompe si falta y en qué SQL está. **Abrirla con el portal apuntando a PROD antes de desplegar.** Al agregar al portal una tabla, columna o función nueva, sumarla a esa lista.
3. **Compare with the other environment:** el portal solo tiene la clave de su propia base, así que la otra se compara subiendo su snapshot (bajado de la página Schema del otro entorno, o el archivo de `schema-diff.mjs --save`). Muestra lo que está solo de un lado, lo que está solo del otro y lo que difiere, con filtro por categoría.

Ver el esquema no se registra en el audit log: no son datos de un salón.

## Script

Compara DEV y PROD en un paso con los dos `.env` de esta máquina. Solo lee (la función o el esquema de la API) y no imprime las claves.

```bash
node scripts/schema-diff.mjs                         # .env.dev.local contra .env.local
node scripts/schema-diff.mjs .env.dev.local prod.json  # contra un snapshot bajado de /schema
node scripts/schema-diff.mjs --save both.json        # además guarda los dos snapshots
```

## Límites

- Una diferencia no siempre es un error: `develop` puede haber retirado algo a propósito (p. ej. `whatsapp_sessions`). La lista dice qué difiere; decidir qué hacer es aparte.
- Un cambio de espacios en el cuerpo de una función cuenta como "body differs".
- Si una de las dos bases no tiene `admin_schema_snapshot()`, las funciones de extensiones (`show_trgm`, `unaccent`…) aparecen como "solo de ese lado": el catálogo las omite y la API las lista. Instalar la función en las dos bases.
- No compara datos, grants, cron jobs ni la tabla de migraciones (los SQL se corren a mano en el editor y no quedan registrados ahí).

## Pruebas

- `tests/schemaDiff.test.mjs`: diferencias por categoría, modo sin catálogo, requisitos del portal y archivos subidos.
- `tests/e2e/schema-e2e.mjs`: lee DEV, que el snapshot no traiga filas ni claves, que la anon key no pueda llamar la función, readiness, descarga, y la comparación contra una copia modificada.
