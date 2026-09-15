-- CareFind Smart Facility Discovery — location enrichment for discovery engine
-- Adds lga/area to businesses, indexes for (state,lga,city) partitioning,
-- and facility cache improvements. PCN/MLSCN/NAFDAC noted as future enrichment.

-- 1. businesses.lga + area (nullable text) for state/LGA/city/area discovery
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS lga text,
  ADD COLUMN IF NOT EXISTS area text;

COMMENT ON COLUMN public.businesses.lga IS 'Local Government Area — 774 Nigerian LGAs, nullable until backfilled from address/state';
COMMENT ON COLUMN public.businesses.area IS 'Area/neighbourhood within LGA/city — free text for City-Area mode, nullable';

-- Backfill lga from city where possible? left null for manual/app backfill; no data migration here.

-- 2. Indexes for discovery partitioning
CREATE INDEX IF NOT EXISTS businesses_state_lga_city_idx
  ON public.businesses (state, lga, city);
CREATE INDEX IF NOT EXISTS businesses_lga_idx
  ON public.businesses (lga);
CREATE INDEX IF NOT EXISTS businesses_area_idx
  ON public.businesses (area);

-- 3. facilities_cache improvements
CREATE INDEX IF NOT EXISTS facilities_cache_business_id_idx
  ON public.facilities_cache (business_id);
CREATE INDEX IF NOT EXISTS facilities_cache_business_category_idx
  ON public.facilities_cache (business_id, category);

-- 4. rep_added_facilities improvements
CREATE INDEX IF NOT EXISTS rep_added_facilities_business_status_idx
  ON public.rep_added_facilities (business_id, status);

-- 5. facilities_cache business_id index already exists via FK; ensure business_id is not null
-- No new RLS — existing policies already cover new columns

-- Note: PCN/MLSCN/NAFDAC registries are enrichment sources, not primary directory.
-- Future: ingest as materialized views or external tables joined via business name/phone match,
-- with source='regulatory' and confidence boost, not as primary rows.
