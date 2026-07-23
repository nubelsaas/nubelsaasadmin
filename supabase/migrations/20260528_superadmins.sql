-- Superadmins table for nubel-admin portal access
CREATE TABLE IF NOT EXISTS public.admin_superadmins (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    name       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

ALTER TABLE public.admin_superadmins ENABLE ROW LEVEL SECURITY;

-- Superadmins can read their own record (needed for the portal's auth check)
CREATE POLICY "admin_superadmins_select_own"
    ON public.admin_superadmins FOR SELECT
    USING (auth.uid() = user_id);

-- Only service role can insert / update / delete
-- (managed via Supabase dashboard or service role client)
