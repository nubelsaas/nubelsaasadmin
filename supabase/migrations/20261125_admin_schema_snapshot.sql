-- Estructura de la base para la página Schema del portal (docs/features/schema.md).
-- Solo lee el catálogo (pg_catalog): tablas, columnas, funciones, triggers, políticas RLS,
-- índices, tipos enum y extensiones. Nunca filas.
-- De funciones, triggers, políticas e índices devuelve un md5 de la definición, no el texto:
-- alcanza para saber si cambió.
-- Solo la llama el service role (rutas API del portal). Re-ejecutable.
-- Correr en DEV y en PROD desde el SQL editor.

CREATE OR REPLACE FUNCTION public.admin_schema_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
WITH
own AS (   -- objetos de extensiones (pg_trgm, etc.): se comparan por la extensión, no uno a uno
    SELECT objid FROM pg_depend WHERE deptype = 'e'
),
tbl AS (
    SELECT c.oid, c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.oid NOT IN (SELECT objid FROM own)
)
SELECT jsonb_build_object(
    'generated_at', now(),
    'tables', (
        SELECT COALESCE(jsonb_object_agg(t.relname, jsonb_build_object(
            'rls', t.relrowsecurity,
            'columns', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                           'name', a.attname,
                           'type', format_type(a.atttypid, a.atttypmod),
                           'nullable', NOT a.attnotnull,
                           'default', pg_get_expr(d.adbin, d.adrelid)
                       ) ORDER BY a.attnum), '[]'::jsonb)
                  FROM pg_attribute a
                  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
            )
        )), '{}'::jsonb)
          FROM tbl t
    ),
    'views', (
        SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
           AND c.oid NOT IN (SELECT objid FROM own)
    ),
    'functions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'name', p.proname,
                   'args', pg_get_function_identity_arguments(p.oid),
                   'returns', pg_get_function_result(p.oid),
                   'security_definer', p.prosecdef,
                   'hash', md5(p.prosrc)
               ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
           AND p.oid NOT IN (SELECT objid FROM own)
    ),
    'triggers', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'table', t.relname,
                   'name', tg.tgname,
                   'enabled', tg.tgenabled <> 'D',
                   'hash', md5(pg_get_triggerdef(tg.oid))
               ) ORDER BY t.relname, tg.tgname), '[]'::jsonb)
          FROM pg_trigger tg JOIN tbl t ON t.oid = tg.tgrelid
         WHERE NOT tg.tgisinternal
    ),
    'policies', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'schema', p.schemaname,
                   'table', p.tablename,
                   'name', p.policyname,
                   'cmd', p.cmd,
                   'permissive', p.permissive,
                   'hash', md5(COALESCE(array_to_string(p.roles, ','), '') || '|' || COALESCE(p.qual, '') || '|' || COALESCE(p.with_check, ''))
               ) ORDER BY p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
          FROM pg_policies p
         WHERE p.schemaname IN ('public', 'storage')
    ),
    'indexes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'table', i.tablename,
                   'name', i.indexname,
                   'hash', md5(i.indexdef)
               ) ORDER BY i.tablename, i.indexname), '[]'::jsonb)
          FROM pg_indexes i
         WHERE i.schemaname = 'public'
    ),
    'enums', (
        SELECT COALESCE(jsonb_object_agg(ty.typname, (
                   SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = ty.oid
               )), '{}'::jsonb)
          FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
         WHERE n.nspname = 'public' AND ty.typtype = 'e'
    ),
    'extensions', (
        SELECT COALESCE(jsonb_object_agg(x.extname, x.extversion), '{}'::jsonb) FROM pg_extension x
    )
);
$$;

REVOKE ALL ON FUNCTION public.admin_schema_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schema_snapshot() TO service_role;
