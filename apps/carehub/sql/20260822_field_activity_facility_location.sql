-- Issue #1 (Field Activity Location Capture redesign, 2026-08-22): replace the
-- free-text "Place of Visit" with automatic, GPS-driven facility detection.
--
-- Old flow (issue #8, kept for back-compat): rep typed a place name ->
-- forward geocode -> distance check against GPS. That column set is left in
-- place (place_of_visit / place_coords / place_verified / location_label) so
-- old app builds and the existing feed column keep rendering; we simply stop
-- writing the typed name to place_of_visit (the logger now writes the detected
-- facility name there instead) and derive place_verified from the new
-- distance-only logic.
--
-- New flow: on GPS capture we auto-detect the single closest health facility
-- (Overpass / cached), store its details, and verify by DISTANCE ONLY
-- (gps vs facility coords, within FACILITY_VERIFY_THRESHOLD_M = 150 m). No name
-- matching, ever. A rep-added ("not listed") place is saved with GPS attached
-- and surfaced for everyone near it later via the cache.

-- ---------------------------------------------------------------------------
-- 1. Extend field_activities with facility columns (all nullable / defaulted so
--    existing rows and old app versions keep working).
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS facility_name text,
  ADD COLUMN IF NOT EXISTS facility_address text,
  ADD COLUMN IF NOT EXISTS facility_category text,
  ADD COLUMN IF NOT EXISTS facility_lat double precision,
  ADD COLUMN IF NOT EXISTS facility_lng double precision,
  ADD COLUMN IF NOT EXISTS facility_distance_m integer,
  ADD COLUMN IF NOT EXISTS facility_source text
    CHECK (facility_source IS NULL OR facility_source IN ('detected','rep_added','manual')),
  ADD COLUMN IF NOT EXISTS facility_verified boolean NOT NULL DEFAULT false;

-- Keep place_verified (back-compat read by the old feed path); the logger sets
-- it from the new distance logic so the two never disagree.
COMMENT ON COLUMN public.field_activities.facility_verified IS
  'Distance-only verification: GPS fix within 150 m of the captured facility coordinates. Never name-matched.';
COMMENT ON COLUMN public.field_activities.facility_source IS
  'detected (from Overpass/cache), rep_added (user typed the name, GPS attached), or manual.';

-- ---------------------------------------------------------------------------
-- 2. facilities_cache — discovered facilities near a business, so repeat visits
--    in the same area resolve instantly and offline-tolerant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facilities_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  category text,
  address text,
  source text NOT NULL DEFAULT 'detected',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent upsert key (matches places.js on_conflict target).
CREATE UNIQUE INDEX IF NOT EXISTS facilities_cache_business_name_coords_uniq
  ON public.facilities_cache (business_id, name, lat, lng);

ALTER TABLE public.facilities_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facilities_cache of own business" ON public.facilities_cache;
CREATE POLICY "facilities_cache of own business" ON public.facilities_cache
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. rep_added_facilities — places a rep added because the list was empty.
--    Pending review; surfaced for everyone near the saved GPS on later visits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_added_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','confirmed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rep_added_facilities_business_idx
  ON public.rep_added_facilities (business_id);

ALTER TABLE public.rep_added_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_added_facilities of own business" ON public.rep_added_facilities;
CREATE POLICY "rep_added_facilities of own business" ON public.rep_added_facilities
  FOR ALL
  USING      ((business_id IN (SELECT current_business_ids())) OR is_platform_admin())
  WITH CHECK ((business_id IN (SELECT current_business_ids())) OR is_platform_admin());
