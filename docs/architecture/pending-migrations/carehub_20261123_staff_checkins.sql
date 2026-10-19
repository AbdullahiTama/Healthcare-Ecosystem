-- Explicit staff check-ins and location history (Phase 6). PREPARED, NOT APPLIED.
-- Exercised on PGlite by scripts/db-tests/checkins.pglite.mjs; not run on Supabase.
-- Design: docs/architecture/CareHub-Location-and-Privacy.md
--
-- Principles
--  * Events, not tracking. A row exists only because the person pressed a button.
--    Nothing here watches a position continuously.
--  * Distinct events. 'workday_checkin', 'workday_checkout' and 'location_capture'
--    are NOT a login (authentication is Supabase Auth) and NOT a field visit or
--    a submitted activity (field_activities). A nearby GPS fix proves nothing
--    about a customer visit.
--  * Honest failures. A failed capture is stored as status='failed' with a reason
--    and NO coordinates; it can never look like a successful check-in.
--  * Append-only. No UPDATE or DELETE is granted, and a trigger refuses both.
--  * Server truth. created_at is the database clock. The client timestamp is
--    advisory and discarded if implausible. user_id is always auth.uid().
--  * Membership checked in the database. A caller may only write for a business
--    they own or are an ACTIVE staff member of; a client-supplied business id
--    grants nothing by itself.
--  * No direct INSERT grant: writes go through record_checkin().
--  * Managers read through manager_checkin_overview(), which checks
--    is_business_manager() and writes a row to location_access_log, so access to
--    other people's locations is itself recorded. People can read their own rows.
--
-- Depends on: businesses, staff, field_activities, is_business_manager()
-- (carehub_20260823_facility_review_authorization.sql), is_platform_admin().
-- Rollback: DROP TABLE public.location_access_log, public.staff_checkins;
--           DROP FUNCTION public.record_checkin(...), public.manager_checkin_overview(uuid);

