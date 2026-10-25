-- carehub_20261027_directory_field_link
-- APPLIED 2026-10-25 to szdybxmgmhndoytqanfb as version 20261025010459.
--
-- Business Directory x Live Field Activity (docs/superpowers/specs/2026-10-24-directory-field-link-design.md).
--
-- 1. Customers derived from field visits. A customer is the place a visit named: a directory listing
--    (key 'd:<id>') or a map facility (key 'f:<lower(trim(name))>@<lat 3dp>,<lng 3dp>', about 100 m). Visits that
--    name neither are not customers.
--      field_customer_key(...)       the one definition of the key (IMMUTABLE)
--      field_customers(...)          one row per customer: last visit, counts, reps, last order
--      field_customer_visits(...)    the visits of one customer with the orders raised from them
--    Both readers are SECURITY INVOKER: they read field_activities and orders under the caller's own row level
--    security, so a rep gets customers only from visits they may read, and a field manager the team's. They return
--    no directory data beyond the name stored on the visit; the directory stays platform-admin only
--    (owner decision 2026-10-22, carehub_20261208_directory_company_lockdown).
--
-- 2. directory_suggestions: a rep suggests a business the directory does not know; the platform admin reviews it.
--      INSERT  a member of the company, for that company. Who suggested it (staff id, name, email), the status
--              (pending) and the review fields are set by the database, never taken from the client. At most 20
--              per company per 24 hours.
--      SELECT  the platform admin, the person who suggested it, the company's field managers and owner.
--      UPDATE  the platform admin only: status pending -> accepted | rejected, the listing it became, a reason.
--              What was suggested and who suggested it never change.
--      DELETE  not granted to signed-in users.
--
-- Security implications: no new access to directory_businesses. The suggestion holds a business name, address and
-- position typed by a rep, plus the rep's name and email (needed to review it and to show the rep its status);
-- nobody else in the company but field managers and the owner can read it. The insert trigger is SECURITY DEFINER
-- only so it can count the company's suggestions for the daily cap and read the caller's staff name; nobody can call
-- it directly.
--
-- Rollback: DROP TABLE public.directory_suggestions; DROP FUNCTION public.directory_suggestions_before_insert(),
--           public.directory_suggestions_before_update(), public.field_customer_visits(uuid, text, integer),
--           public.field_customers(uuid, uuid, integer, integer), public.field_customer_key(uuid, text, double precision, double precision);

-- ---- 1. customers -------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.field_customer_key(
  p_directory_business_id uuid, p_facility_name text, p_facility_lat double precision, p_facility_lng double precision)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_directory_business_id IS NOT NULL THEN 'd:' || p_directory_business_id::text
    WHEN nullif(btrim(p_facility_name), '') IS NOT NULL THEN
      'f:' || lower(btrim(p_facility_name)) || '@'
        || coalesce(round(p_facility_lat::numeric, 3)::text, '-') || ','
        || coalesce(round(p_facility_lng::numeric, 3)::text, '-')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.field_customers(
  p_business_id uuid, p_staff_id uuid DEFAULT NULL, p_limit integer DEFAULT 500, p_quiet_days integer DEFAULT NULL)
