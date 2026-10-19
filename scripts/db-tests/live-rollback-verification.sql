-- ROLLED-BACK verification of the check-ins and activity-access migrations against a LIVE Supabase schema.
-- Run in the SQL editor of the target project (or via the MCP execute_sql tool). It creates its own
-- fixtures (rollback.invalid emails), applies the two migrations (minus no-op DROP ... IF EXISTS lines),
-- runs the checks as authenticated/anon roles, then ends in a deliberate RAISE EXCEPTION so EVERYTHING
-- (DDL, fixtures) rolls back. The failure message IS the report: each line is PASS or FAIL.
-- It must be run BEFORE the migrations are applied (it creates the same objects). Last run 2026-10-19 on
-- project szdybxmgmhndoytqanfb: 54 PASS; the 2 FAILs were wrong expectations, corrected in this copy.
DO $live$
DECLARE
  A uuid; B uuid;
  repA1 uuid; repA2 uuid; mgrA uuid; dirA uuid; repB1 uuid;
  u_repA1 uuid := gen_random_uuid(); u_repA2 uuid := gen_random_uuid(); u_mgrA uuid := gen_random_uuid();
  u_dirA uuid := gen_random_uuid(); u_repB1 uuid := gen_random_uuid(); u_ownA uuid := gen_random_uuid();
  u_ownB uuid := gen_random_uuid(); u_out uuid := gen_random_uuid();
  e_repA1 text := 'rb-repa1@rollback.invalid'; e_repA2 text := 'rb-repa2@rollback.invalid'; e_mgrA text := 'rb-mgra@rollback.invalid';
  e_dirA text := 'rb-dira@rollback.invalid'; e_repB1 text := 'rb-repb1@rollback.invalid'; e_ownA text := 'rb-owna@rollback.invalid';
  e_ownB text := 'rb-ownb@rollback.invalid'; e_out text := 'rb-out@rollback.invalid';
  act_own uuid; act_owner uuid;
  r text; res_txt text := '';
BEGIN
  EXECUTE $h$
    CREATE FUNCTION pg_temp.run_as(p_uid uuid, p_email text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
    DECLARE r text;
    BEGIN
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_uid, 'email', p_email)::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE p_sql INTO r;
        RESET ROLE;
        RETURN coalesce(r, '(null)');
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        RETURN 'ERR:' || sqlstate;
      END;
    END $f$;
  $h$;
  EXECUTE $h$
    CREATE FUNCTION pg_temp.run_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
    DECLARE r text;
    BEGIN
      BEGIN
        PERFORM set_config('request.jwt.claims', '', true);
        SET LOCAL ROLE anon;
        EXECUTE p_sql INTO r;
        RESET ROLE;
        RETURN coalesce(r, '(null)');
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        RETURN 'ERR:' || sqlstate;
      END;
    END $f$;
  $h$;
  EXECUTE $h$
    CREATE FUNCTION pg_temp.chk(p_name text, p_got text, p_want text) RETURNS text LANGUAGE sql AS $f$
      SELECT CASE WHEN p_got = p_want THEN 'PASS ' || p_name ELSE 'FAIL ' || p_name || '  (got ' || p_got || ', wanted ' || p_want || ')' END
    $f$;
  $h$;

  INSERT INTO public.businesses (name, owner, email) VALUES ('RB Company A', 'RB Owner A', e_ownA) RETURNING id INTO A;
  INSERT INTO public.businesses (name, owner, email) VALUES ('RB Company B', 'RB Owner B', e_ownB) RETURNING id INTO B;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (A, 'RB Rep One', e_repA1, 'Sales Rep', 'active') RETURNING id INTO repA1;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (A, 'RB Rep Two', e_repA2, 'Sales Rep', 'active') RETURNING id INTO repA2;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (A, 'RB Manager', e_mgrA, 'Regional Manager', 'active') RETURNING id INTO mgrA;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (A, 'RB Dir Lead', e_dirA, 'Marketing Lead', 'active') RETURNING id INTO dirA;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (B, 'RB Rep B', e_repB1, 'Sales Rep', 'active') RETURNING id INTO repB1;
  INSERT INTO public.roles (business_id, name, permissions) VALUES (A, 'Marketing Lead', '{"canManageDirectory": true}'::jsonb);

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
CREATE OR REPLACE FUNCTION public.location_tables_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER staff_checkins_append_only BEFORE UPDATE OR DELETE ON public.staff_checkins
  FOR EACH ROW EXECUTE FUNCTION public.location_tables_append_only();
