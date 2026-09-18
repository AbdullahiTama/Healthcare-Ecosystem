-- CareFind Hub: Business Directory Functions
-- Migration: carefind_20261001_business_directory_functions.sql
-- Purpose: Create database functions and triggers

-- =====================================================
-- Function: update_business_location()
-- Purpose: Auto-populate GEOGRAPHY from lat/lng
-- =====================================================
CREATE OR REPLACE FUNCTION update_business_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-populating location
CREATE TRIGGER trigger_update_business_location
BEFORE INSERT OR UPDATE ON business_directory
FOR EACH ROW EXECUTE FUNCTION update_business_location();

-- =====================================================
-- Function: normalize_business_name()
-- Purpose: Normalize name for deduplication
-- =====================================================
CREATE OR REPLACE FUNCTION normalize_business_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Convert to lowercase
  NEW.normalized_name := LOWER(NEW.name);
  -- Remove punctuation
  NEW.normalized_name := REGEXP_REPLACE(NEW.normalized_name, '[^\w\s]', '', 'g');
  -- Collapse whitespace
  NEW.normalized_name := REGEXP_REPLACE(NEW.normalized_name, '\s+', ' ', 'g');
  -- Trim
  NEW.normalized_name := TRIM(NEW.normalized_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for normalizing name
CREATE TRIGGER trigger_normalize_business_name
BEFORE INSERT OR UPDATE ON business_directory
FOR EACH ROW EXECUTE FUNCTION normalize_business_name();

-- =====================================================
-- Function: generate_business_slug()
-- Purpose: Generate URL-friendly slug from name
-- =====================================================
CREATE OR REPLACE FUNCTION generate_business_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Generate base slug from name
  base_slug := LOWER(NEW.name);
  base_slug := REGEXP_REPLACE(base_slug, '[^\w\s-]', '', 'g');
  base_slug := REGEXP_REPLACE(base_slug, '\s+', '-', 'g');
  base_slug := TRIM(base_slug, '-');
  
  -- Check for uniqueness and append counter if needed
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM business_directory WHERE slug = final_slug AND id != COALESCE(NEW.id, gen_random_uuid())) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for generating slug
CREATE TRIGGER trigger_generate_business_slug
BEFORE INSERT ON business_directory
FOR EACH ROW EXECUTE FUNCTION generate_business_slug();

-- =====================================================
-- Function: search_nearby_businesses()
-- Purpose: Find businesses within radius
-- =====================================================
CREATE OR REPLACE FUNCTION search_nearby_businesses(
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_radius_km INTEGER DEFAULT 5,
  p_category_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  category_name TEXT,
  address TEXT,
  latitude DECIMAL,
  longitude DECIMAL,
  phone TEXT,
  verification_status TEXT,
  distance_km DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bd.id,
    bd.name,
    bc.name as category_name,
    bd.address,
    bd.latitude,
    bd.longitude,
    bd.phone,
    bd.verification_status,
    ROUND((ST_Distance(bd.location, ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography) / 1000)::NUMERIC, 2) as distance_km
  FROM business_directory bd
  LEFT JOIN business_categories bc ON bd.category_id = bc.id
  WHERE bd.is_active = true
    AND bd.location IS NOT NULL
    AND ST_DWithin(
      bd.location,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      p_radius_km * 1000
    )
    AND (p_category_id IS NULL OR bd.category_id = p_category_id)
  ORDER BY bd.location <-> ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Function: calculate_distance()
-- Purpose: Calculate distance between two coordinates
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_distance(
  p_lat1 DECIMAL,
  p_lng1 DECIMAL,
  p_lat2 DECIMAL,
  p_lng2 DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  point1 GEOGRAPHY;
  point2 GEOGRAPHY;
  distance_m DECIMAL;
BEGIN
  point1 := ST_SetSRID(ST_MakePoint(p_lng1, p_lat1), 4326)::geography;
  point2 := ST_SetSRID(ST_MakePoint(p_lng2, p_lat2), 4326)::geography;
  distance_m := ST_Distance(point1, point2);
  RETURN ROUND((distance_m / 1000)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Function: find_duplicate_businesses()
-- Purpose: Find potential duplicate businesses
-- =====================================================
CREATE OR REPLACE FUNCTION find_duplicate_businesses(
  p_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_latitude DECIMAL DEFAULT NULL,
  p_longitude DECIMAL DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_threshold DECIMAL DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  normalized_name TEXT,
  phone TEXT,
  latitude DECIMAL,
  longitude DECIMAL,
  similarity_score DECIMAL
) AS $$
DECLARE
  v_normalized_name TEXT;
BEGIN
  -- Normalize the input name
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
      ELSE similarity(bd.normalized_name, v_normalized_name)::DECIMAL
    END as similarity_score
  FROM business_directory bd
  WHERE bd.is_active = true
    AND (
      -- Name similarity
      similarity(bd.normalized_name, v_normalized_name) >= p_threshold
      OR
      -- Phone match (if provided)
      (p_phone IS NOT NULL AND bd.phone IS NOT NULL AND 
       REGEXP_REPLACE(bd.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g'))
      OR
      -- Location proximity (if provided, within 100m)
      (p_latitude IS NOT NULL AND p_longitude IS NOT NULL AND 
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
$$ LANGUAGE plpgsql;

-- =====================================================
-- Function: get_business_stats()
-- Purpose: Get business directory statistics
-- =====================================================
CREATE OR REPLACE FUNCTION get_business_stats()
RETURNS TABLE (
  total_businesses BIGINT,
  verified_businesses BIGINT,
  unverified_businesses BIGINT,
  active_businesses BIGINT,
  businesses_by_category JSONB,
  businesses_by_state JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM business_directory WHERE is_active = true) as total_businesses,
    (SELECT COUNT(*) FROM business_directory WHERE verification_status = 'verified' AND is_active = true) as verified_businesses,
    (SELECT COUNT(*) FROM business_directory WHERE verification_status = 'unverified' AND is_active = true) as unverified_businesses,
    (SELECT COUNT(*) FROM business_directory WHERE is_active = true) as active_businesses,
    (SELECT COALESCE(jsonb_object_agg(bc.name, counts.count), '{}'::jsonb)
     FROM (
       SELECT category_id, COUNT(*) as count
       FROM business_directory
       WHERE is_active = true
       GROUP BY category_id
     ) counts
     JOIN business_categories bc ON counts.category_id = bc.id
    ) as businesses_by_category,
    (SELECT COALESCE(jsonb_object_agg(bd.state, state_counts.count), '{}'::jsonb)
     FROM (
       SELECT state, COUNT(*) as count
       FROM business_directory
       WHERE is_active = true AND state IS NOT NULL
       GROUP BY state
     ) state_counts
    ) as businesses_by_state;
END;
$$ LANGUAGE plpgsql;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Business Directory functions created successfully';
END $$;
