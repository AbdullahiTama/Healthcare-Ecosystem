-- ============================================================================
-- Retire the separate CareFind-side business directory
--
-- Status: WRITTEN AND TESTED, NOT YET APPLIED TO PRODUCTION. Every DROP statement times out
-- through the Supabase MCP connector (even DROP TABLE on a throwaway table; the transaction
-- rolls back, so nothing is ever half-dropped). Run this file in the Supabase SQL editor.
-- It is safe to run: it aborts without changes if any data table has a row.
-- Run AFTER 20261012_directory_platform_scope.sql
-- (which carries the 21 subcategories into the shared directory_subcategories).
--
-- WHY
--   The directory is now one schema with two scopes (company-private + platform
--   registry, see 20261012). The earlier CareFind-side tables were an empty,
--   unused parallel build: 0 businesses, 0 import batches, no app code, no
--   foreign keys, views or functions elsewhere depending on them (verified
--   2026-10-09). Their definitions are archived in
--   sql/archive/carefind_directory_retired.md.
--
-- SAFETY
--   * Aborts, changing nothing, if ANY of the data tables has a row.
--   * No CASCADE: if something unexpected still depends on these objects the
--     DROP fails instead of silently taking the dependent object with it.
--   * Runs in one transaction (psql/MCP wrap), so it is all-or-nothing.
--   * Re-runnable: every statement is IF EXISTS.
-- ============================================================================

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['business_directory', 'business_import_batches', 'business_import_errors', 'business_verification', 'business_sources']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'Refusing to retire the CareFind directory: public.% holds % row(s). Migrate them first.', t, n;
      end if;
    end if;
  end loop;
end $$;

-- Children before parents. Their triggers go with them.
drop table if exists public.business_import_errors;
drop table if exists public.business_import_batches;
drop table if exists public.business_verification;
drop table if exists public.business_sources;
drop table if exists public.business_directory;
drop table if exists public.business_subcategories;
drop table if exists public.business_categories;

-- The helper functions that only served those tables.
drop function if exists public.search_nearby_businesses(double precision, double precision, integer, uuid, text, text, text, text, integer, integer);
drop function if exists public.find_duplicate_businesses(text, text, numeric, numeric, uuid, numeric);
drop function if exists public.get_business_stats();
-- Trigger function that only served business_directory (its trigger went with the table).
drop function if exists public.generate_business_slug();