CREATE TRIGGER location_access_log_append_only BEFORE UPDATE OR DELETE ON public.location_access_log
  FOR EACH ROW EXECUTE FUNCTION public.location_tables_append_only();
REVOKE ALL ON FUNCTION public.location_tables_append_only() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.staff_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_checkins_read_own ON public.staff_checkins FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY location_access_log_read ON public.location_access_log FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR public.is_platform_admin());
REVOKE ALL ON public.staff_checkins, public.location_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_checkins, public.location_access_log TO authenticated;
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
  res_txt := res_txt || pg_temp.chk('ACL record_checkin: anon cannot execute', has_function_privilege('anon', 'public.record_checkin(uuid,text,double precision,double precision,integer,text,text,text,timestamptz)', 'execute')::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL record_checkin: authenticated can', has_function_privilege('authenticated', 'public.record_checkin(uuid,text,double precision,double precision,integer,text,text,text,timestamptz)', 'execute')::text, 'true') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL manager_checkin_overview: anon cannot', has_function_privilege('anon', 'public.manager_checkin_overview(uuid)', 'execute')::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL trigger function: nobody can call it', (has_function_privilege('anon', 'public.location_tables_append_only()', 'execute') OR has_function_privilege('authenticated', 'public.location_tables_append_only()', 'execute'))::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('table staff_checkins: anon has no privileges', (has_table_privilege('anon', 'public.staff_checkins', 'select') OR has_table_privilege('anon', 'public.staff_checkins', 'insert'))::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('table staff_checkins: authenticated cannot insert/update/delete', (has_table_privilege('authenticated', 'public.staff_checkins', 'insert') OR has_table_privilege('authenticated', 'public.staff_checkins', 'update') OR has_table_privilege('authenticated', 'public.staff_checkins', 'delete'))::text, 'false') || E'\n';

  r := pg_temp.run_as(u_repA1, e_repA1, format('select status from public.record_checkin(%L::uuid, ''workday_checkin'', 6.5244, 3.3792, 25, ''browser_geolocation'', null, null, null)', A));
  res_txt := res_txt || pg_temp.chk('rep checks in', r, 'captured') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('select status from public.record_checkin(%L::uuid, ''workday_checkin'', 6.5, 3.4, 25, ''browser_geolocation'', null, null, null)', B));
  res_txt := res_txt || pg_temp.chk('rep cannot check in to another company (forged id)', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_out, e_out, format('select status from public.record_checkin(%L::uuid, ''workday_checkin'', 6.5, 3.4, 25, ''browser_geolocation'', null, null, null)', A));
  res_txt := res_txt || pg_temp.chk('non-member cannot check in', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_anon(format('select status from public.record_checkin(%L::uuid, ''workday_checkin'', 6.5, 3.4, 25, ''browser_geolocation'', null, null, null)', A));
  res_txt := res_txt || pg_temp.chk('anonymous cannot check in', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('select status || '':'' || coalesce(latitude::text, ''no-coords'') from public.record_checkin(%L::uuid, ''workday_checkin'', null, null, null, null, null, ''denied'', null)', A));
  res_txt := res_txt || pg_temp.chk('failed capture is stored as failed with no coordinates', r, 'failed:no-coords') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('select count(*)::text from public.staff_checkins'));
  res_txt := res_txt || pg_temp.chk('rep reads only their own check-ins', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, 'select count(*)::text from public.staff_checkins where user_id <> auth.uid()');
  res_txt := res_txt || pg_temp.chk('a colleague cannot read others check-ins', r, '0') || E'\n';
  r := pg_temp.run_as(u_repB1, e_repB1, 'select count(*)::text from public.staff_checkins');
  res_txt := res_txt || pg_temp.chk('another company reads none', r, '0') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (insert into public.staff_checkins (business_id, user_id, event_type, status, failure_reason) values (%L::uuid, auth.uid(), ''workday_checkin'', ''failed'', ''denied'') returning 1) select count(*)::text from x', A));
  res_txt := res_txt || pg_temp.chk('no direct insert into check-ins', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, 'with x as (update public.staff_checkins set latitude = 0 returning 1) select count(*)::text from x');
  res_txt := res_txt || pg_temp.chk('no update of check-ins', r, 'ERR:42501') || E'\n';

  r := pg_temp.run_as(u_mgrA, e_mgrA, format('select jsonb_array_length(public.manager_checkin_overview(%L::uuid) -> ''rows'')::text', A));
  res_txt := res_txt || pg_temp.chk('manager sees all 4 active staff', r, '4') || E'\n';
  r := pg_temp.run_as(u_mgrA, e_mgrA, format('select (select x->>''freshness'' from jsonb_array_elements(public.manager_checkin_overview(%L::uuid) -> ''rows'') x where x->>''name'' = ''RB Rep One'')', A));
  res_txt := res_txt || pg_temp.chk('rep one is current', r, 'current') || E'\n';
  r := pg_temp.run_as(u_mgrA, e_mgrA, format('select (select x->>''freshness'' from jsonb_array_elements(public.manager_checkin_overview(%L::uuid) -> ''rows'') x where x->>''name'' = ''RB Rep Two'')', A));
  res_txt := res_txt || pg_temp.chk('rep two (failed attempt only) is unavailable', r, 'unavailable') || E'\n';
  r := pg_temp.run_as(u_ownA, e_ownA, format('select jsonb_array_length(public.manager_checkin_overview(%L::uuid) -> ''rows'')::text', A));
  res_txt := res_txt || pg_temp.chk('the owner can use the overview', r, '4') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('select public.manager_checkin_overview(%L::uuid)::text', A));
  res_txt := res_txt || pg_temp.chk('a plain rep cannot use the overview', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repB1, e_repB1, format('select public.manager_checkin_overview(%L::uuid)::text', A));
  res_txt := res_txt || pg_temp.chk('another company cannot use the overview', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_ownB, e_ownB, format('select public.manager_checkin_overview(%L::uuid)::text', A));
  res_txt := res_txt || pg_temp.chk('another company owner cannot use the overview', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_anon(format('select public.manager_checkin_overview(%L::uuid)::text', A));
  res_txt := res_txt || pg_temp.chk('anonymous cannot use the overview', r, 'ERR:42501') || E'\n';
  res_txt := res_txt || pg_temp.chk('each successful overview was logged (4 successful calls)', (SELECT count(*)::text FROM public.location_access_log WHERE business_id = A), '4') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, 'select count(*)::text from public.location_access_log');
  res_txt := res_txt || pg_temp.chk('a rep cannot read the access log', r, '0') || E'\n';

  INSERT INTO public.field_activities (business_id, staff_id, rep_name) VALUES (A, repA1, 'RB act1') RETURNING id INTO act_own;
  INSERT INTO public.field_activities (business_id, staff_id, rep_name) VALUES (A, NULL, 'RB owner act') RETURNING id INTO act_owner;
  r := pg_temp.run_as(u_repA2, e_repA2, format('select count(*)::text from public.field_activities where id = %L::uuid', act_own));
  res_txt := res_txt || pg_temp.chk('BEFORE: a colleague can read another reps activity (S3 live)', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (insert into public.field_activities (business_id, staff_id, rep_name) values (%L::uuid, %L::uuid, ''forged'') returning 1) select count(*)::text from x', A, repA2));
  res_txt := res_txt || pg_temp.chk('BEFORE: a rep can log as another rep (S5 live)', r, '1') || E'\n';

CREATE OR REPLACE FUNCTION public.caller_staff_id(bid uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.id FROM public.staff s
   WHERE s.business_id = bid AND lower(s.email) = lower(auth.email()) AND s.status = 'active'
   LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.caller_sees_all_activity(bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_platform_admin() OR public.is_business_manager(bid) OR public.can_manage_directory(bid)
$$;
CREATE OR REPLACE FUNCTION public.is_activity_viewer(aid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activity_viewers v
    JOIN public.field_activities a ON a.id = v.activity_id
    WHERE v.activity_id = aid
      AND public.caller_staff_id(a.business_id) IS NOT NULL
      AND v.staff_id = public.caller_staff_id(a.business_id))
$$;
CREATE OR REPLACE FUNCTION public.activity_business(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT business_id FROM public.field_activities WHERE id = aid $$;
CREATE OR REPLACE FUNCTION public.activity_author(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT staff_id FROM public.field_activities WHERE id = aid $$;
REVOKE ALL ON FUNCTION public.caller_staff_id(uuid), public.caller_sees_all_activity(uuid),
  public.is_activity_viewer(uuid), public.activity_business(uuid), public.activity_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_staff_id(uuid), public.caller_sees_all_activity(uuid),
  public.is_activity_viewer(uuid), public.activity_business(uuid), public.activity_author(uuid) TO authenticated, service_role;
CREATE POLICY field_activities_select_restrict ON public.field_activities
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.caller_sees_all_activity(business_id)
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
    OR public.is_activity_viewer(id)
  );
CREATE POLICY field_activities_insert_restrict ON public.field_activities
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(business_id)
  );
CREATE POLICY field_activities_update_restrict ON public.field_activities
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY field_activities_delete_restrict ON public.field_activities
  AS RESTRICTIVE FOR DELETE TO authenticated USING (public.is_platform_admin());
CREATE POLICY activity_viewers_insert_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id)))
  );
