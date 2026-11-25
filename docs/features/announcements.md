# Announcements

**Ruta:** `/announcements`
**Archivos:** `app/(admin)/announcements/page.tsx` · `app/api/announcements/**` · `lib/announcementRules.ts` · `lib/announcements.ts`
**Base:** `admin_announcements` y `admin_announcement_receipts`, creadas por nubelsaas (`docs/database/announcements.sql`).

---

## Qué hace

Avisos de Nubel que el app muestra arriba de la pantalla, en el mismo stack que los avisos de notificaciones, instalación y nueva versión (`PwaManager` en nubelsaas). Sirven para mantenimientos, funciones nuevas o cambios de precio.

- **Nivel:** `Info` (índigo), `Warning` (ámbar), `Critical` (rosa). Critical no se puede cerrar: solo se minimiza hasta recargar, y vuelve hasta que termine.
- **Texto:** título (120), mensaje opcional (1000, texto plano) y un enlace opcional, solo `https://`. Se muestra tal cual: escribirlo en español.
- **Público:** todos los salones o filtrados por plan, país y salones puntuales. Los filtros con valor se cumplen todos. **Owners only** lo limita a los dueños (`can_do_everything`); si no, lo ve todo el salón.
- **Alcance:** el formulario muestra a cuántos salones y personas activas llega (`POST /api/announcements/reach`). Si no llega a ninguno, no se puede publicar.
- **Ventana:** inicio (vacío = ahora) y fin opcional (vacío = hasta que se termine a mano). Con inicio futuro queda **Scheduled**.
- **Vista previa:** copia el diseño del aviso en el app.

## En el app

- Se pide al entrar y al volver a la pestaña, como mucho cada 5 minutos: un anuncio nuevo o terminado tarda hasta eso en aparecer o irse.
- Como mucho 2 a la vez, críticos primero. Nada en rutas públicas (login, reservas, firma) ni sin conexión.
- **Cerrar** lo oculta solo para esa persona (`dismiss_announcement`). Los demás del salón lo siguen viendo.
- Un usuario desactivado no recibe nada. Un salón suspendido sí los ve y los puede cerrar.
- El app no puede leer las tablas: solo `get_my_announcements()`, que devuelve lo dirigido a quien llama. Un anuncio a un salón puede nombrarlo, y los demás no deben verlo.

## Lista

Agrupada en **Live**, **Scheduled** y **Ended**, con el público, las fechas, quién lo creó y, una vez empezado, **Seen by** (personas a las que el app se lo mostró) y **closed by**.

- **Edit:** solo mientras está programado. Lo que ya se leyó no cambia: para corregir uno vivo, terminarlo y crear otro.
- **End / Cancel:** termina uno vivo o cancela uno programado (`ended_at`). No se borran.

## Registro

Toda escritura pasa por `logAdminAction()` antes de ejecutarse (`docs/features/audit.md`):

| Acción | Ruta | `details` |
|---|---|---|
| `announcement.create` | `POST /api/announcements` | `announcement_id`, `title`, `level`, fechas, `audience` |
| `announcement.update` | `PATCH /api/announcements/[id]` | lo mismo |
| `announcement.end` | `POST /api/announcements/[id]/end` | `announcement_id`, `title`, `was` (`live` o `scheduled`) |

Listar y calcular el alcance no se registra: no muestran datos de un salón.

## Salones

`admin_announcement_receipts` tiene `tenant_id`, pero no bloquea borrar el salón ni clonar sobre él (`EMPTY_TENANT_TABLES`). Al borrar el salón sus filas se van con él.

## Antes de PROD

Correr la migración de nubelsaas `20261125162348_sync_announcements.sql` (rama `feat/announcements`) en PROD **antes** de desplegar este portal: sin las tablas, la página muestra el error y no se puede publicar. El app debe desplegarse para que los salones vean los avisos; hasta entonces lo publicado no le llega a nadie.

## Pruebas

- `tests/announcementRules.test.mjs`: validación, estado, público y alcance.
- `tests/e2e/announcements-e2e.mjs`: dos salones desechables con dueños y un empleado; quién ve qué, cerrar por persona, críticos, permisos, edición, fin, registro y la página. Todo anuncio de la prueba va dirigido a esos salones.
- En nubelsaas: `src/lib/__tests__/announcements.test.ts`, `src/components/layout/__tests__/AnnouncementBanner.test.tsx` y `PwaManager.test.tsx`.
