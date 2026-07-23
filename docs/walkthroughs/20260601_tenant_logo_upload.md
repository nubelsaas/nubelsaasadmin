# Walkthrough: Gestión de logo del tenant en el portal de admin

**Fecha:** 2026-06-01  
**Archivos modificados:**
- `app/(admin)/tenants/[id]/page.tsx`
- `app/api/tenants/[id]/route.ts`
- `next.config.mjs`

**Tipo de cambio:** Feature nueva — subir, ver y eliminar el logo de un tenant desde el detail

---

## Contexto

La columna `logo_url` ya existía en `tenants`. El bucket `empresa-logos` en Supabase Storage ya existía. Faltaba la UI de gestión en el portal de admin.

## Flujo completo

```
Usuario elige archivo → POST /api/upload/logo (service role)
  → Supabase Storage bucket "empresa-logos"
  → retorna URL pública
  → PATCH /api/tenants/[id] con { logo_url: url }
  → setLogoUrl(url) en estado local
```

Para **eliminar**:
```
PATCH /api/tenants/[id] con { logo_url: null }
→ setLogoUrl(null)
```

## Cambios en API

`GET /api/tenants/[id]` ampliado para incluir `logo_url` en el select:
```ts
db.from('tenants').select('id, name, admin_email, phone, city, plan_id, feature_overrides, settings, logo_url, created_at')
```

`PATCH /api/tenants/[id]` — `logo_url` añadido a `PATCHABLE_FIELDS`:
```ts
const PATCHABLE_FIELDS = new Set([..., 'logo_url']);
```

## UI en TenantDetailPage

Sección "Logo" entre las stats y el formulario de info:
- **Sin logo:** placeholder con borde dashed + botón "Upload logo"
- **Con logo:** `<Image>` de Next.js + botones "Replace" y "Remove"
- Estados: `uploadingLogo` (spinner/texto), `logoError` (mensaje en rojo)
- Input `type="file"` oculto referenciado por `useRef`

```tsx
{logoUrl ? (
  <Image src={logoUrl} alt={tenant.name} fill className="object-contain p-2" unoptimized />
) : (
  <div className="... border-dashed"><ImagePlus size={22} /></div>
)}
```

## next.config.mjs — dominio Supabase

`next/image` valida dominios incluso con `unoptimized`. Se añadió el patrón:
```js
images: {
  remotePatterns: [{
    protocol: 'https',
    hostname: '*.supabase.co',
    pathname: '/storage/v1/object/public/**',
  }],
}
```

Sin este config, el componente `<Image>` rechazaba la URL del bucket con un error de "hostname not configured".

## Advertencia de Supabase Storage — "broad SELECT policy"

El bucket `empresa-logos` tiene una política SELECT en `storage.objects` que permite listar todos los archivos. Para un bucket público no es necesaria — los archivos son accesibles por URL pero nadie debería poder enumerar el contenido completo. Se recomienda eliminar esa política desde el Dashboard de Supabase (botón "Remove policy" en la alerta).
