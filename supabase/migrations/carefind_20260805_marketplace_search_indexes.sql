-- 2026-08-05 — MedMarket / Health Facilities search indexes (DRAFT — not yet applied)
--
-- Every public marketplace search runs `ilike '%q%'` over free text:
--   products   → name, generic_name, category   (Search.jsx products tab)
--   businesses → name, business_type, city, state (Search.jsx facilities tab)
-- Plain `ilike` cannot use a standard btree index, so these scans degrade
-- linearly as the marketplace grows. pg_trgm GIN indexes give those patterns
-- real index support; they are maintained automatically by Postgres.
--
-- Also two partial indexes for the exact filter predicates the listings use:
--   products.list_on_carefind   (searched with `is not false`)
--   businesses.visible_on_carefind + status ('active') — the eligibility gate
--
-- Idempotent. Run from the Supabase SQL editor.

create extension if not exists pg_trgm;

create index if not exists products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops);

create index if not exists products_generic_name_trgm_idx
  on public.products using gin (generic_name gin_trgm_ops);

create index if not exists products_category_trgm_idx
  on public.products using gin (category gin_trgm_ops);

create index if not exists businesses_name_trgm_idx
  on public.businesses using gin (name gin_trgm_ops);

create index if not exists businesses_business_type_trgm_idx
  on public.businesses using gin (business_type gin_trgm_ops);

create index if not exists businesses_city_trgm_idx
  on public.businesses using gin (city gin_trgm_ops);

create index if not exists businesses_state_trgm_idx
  on public.businesses using gin (state gin_trgm_ops);

create index if not exists products_business_listed_idx
  on public.products (business_id, list_on_carefind)
  where list_on_carefind is not false;

create index if not exists businesses_active_visible_idx
  on public.businesses (visible_on_carefind, status);

-- Verify after applying:
--   select indexname from pg_indexes
--   where tablename in ('products', 'businesses') and indexdef ilike '%trgm%';
