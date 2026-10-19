-- Reviewed merge of an imported row into an existing directory business.
-- PREPARED, NOT APPLIED. Tested on PGlite (scripts/db-tests/merge.pglite.mjs).
-- Depends on carehub_20261120_business_directory.sql and carehub_20261121_directory_imports.sql.
--
-- Principles
--  * Authorised: directory administrators only (is_directory_admin()), checked here,
--    not just in the screen.
--  * Never silent. The caller sends exactly which fields to change and how; the
--    function applies only what the rules below allow and reports what it skipped.
--  * Never destructive by default. A non-blank existing value changes only when the
--    caller asks for 'overwrite' on that field AND the record is not verified.
--    Blank existing values can always be filled.
--  * Fixed scope. Only the fields listed in v_allowed can be merged. Name,
--    verification, provenance (data_source/source_ref), activity flag and ids are
--    never touched, so a merge cannot launder an import into a verified record or
--    rename a trusted one. Use the normal edit for those.
--  * Coordinates move together (both or neither).
--  * Retry-safe. Each (record, import row reference) merges once. Re-running the same
--    file returns what happened the first time and changes nothing, so it cannot undo
--    a later manual edit.
--  * Auditable. One audit row (action 'merge', note carries the import reference)
--    with the full before/after of the record, plus a row in directory_import_merges.
--
-- Rollback: DROP FUNCTION public.directory_merge_import_row(uuid, text, jsonb);
--           DROP TABLE public.directory_import_merges;
--           and re-run carehub_20261120_business_directory.sql to restore the audit trigger.

CREATE TABLE IF NOT EXISTS public.directory_import_merges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directory_business_id uuid NOT NULL REFERENCES public.directory_businesses(id) ON DELETE CASCADE,
  source_ref text NOT NULL,
  applied jsonb NOT NULL DEFAULT '{}'::jsonb,
  skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  merged_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (directory_business_id, source_ref)
);

ALTER TABLE public.directory_import_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS directory_import_merges_admin_read ON public.directory_import_merges;
CREATE POLICY directory_import_merges_admin_read ON public.directory_import_merges FOR SELECT TO authenticated
  USING (public.is_directory_admin());
REVOKE ALL ON public.directory_import_merges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.directory_import_merges TO authenticated;

