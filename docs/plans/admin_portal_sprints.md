# Plan de trabajo: Nubel Admin Portal

**Última actualización:** 2026-05-29

---

## Completado

### Sprint 1 — Fundación
- [x] Scaffolding Next.js 14 + TypeScript + Tailwind
- [x] Auth con `@supabase/ssr` (cookie-based)
- [x] Migración SQL `admin_superadmins` con RLS
- [x] Layout: sidebar (desktop), bottom nav (mobile)
- [x] Middleware de protección de rutas
- [x] Dashboard con stats (total, new this month, countries)
- [x] Tenants list con búsqueda y agrupación por país
- [x] Tenant detail con estadísticas operativas
- [x] Modal de creación de tenant
- [x] API routes: `POST /api/tenants`, `PATCH /api/tenants/[id]`

### Sprint 2 — Operaciones
- [x] Feature Flags (6 booleans + `assistant_base_fee`)
- [x] Impersonación con magic links
- [x] Agrupación por país en Dashboard y Tenants
- [x] Favicon distintivo (SVG indigo)

### Sprint 3 — Clone
- [x] Análisis y rediseño del caso de uso (Onboarding vs. Demo Seed)
- [x] Onboarding: clone de catálogo con UUID remapping completo + orden topológico
- [x] Demo Seed: generador de 3 meses de datos sintéticos
- [x] Privacidad: obfuscación de usuarios, no copy de clientes (50 mocks)
- [x] Nóminas consistentes con ventas via triggers de BD
- [x] UI con streaming SSE y log coloreado

### Sprint 4 — Refinamientos
- [x] Modal de creación de tenant rediseñado (5 secciones, país obligatorio, logo)
- [x] Logo upload: `POST /api/upload/logo` → Supabase Storage `empresa-logos`
- [x] `lib/countries.ts`: 20 países con nombre, bandera, prefijo, moneda, timezone
- [x] `GET /api/plans` para sortear RLS en `subscription_plans`
- [x] Fix: `plan_id` requerido en creación de tenant
- [x] Fix: icono `Clock` → `Globe` en Dashboard stat card
- [x] Fix: tenants sin `country_iso` ahora aparecen en la lista (`nullsFirst: false`)
- [x] Refactor: `FLAG` y `countryLabel` centralizados en `lib/countries.ts`

### Sprint 5 — Rollback
- [x] Rollback automático: si el clone falla, borra todo lo insertado en el destino
- [x] Undo manual: botón "Undo clone" aparece tras éxito, usa mismo stream SSE
- [x] `ROLLBACK_ORDER`: 24 tablas en orden topológico inverso
- [x] `readStream()` extraído como helper reutilizable en la UI
- [x] El tenant en `tenants` no se borra — queda vacío, reutilizable

---

## Pendiente

### Import CSV `/import`
**Prioridad:** Media  
**Descripción:** Importación masiva de datos vía CSV para onboarding acelerado.  
**Alcance propuesto:**
- Seleccionar tenant destino
- Seleccionar entidad (products, customers, users)
- Subir CSV + preview con validación
- Insertar vía service role (batch)
- Reporte de filas con error

**Estimación:** 2–3 días

---

### Gestión de suscripciones/plan
**Prioridad:** Baja  
**Descripción:** Ver y modificar el plan/suscripción activa de cada tenant.  
**Alcance propuesto:**
- Vista de plan actual en tenant detail
- Cambio de plan con confirmación

**Estimación:** 1–2 días

---

### Audit log
**Prioridad:** Baja  
**Descripción:** Ver el historial de acciones realizadas desde el portal de admin.  
**Tabla:** `audit_log` (ya existe en la BD del app principal)  
**Alcance:** Vista de solo lectura filtrable por tenant/acción/fecha

**Estimación:** 1 día

---

### Mejoras de UX menores
- [ ] Modal de confirmación antes de ejecutar Onboarding/Demo Seed (resumen de lo que se hará)
- [ ] Barra de progreso estimada durante el clone (en lugar de solo log de texto)
- [ ] Búsqueda global de tenants en el header del admin

---

## Decisiones de arquitectura tomadas (no reabrir)

| Decisión | Motivo |
|---|---|
| Writes siempre vía API route (service role) | RLS bloquea anon key en tablas del app principal |
| Prefijo `admin_` en tablas propias | Coexistencia sin colisiones en el mismo Supabase |
| Demo Seed genera datos sintéticos | Privacidad de datos reales del negocio |
| Clientes reales nunca se copian | Dato crítico de privacidad — regla permanente |
| Triggers de BD calculan comisiones | Evitar duplicar lógica de negocio en el generador |
| UUID siempre regenerado en clones | Aislamiento completo entre tenants |
| Rollback borra datos pero no el tenant | El tenant puede reutilizarse sin recrearlo |
| `readStream()` como helper compartido | Evitar duplicar el loop SSE en handleRun y handleUndo |
