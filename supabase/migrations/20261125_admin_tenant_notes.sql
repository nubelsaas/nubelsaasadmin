-- Notas internas del equipo sobre cada salón (ver docs/features/tenants.md, "Internal notes").
-- Solo las ve el portal: el salón nunca las lee.
-- Borrar una nota la oculta (deleted_at) y no la elimina, para que no se pierda lo escrito.
-- Si se borra el salón, sus notas se van con él (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS public.admin_tenant_notes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    author_user_id   UUID NOT NULL,
    author_email     TEXT NOT NULL,
    body             TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
    pinned           BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    deleted_by_email TEXT
);

CREATE INDEX IF NOT EXISTS admin_tenant_notes_tenant_idx
    ON public.admin_tenant_notes (tenant_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- RLS sin políticas: solo el service role (rutas API del portal) puede leer y escribir.
ALTER TABLE public.admin_tenant_notes ENABLE ROW LEVEL SECURITY;