RETURNS TABLE (
  key text, kind text, directory_business_id uuid, name text, address text, category text,
  lat double precision, lng double precision, source text, territory_id uuid,
  last_visit_at timestamptz, last_visit_rep text, last_visit_staff_id uuid, last_activity_id uuid,
  visits_total integer, visits_30d integer, rep_staff_ids uuid[],
  last_order_id uuid, last_order_ref text, last_order_status text, last_order_at timestamptz)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- One pass over the visits: each customer's newest values come from ordered aggregates, not a re-scan per
  -- customer. "Not visited in" (p_quiet_days) is applied BEFORE the limit, so a team with more customers than the
  -- limit still sees every quiet one (they are the oldest, the first the limit would drop).
  WITH v AS (
    SELECT fa.id, fa.created_at, fa.rep_name, fa.staff_id, fa.territory_id,
           fa.directory_business_id, fa.directory_business_name, fa.facility_name, fa.facility_address,
           fa.facility_category, fa.facility_lat, fa.facility_lng, fa.facility_source,
           public.field_customer_key(fa.directory_business_id, fa.facility_name, fa.facility_lat, fa.facility_lng) AS k
      FROM public.field_activities fa
     WHERE fa.business_id = p_business_id
       AND (p_staff_id IS NULL OR fa.staff_id = p_staff_id)
  ), c AS (
    SELECT v.k,
           max(v.created_at) AS last_at,
           (array_agg(v.id ORDER BY v.created_at DESC, v.id))[1] AS last_id,
           (array_agg(v.rep_name ORDER BY v.created_at DESC, v.id))[1] AS last_rep,
           (array_agg(v.staff_id ORDER BY v.created_at DESC, v.id))[1] AS last_staff,
           (array_agg(v.directory_business_id ORDER BY v.created_at DESC, v.id))[1] AS dir_id,
           (array_agg(v.directory_business_name ORDER BY v.created_at DESC, v.id))[1] AS dir_name,
           (array_agg(v.facility_name ORDER BY v.created_at DESC, v.id))[1] AS fac_name,
           (array_agg(v.facility_source ORDER BY v.created_at DESC, v.id))[1] AS fac_source,
           (array_agg(v.facility_address ORDER BY v.created_at DESC, v.id) FILTER (WHERE nullif(btrim(v.facility_address), '') IS NOT NULL))[1] AS address,
           (array_agg(v.facility_category ORDER BY v.created_at DESC, v.id) FILTER (WHERE v.facility_category IS NOT NULL))[1] AS category,
           (array_agg(v.facility_lat ORDER BY v.created_at DESC, v.id) FILTER (WHERE v.facility_lat IS NOT NULL))[1] AS lat,
           (array_agg(v.facility_lng ORDER BY v.created_at DESC, v.id) FILTER (WHERE v.facility_lng IS NOT NULL))[1] AS lng,
           (array_agg(v.territory_id ORDER BY v.created_at DESC, v.id) FILTER (WHERE v.territory_id IS NOT NULL))[1] AS territory,
           count(*)::integer AS total,
           (count(*) FILTER (WHERE v.created_at >= now() - interval '30 days'))::integer AS d30,
           coalesce(array_agg(DISTINCT v.staff_id) FILTER (WHERE v.staff_id IS NOT NULL), '{}') AS reps
      FROM v
     WHERE v.k IS NOT NULL
     GROUP BY v.k
  ), picked AS (
    SELECT c.*
      FROM c
     WHERE coalesce(p_quiet_days, 0) <= 0 OR c.last_at < now() - make_interval(days => p_quiet_days)
     ORDER BY c.last_at DESC, c.k
     LIMIT least(greatest(coalesce(p_limit, 500), 1), 500)
  ), last_order AS (
    SELECT DISTINCT ON (v.k) v.k, o.id, o.order_ref, o.status, o.created_at
      FROM picked p
      JOIN v ON v.k = p.k
      JOIN public.orders o ON o.field_activity_id = v.id AND o.business_id = p_business_id
     ORDER BY v.k, o.created_at DESC, o.id
  )
  SELECT p.k,
         CASE WHEN p.dir_id IS NOT NULL THEN 'directory' ELSE 'facility' END,
         p.dir_id,
         coalesce(nullif(btrim(p.dir_name), ''), btrim(p.fac_name)),
         p.address, p.category, p.lat, p.lng,
         CASE WHEN p.dir_id IS NULL THEN p.fac_source END,
         p.territory,
         p.last_at, p.last_rep, p.last_staff, p.last_id,
         p.total, p.d30, p.reps,
         lo.id, lo.order_ref, lo.status, lo.created_at
    FROM picked p
    LEFT JOIN last_order lo ON lo.k = p.k
   ORDER BY p.last_at DESC, p.k
$$;

CREATE OR REPLACE FUNCTION public.field_customer_visits(p_business_id uuid, p_key text, p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, created_at timestamptz, rep_name text, staff_id uuid, territory_id uuid,
  facility_verified boolean, facility_pending_review boolean, place_verified boolean,
  facility_distance_m integer, gps_accuracy_m integer, photo_count integer, orders jsonb)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT fa.id, fa.created_at, fa.rep_name, fa.staff_id, fa.territory_id,
         fa.facility_verified, fa.facility_pending_review, fa.place_verified,
         fa.facility_distance_m, fa.gps_accuracy_m,
         coalesce(array_length(fa.photo_paths, 1), 0),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'created_at', o.created_at)
                                    ORDER BY o.created_at DESC)
                     FROM public.orders o
                    WHERE o.field_activity_id = fa.id AND o.business_id = p_business_id), '[]'::jsonb)
    FROM public.field_activities fa
   WHERE fa.business_id = p_business_id
     AND public.field_customer_key(fa.directory_business_id, fa.facility_name, fa.facility_lat, fa.facility_lng) = p_key
   ORDER BY fa.created_at DESC, fa.id
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