CREATE TABLE IF NOT EXISTS public.staff_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  staff_id uuid,              -- NULL when the actor is the business owner
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('workday_checkin','workday_checkout','location_capture')),
  status text NOT NULL CHECK (status IN ('captured','failed')),
  latitude double precision,
  longitude double precision,
  accuracy_m integer CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 1000000),
  location_source text CHECK (location_source IS NULL OR location_source IN ('browser_geolocation','manual')),
  location_label text CHECK (location_label IS NULL OR length(location_label) <= 200),
  failure_reason text CHECK (failure_reason IS NULL OR failure_reason IN ('denied','unavailable','timeout','unsupported','invalid')),
  client_captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_checkins_captured_has_position CHECK (
    status <> 'captured' OR (
      latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
      AND location_source IS NOT NULL AND failure_reason IS NULL)),
  CONSTRAINT staff_checkins_failed_has_no_position CHECK (
    status <> 'failed' OR (
      latitude IS NULL AND longitude IS NULL AND location_source IS NULL AND failure_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_checkins_business_time_idx ON public.staff_checkins (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_checkins_user_time_idx ON public.staff_checkins (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_checkins_staff_time_idx ON public.staff_checkins (business_id, staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.location_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  business_id uuid NOT NULL,
  action text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_access_log_business_idx ON public.location_access_log (business_id, created_at DESC);

-- Append-only, even against the table owner's casual UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.location_tables_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS staff_checkins_append_only ON public.staff_checkins;
CREATE TRIGGER staff_checkins_append_only BEFORE UPDATE OR DELETE ON public.staff_checkins
  FOR EACH ROW EXECUTE FUNCTION public.location_tables_append_only();
DROP TRIGGER IF EXISTS location_access_log_append_only ON public.location_access_log;
CREATE TRIGGER location_access_log_append_only BEFORE UPDATE OR DELETE ON public.location_access_log
  FOR EACH ROW EXECUTE FUNCTION public.location_tables_append_only();

ALTER TABLE public.staff_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_access_log ENABLE ROW LEVEL SECURITY;

-- People can read their own events. Everyone else goes through the audited RPC.
DROP POLICY IF EXISTS staff_checkins_read_own ON public.staff_checkins;
CREATE POLICY staff_checkins_read_own ON public.staff_checkins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The access log is readable by the person who made the access and by platform admins.
DROP POLICY IF EXISTS location_access_log_read ON public.location_access_log;
CREATE POLICY location_access_log_read ON public.location_access_log FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR public.is_platform_admin());

REVOKE ALL ON public.staff_checkins, public.location_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_checkins, public.location_access_log TO authenticated;

-- ---------------------------------------------------------------------------
-- record_checkin: the only write path.
-- Position given (lat AND lng)  -> status 'captured', needs a source, no failure_reason.
-- Position absent (both NULL)   -> status 'failed', needs a failure_reason.
-- A repeat of the same event by the same person within 5 seconds returns the
-- existing row instead of inserting another (double-tap / retry safe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_checkin(
  p_business_id uuid,
  p_event_type text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy_m integer DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_client_captured_at timestamptz DEFAULT NULL
)
RETURNS public.staff_checkins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(auth.email());
  v_staff uuid;
  v_owner boolean;
  v_status text;
  v_client_ts timestamptz := p_client_captured_at;
  v_existing public.staff_checkins;
  r public.staff_checkins;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN ('workday_checkin','workday_checkout','location_capture') THEN
    RAISE EXCEPTION 'Invalid event type' USING ERRCODE = '22023';
  END IF;

  -- Membership, decided here from the caller's own identity.
  SELECT s.id INTO v_staff FROM public.staff s
   WHERE s.business_id = p_business_id AND lower(s.email) = v_email AND s.status = 'active' LIMIT 1;
  v_owner := EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND lower(b.email) = v_email);
  IF v_staff IS NULL AND NOT v_owner THEN
    RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501';
  END IF;

  IF p_lat IS NULL AND p_lng IS NULL THEN
    IF p_failure_reason IS NULL OR p_failure_reason NOT IN ('denied','unavailable','timeout','unsupported','invalid') THEN
      RAISE EXCEPTION 'A check-in without a position must say why it failed' USING ERRCODE = '22023';
    END IF;
    v_status := 'failed';
  ELSE
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = '22023';
    END IF;
    IF p_source IS NULL OR p_source NOT IN ('browser_geolocation','manual') THEN
      RAISE EXCEPTION 'A captured position needs a source' USING ERRCODE = '22023';
    END IF;
    IF p_failure_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A captured position cannot carry a failure reason' USING ERRCODE = '22023';
    END IF;
    v_status := 'captured';
  END IF;

  -- The device clock is advisory only: drop it if it is not plausible.
  IF v_client_ts IS NOT NULL AND (v_client_ts < now() - interval '1 day' OR v_client_ts > now() + interval '5 minutes') THEN
    v_client_ts := NULL;
  END IF;

  SELECT c.* INTO v_existing FROM public.staff_checkins c
   WHERE c.user_id = v_uid AND c.business_id = p_business_id AND c.event_type = p_event_type
     AND c.status = v_status AND c.created_at > now() - interval '5 seconds'
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.staff_checkins (
    business_id, staff_id, user_id, event_type, status, latitude, longitude, accuracy_m,
    location_source, location_label, failure_reason, client_captured_at)
  VALUES (
    p_business_id, v_staff, v_uid, p_event_type, v_status,
    CASE WHEN v_status = 'captured' THEN p_lat END, CASE WHEN v_status = 'captured' THEN p_lng END,
    CASE WHEN v_status = 'captured' THEN p_accuracy_m END,
    CASE WHEN v_status = 'captured' THEN p_source END,
    nullif(left(btrim(p_label), 200), ''),
    CASE WHEN v_status = 'failed' THEN p_failure_reason END, v_client_ts)
  RETURNING * INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.record_checkin(uuid, text, double precision, double precision, integer, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_checkin(uuid, text, double precision, double precision, integer, text, text, text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- manager_checkin_overview: one row per ACTIVE staff member of the business,
-- with their latest explicit check-in and how fresh it is.
--   freshness 'current'     : latest successful event is 60 minutes old or less
--             'stale'       : older than that (the position is shown as OLD, never as live)
--             'unavailable' : no successful event on record
-- A failed attempt newer than the last success is reported separately.
-- Every call is recorded in location_access_log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_checkin_overview(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'Manager access required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb), count(*)
    INTO v_rows, v_n
  FROM (
    SELECT jsonb_build_object(
      'staff_id', s.id,
      'name', s.full_name,
      'role', s.role,
      'last_checkin', CASE WHEN ok_ev.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ok_ev.id, 'event_type', ok_ev.event_type, 'at', ok_ev.created_at,
        'latitude', ok_ev.latitude, 'longitude', ok_ev.longitude, 'accuracy_m', ok_ev.accuracy_m,
        'location_label', ok_ev.location_label, 'source', ok_ev.location_source) END,
      'age_minutes', CASE WHEN ok_ev.id IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - ok_ev.created_at)) / 60)::int END,
      'freshness', CASE WHEN ok_ev.id IS NULL THEN 'unavailable'
                        WHEN ok_ev.created_at >= now() - interval '60 minutes' THEN 'current'
                        ELSE 'stale' END,
      'last_failed_attempt', CASE WHEN bad_ev.id IS NOT NULL AND (ok_ev.id IS NULL OR bad_ev.created_at > ok_ev.created_at)
        THEN jsonb_build_object('at', bad_ev.created_at, 'reason', bad_ev.failure_reason) END,
      'last_activity_at', (SELECT max(fa.created_at) FROM public.field_activities fa WHERE fa.business_id = p_business_id AND fa.staff_id = s.id)
    ) AS x
    FROM public.staff s
    LEFT JOIN LATERAL (
      SELECT c.* FROM public.staff_checkins c
       WHERE c.business_id = p_business_id AND c.staff_id = s.id AND c.status = 'captured'
       ORDER BY c.created_at DESC LIMIT 1) ok_ev ON true
    LEFT JOIN LATERAL (
      SELECT c.* FROM public.staff_checkins c
       WHERE c.business_id = p_business_id AND c.staff_id = s.id AND c.status = 'failed'
       ORDER BY c.created_at DESC LIMIT 1) bad_ev ON true
    WHERE s.business_id = p_business_id AND s.status = 'active'
  ) t;

  INSERT INTO public.location_access_log (actor_id, business_id, action, row_count)
  VALUES (auth.uid(), p_business_id, 'checkin_overview', COALESCE(v_n, 0));

  RETURN jsonb_build_object('rows', v_rows, 'generatedAt', now(), 'currentWindowMinutes', 60);
END $$;

REVOKE ALL ON FUNCTION public.manager_checkin_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_checkin_overview(uuid) TO authenticated;
