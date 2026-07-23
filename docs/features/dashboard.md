# Dashboard

**Ruta:** `/`  
**Archivo:** `app/(admin)/page.tsx`  
**Tipo:** Server Component (Next.js 14 App Router)

---

## Propósito

Pantalla de inicio del portal de administración. Muestra una visión general de todos los tenants activos en el sistema con métricas clave y navegación rápida a cada tenant.

---

## Componentes visuales

### Stats cards
Tres tarjetas en la parte superior:

| Card | Dato | Fuente |
|---|---|---|
| Total tenants | COUNT(*) de la tabla `tenants` | Query directa |
| New this month | COUNT donde `created_at >= inicio del mes actual` | Query con `.gte` |
| Countries | Número de países únicos (distinct `country_iso`) | Calculado en servidor |

### Tenants agrupados por país
- Los tenants se agrupan por `country_iso` usando `reduce` en el servidor
- Cada grupo muestra el emoji de la bandera, el código ISO y el conteo de tenants
- Países soportados con emoji: CO, MX, AR, CL, PE, EC, US, ES, BR, VE
- Países no mapeados muestran `🌐 XX`
- Los países se ordenan alfabéticamente por código ISO
- Dentro de cada grupo, los tenants se ordenan por nombre (query con `.order('name')`)
- Cada tenant es un `<Link>` clickeable que navega a `/tenants/[id]`

---

## Flujo de datos

```
Page load → getData() [server]
  → supabase.from('tenants').select('id, name, country_iso, created_at').order('country_iso').order('name')
  → supabase.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth)
→ render (no client-side fetch)
```

La función `getData()` ejecuta ambas queries en paralelo con `Promise.all`.

---

## Archivos relacionados

- `app/(admin)/page.tsx` — componente principal
- `lib/supabaseServer.ts` — cliente Supabase server-side
- `components/layout/AdminHeader.tsx` — header de sección

---

## Notas de implementación

- Este es un Server Component: no tiene estado, no usa `useEffect`, se renderiza en el servidor.
- La tabla `tenants` **no tiene** columna `is_active` ni `slug`. No usar esos campos.
- `country_iso` puede ser `null` (tenants sin país asignado). Se muestra como `XX`.
