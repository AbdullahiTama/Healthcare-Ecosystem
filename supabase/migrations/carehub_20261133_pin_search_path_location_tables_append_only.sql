-- Advisor finding function_search_path_mutable on the append-only trigger function.
-- APPLIED TO PRODUCTION 2026-10-19.

ALTER FUNCTION public.location_tables_append_only() SET search_path TO 'public', 'pg_temp';
