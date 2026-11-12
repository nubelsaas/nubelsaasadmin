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

### Needs attention

Lista calculada al abrir el dashboard (`lib/tenantHealth.ts` → `loadAlerts`; reglas de estado en `lib/healthStatus.ts`). El portal no envía avisos por correo ni por otro canal: hay que abrirlo.

| Aviso | Nivel | Regla |
|---|---|---|
| Clone o Undo sin terminar | Alto | `getCloneRun` en estado interrumpido, revisado en tenants con clones de los últimos 30 días |
| Muchas impersonaciones | Alto | Un admin con `IMPERSONATION_LIMIT` (5) o más en 24 horas |
| Audit log apagado | Alto | `is_audit_enabled = false` |
| Sin dueño activo | Alto | Ningún usuario activo con `can_do_everything`, salvo suspendidos |
| Contacto de un usuario desactivado | Alto | `admin_email` es de un usuario con `is_active = false`: las alertas de caja le siguen llegando |
| Sin correo de contacto | Info | `admin_email` vacío: no salen las alertas de caja |
| Salón callado | Info | Sin ventas en más de `QUIET_DAYS` (14) días, si alguna vez vendió |
| Ingresos en caída | Info | Los últimos 30 días están por debajo de la mitad de los 30 anteriores |
| Suspendido | Info | `suspended_at` no nulo |

### Salon health

Tabla por salón con los últimos 30 días: última venta, ventas, ingresos frente a los 30 días anteriores, citas, staff activo y plan. Las barras muestran los ingresos de los últimos 6 meses, por mes UTC.

- Ventas desde `transactions`, sin `voided`. Citas sin `cancelled` ni `no_show`.
- Ingresos en la moneda de cada salón, sin convertir.
- **Est. monthly value** suma el `monthly_price` del plan de los salones no suspendidos. Es un estimado: no hay datos de cobro.
- Lee todas las filas o muestra un error en vez de totales incompletos. Si falla, el resto del dashboard se muestra igual.
- Requiere la columna `suspended_at` (migración de suspensión de nubelsaas).

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