REVOKE ALL ON FUNCTION public.field_customer_key(uuid, text, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.field_customers(uuid, uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.field_customer_visits(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.field_customer_key(uuid, text, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.field_customers(uuid, uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.field_customer_visits(uuid, text, integer) TO authenticated, service_role;

-- ---- 2. suggestions -----------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.directory_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  suggested_by_staff_id uuid,
  suggested_by_name text,
  suggested_by_email text,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  business_type text NOT NULL CHECK (business_type IN ('pharmacy', 'hospital', 'clinic', 'laboratory', 'distributor', 'retail', 'other')),
  address text CHECK (address IS NULL OR char_length(address) <= 300),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  directory_business_id uuid REFERENCES public.directory_businesses(id) ON DELETE SET NULL,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_suggestions_business_created_idx ON public.directory_suggestions (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS directory_suggestions_status_created_idx ON public.directory_suggestions (status, created_at);

-- Who suggested it is the caller, the status starts pending, and a company sends at most 20 a day. SECURITY DEFINER
-- to count suggestions the caller cannot see and read the caller's staff name. Inside a definer function
-- current_user is the owner, so a signed-in caller is recognised by the role setting PostgREST applies.
CREATE OR REPLACE FUNCTION public.directory_suggestions_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_staff uuid;
BEGIN
  IF coalesce(current_setting('role', true), 'none') <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.business_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.current_business_ids() b WHERE b = NEW.business_id) THEN
    RAISE EXCEPTION 'You can only suggest a business for your own company' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.directory_suggestions s
       WHERE s.business_id = NEW.business_id AND s.created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'Too many suggestions today' USING ERRCODE = 'P0001';
  END IF;
  v_staff := public.caller_staff_id(NEW.business_id);
  NEW.suggested_by_staff_id := v_staff;
  NEW.suggested_by_name := CASE
    WHEN v_staff IS NOT NULL THEN (SELECT s.full_name FROM public.staff s WHERE s.id = v_staff)
    ELSE (SELECT b.name FROM public.businesses b WHERE b.id = NEW.business_id AND lower(b.email) = lower(auth.email()))
  END;
  NEW.suggested_by_email := auth.email();
  NEW.status := 'pending';
  NEW.directory_business_id := NULL;
  NEW.review_note := NULL;
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  NEW.created_at := now();
  RETURN NEW;
END $$;

-- The review: status moves pending -> accepted | rejected once; what was suggested and by whom never changes.
CREATE OR REPLACE FUNCTION public.directory_suggestions_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF coalesce(current_setting('role', true), 'none') <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.suggested_by_staff_id IS DISTINCT FROM OLD.suggested_by_staff_id
     OR NEW.suggested_by_name IS DISTINCT FROM OLD.suggested_by_name
     OR NEW.suggested_by_email IS DISTINCT FROM OLD.suggested_by_email
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.business_type IS DISTINCT FROM OLD.business_type
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'What was suggested, and by whom, cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected')) THEN
      RAISE EXCEPTION 'A suggestion cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '22023';
    END IF;
    NEW.reviewed_at := now();
    NEW.reviewed_by := auth.email();
  ELSE
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.directory_suggestions_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.directory_suggestions_before_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS directory_suggestions_before_insert ON public.directory_suggestions;
CREATE TRIGGER directory_suggestions_before_insert
  BEFORE INSERT ON public.directory_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.directory_suggestions_before_insert();
DROP TRIGGER IF EXISTS directory_suggestions_before_update ON public.directory_suggestions;
CREATE TRIGGER directory_suggestions_before_update
  BEFORE UPDATE ON public.directory_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.directory_suggestions_before_update();

ALTER TABLE public.directory_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.directory_suggestions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.directory_suggestions TO authenticated;
GRANT ALL ON public.directory_suggestions TO service_role;

DROP POLICY IF EXISTS "directory_suggestions insert by member" ON public.directory_suggestions;
CREATE POLICY "directory_suggestions insert by member" ON public.directory_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.current_business_ids()));
DROP POLICY IF EXISTS "directory_suggestions read" ON public.directory_suggestions;
CREATE POLICY "directory_suggestions read" ON public.directory_suggestions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR suggested_by_email = auth.email() OR public.caller_sees_all_activity(business_id));
DROP POLICY IF EXISTS "directory_suggestions review by platform" ON public.directory_suggestions;
CREATE POLICY "directory_suggestions review by platform" ON public.directory_suggestions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Verify, do not assume.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['field_customer_key', 'field_customers', 'field_customer_visits',
                           'directory_suggestions_before_insert', 'directory_suggestions_before_update'] LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = f) <> 1 THEN
      RAISE EXCEPTION '% must have exactly one overload', f;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('field_customers', 'field_customer_visits') AND prosecdef) THEN
    RAISE EXCEPTION 'the customer readers must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.field_customers(uuid, uuid, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.field_customer_visits(uuid, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the customer readers must not be executable by anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.directory_suggestions_before_insert()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.directory_suggestions_before_update()', 'EXECUTE') THEN
    RAISE EXCEPTION 'the suggestion triggers must not be callable directly';
  END IF;
  IF has_table_privilege('anon', 'public.directory_suggestions', 'SELECT') OR has_table_privilege('anon', 'public.directory_suggestions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.directory_suggestions', 'DELETE') THEN
    RAISE EXCEPTION 'directory_suggestions grants are wrong';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.directory_suggestions'::regclass) THEN
    RAISE EXCEPTION 'directory_suggestions must have row level security on';
  END IF;
END $$;