CREATE POLICY activity_viewers_modify_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));
CREATE POLICY activity_viewers_delete_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));
CREATE POLICY activity_reactions_insert_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
CREATE POLICY activity_reactions_modify_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
CREATE POLICY activity_reactions_delete_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
CREATE POLICY activity_comments_insert_restrict ON public.activity_comments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
CREATE POLICY activity_comments_modify_restrict ON public.activity_comments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
CREATE POLICY activity_comments_delete_restrict ON public.activity_comments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
  res_txt := res_txt || pg_temp.chk('ACL caller_sees_all_activity: anon cannot', has_function_privilege('anon', 'public.caller_sees_all_activity(uuid)', 'execute')::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL caller_sees_all_activity: authenticated can', has_function_privilege('authenticated', 'public.caller_sees_all_activity(uuid)', 'execute')::text, 'true') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL caller_staff_id: anon cannot', has_function_privilege('anon', 'public.caller_staff_id(uuid)', 'execute')::text, 'false') || E'\n';
  res_txt := res_txt || pg_temp.chk('ACL is_activity_viewer: anon cannot', has_function_privilege('anon', 'public.is_activity_viewer(uuid)', 'execute')::text, 'false') || E'\n';

  r := pg_temp.run_as(u_repA1, e_repA1, format('select count(*)::text from public.field_activities where id = %L::uuid', act_own));
  res_txt := res_txt || pg_temp.chk('author sees own activity', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('select count(*)::text from public.field_activities where id = %L::uuid', act_own));
  res_txt := res_txt || pg_temp.chk('untagged colleague does NOT see it', r, '0') || E'\n';
  r := pg_temp.run_as(u_mgrA, e_mgrA, 'select count(*)::text from public.field_activities where rep_name like ''RB %'' and business_id = ' || quote_literal(A));
  res_txt := res_txt || pg_temp.chk('a manager sees all of the company activity', r, '2') || E'\n';
  r := pg_temp.run_as(u_ownA, e_ownA, 'select count(*)::text from public.field_activities where rep_name like ''RB %'' and business_id = ' || quote_literal(A));
  res_txt := res_txt || pg_temp.chk('the owner sees all of it', r, '2') || E'\n';
  r := pg_temp.run_as(u_dirA, e_dirA, 'select count(*)::text from public.field_activities where rep_name like ''RB %'' and business_id = ' || quote_literal(A));
  res_txt := res_txt || pg_temp.chk('a directory manager (not a manager role) sees all of it', r, '2') || E'\n';
  r := pg_temp.run_as(u_repB1, e_repB1, 'select count(*)::text from public.field_activities');
  res_txt := res_txt || pg_temp.chk('another company sees none of the test activity', r, '0') || E'\n';
  r := pg_temp.run_anon('select count(*)::text from public.field_activities');
  res_txt := res_txt || pg_temp.chk('anonymous gets a permission error, exactly as before this change (is_platform_admin() is not executable by anon)', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (insert into public.field_activities (business_id, staff_id, rep_name) values (%L::uuid, %L::uuid, ''forged'') returning 1) select count(*)::text from x', A, repA2));
  res_txt := res_txt || pg_temp.chk('a rep can no longer log as another rep', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (insert into public.field_activities (business_id, staff_id, rep_name) values (%L::uuid, %L::uuid, ''mine'') returning 1) select count(*)::text from x', A, repA1));
  res_txt := res_txt || pg_temp.chk('a rep can still log as themselves', r, '1') || E'\n';
  r := pg_temp.run_as(u_ownA, e_ownA, format('with x as (insert into public.field_activities (business_id, staff_id, rep_name) values (%L::uuid, null, ''owner2'') returning 1) select count(*)::text from x', A));
  res_txt := res_txt || pg_temp.chk('the owner can still log (staff_id null)', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('with x as (insert into public.activity_viewers (activity_id, staff_id, viewer_name) values (%L::uuid, %L::uuid, ''x'') returning 1) select count(*)::text from x', act_own, repA2));
  res_txt := res_txt || pg_temp.chk('an untagged colleague cannot tag themselves on', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (insert into public.activity_viewers (activity_id, staff_id, viewer_name) values (%L::uuid, %L::uuid, ''RB Rep Two'') returning 1) select count(*)::text from x', act_own, repA2));
  res_txt := res_txt || pg_temp.chk('the author can tag a colleague', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('select count(*)::text from public.field_activities where id = %L::uuid', act_own));
  res_txt := res_txt || pg_temp.chk('...and the tagged colleague then sees it', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('with x as (insert into public.activity_reactions (activity_id, staff_id, actor_name) values (%L::uuid, %L::uuid, ''x'') returning 1) select count(*)::text from x', act_own, mgrA));
  res_txt := res_txt || pg_temp.chk('a rep cannot react as someone else', r, 'ERR:42501') || E'\n';
  r := pg_temp.run_as(u_repA2, e_repA2, format('with x as (insert into public.activity_reactions (activity_id, staff_id, actor_name) values (%L::uuid, %L::uuid, ''RB Rep Two'') returning 1) select count(*)::text from x', act_own, repA2));
  res_txt := res_txt || pg_temp.chk('a rep can react as themselves', r, '1') || E'\n';
  r := pg_temp.run_as(u_repA1, e_repA1, format('with x as (update public.field_activities set lat = 0 where id = %L::uuid returning 1) select count(*)::text from x', act_own));
  res_txt := res_txt || pg_temp.chk('the author cannot edit a submitted activity', r, '0') || E'\n';
  res_txt := res_txt || pg_temp.chk('delete/update on activities are restricted to platform admin (policies present)', (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_activities' AND policyname IN ('field_activities_delete_restrict', 'field_activities_update_restrict') AND permissive = 'RESTRICTIVE'), '2') || E'
';

  r := pg_temp.run_as(u_repA1, e_repA1, 'select count(*)::text from public.staff');
  res_txt := res_txt || pg_temp.chk('staff are still readable by their own company (4 in A)', r, '4') || E'\n';
  r := pg_temp.run_as(u_dirA, e_dirA, format('select count(*)::text from public.directory_visit_totals(%L::uuid, now() - interval ''30 days'')', A));
  res_txt := res_txt || pg_temp.chk('live coverage function runs for a directory manager', CASE WHEN r LIKE 'ERR:%' THEN r ELSE 'ok' END, 'ok') || E'\n';
  r := pg_temp.run_as(u_dirA, e_dirA, format('select count(*)::text from public.directory_unvisited(%L::uuid, now() - interval ''30 days'')', A));
  res_txt := res_txt || pg_temp.chk('live unvisited function runs for a directory manager', CASE WHEN r LIKE 'ERR:%' THEN r ELSE 'ok' END, 'ok') || E'\n';

  RAISE EXCEPTION 'LIVE-RUN-RESULTS %', res_txt;
END
$live$;