-- The audit trigger gains an optional action/note supplied by a trusted function
-- through transaction-local settings. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.directory_businesses_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_action text := nullif(current_setting('app.directory_audit_action', true), '');
  v_note text := nullif(current_setting('app.directory_audit_note', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.directory_audit (directory_business_id, action, actor_id, after)
      VALUES (NEW.id, 'create', auth.uid(), to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'updated_at' - 'updated_by' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'updated_by' THEN
      INSERT INTO public.directory_audit (directory_business_id, action, actor_id, before, after, note)
        VALUES (NEW.id,
          COALESCE(v_action,
            CASE WHEN NEW.is_active <> OLD.is_active THEN CASE WHEN NEW.is_active THEN 'reactivate' ELSE 'deactivate' END
                 WHEN NEW.verification_status <> OLD.verification_status THEN 'verification'
                 ELSE 'update' END),
          auth.uid(), to_jsonb(OLD), to_jsonb(NEW), v_note);
    END IF;
  ELSE
    INSERT INTO public.directory_audit (directory_business_id, action, actor_id, before)
      VALUES (OLD.id, 'delete', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;

-- p_changes: { "<field>": { "value": <json>, "mode": "fill" | "overwrite" }, ... }
-- Returns { alreadyMerged, applied: {field: value}, skipped: [{field, reason}] }
-- reason: same | existing_value_kept | verified_record
CREATE OR REPLACE FUNCTION public.directory_merge_import_row(p_id uuid, p_source_ref text, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_allowed text[] := ARRAY['category_id','subcategory_id','business_type','address','city','state','lga',
                            'latitude','longitude','phone','email','website','description'];
  v_row public.directory_businesses;
  v_before jsonb;
  v_prior public.directory_import_merges;
  v_field text;
  v_spec jsonb;
  v_mode text;
  v_new jsonb;
  v_old jsonb;
  v_blank boolean;
  v_apply jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_set text := '';
  v_rec public.directory_businesses;
  v_lat_blank boolean;
BEGIN
  IF NOT public.is_directory_admin() THEN
    RAISE EXCEPTION 'Directory administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_source_ref IS NULL OR btrim(p_source_ref) = '' THEN
    RAISE EXCEPTION 'An import reference is required' USING ERRCODE = '22023';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to merge' USING ERRCODE = '22023';
  END IF;

  -- Retry-safe: report the earlier outcome, change nothing.
  SELECT * INTO v_prior FROM public.directory_import_merges WHERE directory_business_id = p_id AND source_ref = p_source_ref;
  IF v_prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('alreadyMerged', true, 'applied', v_prior.applied, 'skipped', v_prior.skipped);
  END IF;

  SELECT * INTO v_row FROM public.directory_businesses WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Directory business not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION 'Reactivate this business before merging into it' USING ERRCODE = '22023';
  END IF;
  v_before := to_jsonb(v_row);

  -- Unknown fields are an error, never silently ignored.
  FOR v_field IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT (v_field = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Field % cannot be merged', v_field USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Coordinates are one unit.
  IF (p_changes ? 'latitude') <> (p_changes ? 'longitude') THEN
    RAISE EXCEPTION 'Latitude and longitude must be merged together' USING ERRCODE = '22023';
  END IF;

  v_lat_blank := v_before->>'latitude' IS NULL AND v_before->>'longitude' IS NULL;

  FOR v_field IN SELECT jsonb_object_keys(p_changes) LOOP
    IF v_field = 'longitude' THEN CONTINUE; END IF; -- handled with latitude
    v_spec := p_changes -> v_field;
    v_mode := v_spec ->> 'mode';
    IF v_mode IS NULL OR v_mode NOT IN ('fill','overwrite') OR NOT (v_spec ? 'value') THEN
      RAISE EXCEPTION 'Field % needs a value and a mode (fill or overwrite)', v_field USING ERRCODE = '22023';
    END IF;
    v_new := v_spec -> 'value';
    IF v_new IS NULL OR v_new = 'null'::jsonb OR btrim(v_new #>> '{}') = '' THEN
      RAISE EXCEPTION 'Field % has no value to merge', v_field USING ERRCODE = '22023';
    END IF;

    IF v_field = 'latitude' THEN
      v_blank := v_lat_blank;
      v_old := jsonb_build_object('latitude', v_before->'latitude', 'longitude', v_before->'longitude');
      IF (p_changes -> 'longitude' -> 'value') IS NULL OR (p_changes -> 'longitude' ->> 'mode') IS DISTINCT FROM v_mode THEN
        RAISE EXCEPTION 'Latitude and longitude must carry the same mode' USING ERRCODE = '22023';
      END IF;
      IF NOT v_blank AND (v_before->>'latitude')::double precision = (v_new #>> '{}')::double precision
                     AND (v_before->>'longitude')::double precision = (p_changes -> 'longitude' -> 'value' #>> '{}')::double precision THEN
        v_skipped := v_skipped || jsonb_build_object('field', 'coordinates', 'reason', 'same');
        CONTINUE;
      END IF;
    ELSE
      v_old := v_before -> v_field;
      v_blank := v_old IS NULL OR v_old = 'null'::jsonb OR btrim(v_old #>> '{}') = '';
      IF NOT v_blank AND lower(btrim(v_old #>> '{}')) = lower(btrim(v_new #>> '{}')) THEN
        v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'same');
        CONTINUE;
      END IF;
    END IF;

    IF v_blank OR (v_mode = 'overwrite' AND NOT (v_row.verification_status = 'verified')) THEN
      IF v_field = 'latitude' THEN
        v_apply := v_apply || jsonb_build_object('latitude', v_new, 'longitude', p_changes -> 'longitude' -> 'value');
      ELSE
        v_apply := v_apply || jsonb_build_object(v_field, v_new);
      END IF;
    ELSIF v_mode = 'overwrite' THEN
      v_skipped := v_skipped || jsonb_build_object('field', CASE WHEN v_field = 'latitude' THEN 'coordinates' ELSE v_field END, 'reason', 'verified_record');
    ELSE
      v_skipped := v_skipped || jsonb_build_object('field', CASE WHEN v_field = 'latitude' THEN 'coordinates' ELSE v_field END, 'reason', 'existing_value_kept');
    END IF;
  END LOOP;

  IF v_apply <> '{}'::jsonb THEN
    -- One UPDATE, so one audit row. Types are coerced from JSON by the table's own columns.
    v_rec := jsonb_populate_record(NULL::public.directory_businesses, v_apply);
    SELECT string_agg(format('%I = ($1).%I', k, k), ', ') INTO v_set FROM jsonb_object_keys(v_apply) AS k;
    PERFORM set_config('app.directory_audit_action', 'merge', true);
    PERFORM set_config('app.directory_audit_note', 'merge from import ' || left(p_source_ref, 120), true);
    EXECUTE 'UPDATE public.directory_businesses SET ' || v_set || ' WHERE id = $2' USING v_rec, p_id;
    PERFORM set_config('app.directory_audit_action', '', true);
    PERFORM set_config('app.directory_audit_note', '', true);
  END IF;

  INSERT INTO public.directory_import_merges (directory_business_id, source_ref, applied, skipped)
  VALUES (p_id, p_source_ref, v_apply, v_skipped);

  RETURN jsonb_build_object('alreadyMerged', false, 'applied', v_apply, 'skipped', v_skipped);
END $$;

REVOKE ALL ON FUNCTION public.directory_merge_import_row(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_merge_import_row(uuid, text, jsonb) TO authenticated;
