-- CareFind Hub: Directory spec gaps (spec 0001)
-- Migration: carefind_20261002_directory_spec_gaps.sql
-- Purpose: Bring the live directory schema to the spec 0001 target.
-- All statements are additive and idempotent. Table is empty so new
-- NOT NULL constraints are zero risk. No rows are deleted or altered
-- except backfilling the new is_demo flag to false.

-- =====================================================
-- 1. Demo flag (spec: demo rows tagged, excluded everywhere)
-- =====================================================
ALTER TABLE public.business_directory
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;

UPDATE public.business_directory
  SET is_demo = false
  WHERE is_demo IS NULL;

ALTER TABLE public.business_directory
  ALTER COLUMN is_demo SET DEFAULT false;

ALTER TABLE public.business_directory
  ALTER COLUMN is_demo SET NOT NULL;

-- =====================================================
-- 2. Required fields (spec: name plus category plus state)
-- Name is already NOT NULL. Table is empty: verified 0 rows.
-- =====================================================
ALTER TABLE public.business_directory
  ALTER COLUMN state SET NOT NULL;

ALTER TABLE public.business_directory
  ALTER COLUMN category_id SET NOT NULL;

-- =====================================================
-- 3. Directory RLS (spec AC-8)
-- Signed-in scoped read. Logged-out readers denied contact details.
-- Writes: platform admin OR active CareFind admin. The admin_users
-- check is kept so current CareFind admins are never locked out:
-- is_platform_admin() reads CareHub businesses by auth email and
-- CareFind admins do not pass it on their own.
-- =====================================================
DROP POLICY IF EXISTS business_directory_select ON public.business_directory;
DROP POLICY IF EXISTS directory_public_read ON public.business_directory;
DROP POLICY IF EXISTS business_directory_insert ON public.business_directory;
DROP POLICY IF EXISTS business_directory_update ON public.business_directory;
DROP POLICY IF EXISTS business_directory_delete ON public.business_directory;
DROP POLICY IF EXISTS directory_admin_all ON public.business_directory;

CREATE POLICY directory_signed_in_read ON public.business_directory
  FOR SELECT
  TO authenticated
  USING (is_active = true AND is_demo = false);

CREATE POLICY directory_admin_write ON public.business_directory
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY directory_admin_update ON public.business_directory
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY directory_admin_delete ON public.business_directory
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- 4. Category write policies accept platform admin too.
-- Public read stays: category names carry no PII.
-- =====================================================
DROP POLICY IF EXISTS business_categories_insert ON public.business_categories;
DROP POLICY IF EXISTS business_categories_update ON public.business_categories;
DROP POLICY IF EXISTS business_categories_delete ON public.business_categories;

CREATE POLICY categories_admin_insert ON public.business_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY categories_admin_update ON public.business_categories
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY categories_admin_delete ON public.business_categories
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS business_subcategories_insert ON public.business_subcategories;
DROP POLICY IF EXISTS business_subcategories_update ON public.business_subcategories;
DROP POLICY IF EXISTS business_subcategories_delete ON public.business_subcategories;

CREATE POLICY subcategories_admin_insert ON public.business_subcategories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY subcategories_admin_update ON public.business_subcategories
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY subcategories_admin_delete ON public.business_subcategories
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.auth_user_id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- 5. Nearby search RPC (spec: meters, filters, paging).
-- SECURITY INVOKER so the caller's row rules apply.
-- Defaults: radius 5000 m, max 25000 m, limit 50, max 200.
-- Replaces both legacy overloads below.
-- =====================================================
DROP FUNCTION IF EXISTS public.search_nearby_businesses(numeric, numeric, integer, uuid, integer);
DROP FUNCTION IF EXISTS public.search_nearby_businesses(double precision, double precision, double precision, uuid, integer);

