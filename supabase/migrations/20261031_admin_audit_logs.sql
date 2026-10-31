-- Acciones hechas desde el portal de admin (ver docs/features/audit.md)
-- Sin foreign keys a propósito: el registro debe sobrevivir al borrado del tenant o del admin.
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL,
    admin_email   TEXT NOT NULL,
    action        TEXT NOT NULL,
    tenant_id     UUID,
    details       JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx
    ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_tenant_idx
    ON public.admin_audit_logs (tenant_id, created_at DESC);

-- RLS sin políticas: solo el service role (rutas API del portal) puede leer y escribir.
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
