# Pruebas end-to-end (solo DEV)

Crean salones, usuarios y un superadmin desechables (`ZZ_*`, `zz-*@example.com`), prueban y los borran al final.
Cada script aborta si la URL no es la del proyecto DEV (`pwssiwhraoednhqghowi`). **Nunca correr contra PROD.**

No corren en CI ni con `npm test` (solo toma `tests/*.test.mjs`).

| Script | Qué verifica | Necesita el portal en 3003 |
|---|---|---|
| `health-e2e.mjs` | Salud de salones y avisos del dashboard (`lib/tenantHealth.ts`) | Sí (dashboard) |
| `views-e2e.mjs` | Registro de lecturas (`logAdminView`) | Sí |
| `contact-e2e.mjs` | Riesgos 29 y 30: email de contacto y un email por salón | Sí |
| `impersonate-e2e.mjs` | Sesión de soporte marcada en `audit_log` (`impersonated_by`), tope de 60 minutos, lista de sesiones activas y End (espera 65 s). Necesita `audit_impersonation.sql` de nubelsaas en DEV | Sí |
| `quickwins-e2e.mjs` | Lista de tenants (búsqueda, filtros, orden, URL), salud por salón, plan en Flags y diálogo de motivos. Usa Playwright con un navegador real | Sí |
| `integrations-e2e.mjs` | Tarjeta de integraciones: un salón con una falla conocida en email, WhatsApp, Google y push; que no salgan tokens. Usa Playwright | Sí |
| `announcements-e2e.mjs` | Anuncios: público por plan, país, salón y dueños; cerrar por persona; críticos; que el app no lea las tablas; edición, fin, registro y la página. Usa Playwright. Necesita `announcements.sql` de nubelsaas en DEV | Sí |
| `notes-e2e.mjs` | Notas internas: crear, fijar, editar, borrar, permisos entre dos admins, registro en el audit log y que no bloquean borrar el salón. Usa Playwright. Necesita `20261125_admin_tenant_notes.sql` en DEV | Sí |
| `onboarding-e2e.mjs` | Checklist Setup: un salón nuevo, uno atascado y uno completo; filtros e insignias de la lista. Usa Playwright | Sí |

```bash
npm run dev    # en otra terminal: portal DEV en http://localhost:3003

node --env-file=.env.dev.local --import ./tests/e2e/alias-loader.mjs tests/e2e/health-e2e.mjs
node --env-file=.env.dev.local tests/e2e/views-e2e.mjs
node --env-file=.env.dev.local tests/e2e/contact-e2e.mjs
node --env-file=.env.dev.local tests/e2e/impersonate-e2e.mjs

# Playwright no es dependencia del portal: PLAYWRIGHT_DIR es una carpeta con node_modules/playwright
# (p. ej. el repo nubelsaas). CHROMIUM_PATH solo si Playwright pide un Chromium que no está descargado.
PLAYWRIGHT_DIR=~/nubelsaas node --env-file=.env.dev.local tests/e2e/quickwins-e2e.mjs
PLAYWRIGHT_DIR=~/nubelsaas node --env-file=.env.dev.local tests/e2e/integrations-e2e.mjs
PLAYWRIGHT_DIR=~/nubelsaas node --env-file=.env.dev.local tests/e2e/onboarding-e2e.mjs
PLAYWRIGHT_DIR=~/nubelsaas node --env-file=.env.dev.local tests/e2e/notes-e2e.mjs
PLAYWRIGHT_DIR=~/nubelsaas node --env-file=.env.dev.local tests/e2e/announcements-e2e.mjs
```

`alias-loader.mjs` resuelve `@/…` e imports `.ts` sin extensión como lo hace Next; solo lo necesita `health-e2e.mjs`.
Cada script imprime `PASS`/`FAIL` por chequeo, los restos (`leftovers`) y al final `ALL PASSED` o `N FAILED`.