CREATE OR REPLACE FUNCTION public.search_nearby_businesses(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_m INTEGER DEFAULT 5000,
  p_category_id UUID DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_lga TEXT DEFAULT NULL,
  p_verification_status TEXT DEFAULT NULL,
  p_data_source TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  category_name TEXT,
  address TEXT,
  state TEXT,
  lga TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  phone TEXT,
  email TEXT,
  website TEXT,
  verification_status TEXT,
  data_source TEXT,
  distance_m DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_radius INTEGER;
  v_limit INTEGER;
  v_offset INTEGER;
BEGIN
  v_radius := LEAST(GREATEST(p_radius_m, 0), 25000);
  v_limit := LEAST(GREATEST(p_limit, 1), 200);
  v_offset := GREATEST(p_offset, 0);

  RETURN QUERY
  SELECT
    bd.id,
    bd.name,
    bc.name AS category_name,
    bd.address,
    bd.state,
    bd.lga,
    bd.latitude,
    bd.longitude,
    bd.phone,
    bd.email,
    bd.website,
    bd.verification_status,
    bd.data_source,
    ST_Distance(
      bd.location,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
    ) AS distance_m
  FROM public.business_directory bd
  LEFT JOIN public.business_categories bc ON bc.id = bd.category_id
  WHERE bd.is_active = true
    AND bd.is_demo = false
    AND bd.location IS NOT NULL
    AND ST_DWithin(
      bd.location,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      v_radius
    )
    AND (p_category_id IS NULL OR bd.category_id = p_category_id)
    AND (p_state IS NULL OR bd.state = p_state)
    AND (p_lga IS NULL OR bd.lga = p_lga)
    AND (p_verification_status IS NULL OR bd.verification_status = p_verification_status)
    AND (p_data_source IS NULL OR bd.data_source = p_data_source)
  ORDER BY bd.location <-> ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_nearby_businesses(double precision, double precision, integer, uuid, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_nearby_businesses(double precision, double precision, integer, uuid, text, text, text, text, integer, integer) TO authenticated;

-- =====================================================
-- 6. Stats RPC (spec: totals plus breakdown plus last import).
-- SECURITY INVOKER so counts respect the caller's row rules.
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_business_stats()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM public.business_directory WHERE is_active = true AND is_demo = false),
    'verified', (SELECT COUNT(*) FROM public.business_directory WHERE is_active = true AND is_demo = false AND verification_status = 'verified'),
    'unverified', (SELECT COUNT(*) FROM public.business_directory WHERE is_active = true AND is_demo = false AND verification_status = 'unverified'),
    'pending', (SELECT COUNT(*) FROM public.business_directory WHERE is_active = true AND is_demo = false AND verification_status = 'pending'),
    'rejected', (SELECT COUNT(*) FROM public.business_directory WHERE is_active = true AND is_demo = false AND verification_status = 'rejected'),
    'by_category', (SELECT COALESCE(jsonb_object_agg(bc.name, counts.count), '{}'::jsonb)
      FROM (SELECT category_id, COUNT(*) FROM public.business_directory
        WHERE is_active = true AND is_demo = false GROUP BY category_id) counts
      JOIN public.business_categories bc ON bc.id = counts.category_id),
    'by_state', (SELECT COALESCE(jsonb_object_agg(state, count), '{}'::jsonb)
      FROM (SELECT state, COUNT(*) FROM public.business_directory
        WHERE is_active = true AND is_demo = false AND state IS NOT NULL GROUP BY state) s),
    'last_import', (SELECT row_to_json(b) FROM (SELECT filename, total_records,
        successful_records, duplicate_records, invalid_records, status, created_at, completed_at
        FROM public.business_import_batches ORDER BY created_at DESC LIMIT 1) b)
  );
$$;

REVOKE ALL ON FUNCTION public.get_business_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_stats() TO authenticated;

-- =====================================================
-- 7. Duplicate finder excludes demo rows.
-- =====================================================
CREATE OR REPLACE FUNCTION public.find_duplicate_businesses(
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_threshold NUMERIC DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  normalized_name TEXT,
  phone TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  similarity_score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized_name TEXT;
BEGIN
  v_normalized_name := LOWER(p_name);
  v_normalized_name := REGEXP_REPLACE(v_normalized_name, '[^\w\s]', '', 'g');
  v_normalized_name := REGEXP_REPLACE(v_normalized_name, '\s+', ' ', 'g');
  v_normalized_name := TRIM(v_normalized_name);

  RETURN QUERY
  SELECT
    bd.id,
    bd.name,
    bd.normalized_name,
    bd.phone,
    bd.latitude,
    bd.longitude,
    CASE
      WHEN bd.normalized_name = v_normalized_name THEN 1.0
      ELSE similarity(bd.normalized_name, v_normalized_name)::NUMERIC
    END AS similarity_score
  FROM public.business_directory bd
  WHERE bd.is_active = true
    AND bd.is_demo = false
    AND (
      similarity(bd.normalized_name, v_normalized_name) >= p_threshold
      OR (p_phone IS NOT NULL AND bd.phone IS NOT NULL AND
        REGEXP_REPLACE(bd.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g'))
      OR (p_latitude IS NOT NULL AND p_longitude IS NOT NULL AND
        bd.latitude IS NOT NULL AND bd.longitude IS NOT NULL AND
        ST_DWithin(
          bd.location,
          ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
          100
        ))
    )
    AND (p_category_id IS NULL OR bd.category_id = p_category_id)
  ORDER BY similarity_score DESC
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_businesses(text, text, numeric, numeric, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_duplicate_businesses(text, text, numeric, numeric, uuid, numeric) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'Directory spec gaps migration applied successfully';
END $$;
