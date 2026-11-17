-- ============================================================================
-- Hospital Model: the boundary and roles enforced by the database, clinical
-- history kept, and a clinical audit trail (CODE_AUDIT A34, A35, A37)
--
-- STATUS: APPLIED 2026-11-17 as version 20261117092614, with owner approval,
--   after carehub_20270123 (20261117092425) and before carehub_20270125
--   (20261117092916).
--   Rehearsed first: 0124 and 0125 together in one transaction ending in a
--   raised error (so rolled back), with a probe signed in as the real Owner,
--   Receptionist, Nurse, Doctor, Lab Technician and Pharmacist of one hospital,
--   a pharmacy owner and anon. Applied, then the same probe run again (rolled
--   back; no probe rows remain). Both runs: each role reads only its
--   department's records (Receptionist and Nurse see no consultations; Lab
--   Technician sees lab requests, no consultations; Pharmacist prescriptions
--   only); register -> at triage; nurse -> at doctor; consultation with a
--   medicine, a test and a scan -> at lab, all four saved; the lab sees the
--   request with the patient's name; dispensing does not discharge while the
--   lab is pending, and records who dispensed. Refused, with their messages: a
--   second open visit, a nurse consulting, a second consultation, member
--   DELETE (patients, consultations), owner and pharmacy business-type
--   changes, a pharmacy registering a patient (and it sees 0 patients), anon.
--   anon holds no privilege on the eight tables; authenticated no DELETE or
--   TRUNCATE. Security advisor: no new error; the new SECURITY DEFINER
--   functions are executable by authenticated (intended: each checks the
--   caller, as can_adjust_client_totals; accepted) and none by anon.
--
-- PROBLEM (read live 2026-11-16/17)
-- -------
-- * A34: each of the eight hospital tables has one FOR ALL policy scoped only
--   by business membership, so every member (a Cashier included) can read,
--   change and delete every clinical record through the API. Every clinical
--   row references its patient ON DELETE CASCADE: deleting a patient deletes
--   their history. Nothing records who wrote or changed a clinical record.
-- * A35: no policy checks the business type (3 live patients belong to
--   non-hospital businesses); and an owner can change their own
--   businesses.business_type through the API: the "own business row" policy
--   allows the update, authenticated holds column UPDATE, and neither
--   guard_business_privileged_columns nor businesses_operating_model_guard
--   checks the column. The specification (3, 13.2) requires that ordinary
--   administrators cannot change the business model.
-- * A37: anon and authenticated hold every privilege on the eight tables,
--   TRUNCATE included.
--
-- FIX
-- ---
-- 1. businesses_guard_business_type (BEFORE UPDATE, as the caller): only
--    platform admins (and trusted database roles) change business_type after
--    registration; an admin's change is written to admin_audit_log by
--    log_business_type_change. Registration (INSERT) is unchanged.
-- 2. hospital_clinical_modules(business): the clinical modules the caller has
--    in that business, mirroring apps/carehub/src/lib/permissions.js:
--      - modules exist only for business_type 'hospital'; 'lab' also for
--        'laboratory' (MODULES.lab.types);
--      - the Owner (is_business_owner: the business email, an owner above it,
--        or staff with role 'Owner') has every module;
--      - a custom role (a roles row named as the staff member's role) has the
--        clinical modules in its permissions.nav (getPerms: a custom role
--        takes precedence over a preset of the same name; no nav = the
--        default staff nav, which has none);
--      - a preset role: Receptionist reception, Nurse triage, Doctor doctor,
--        Lab Technician lab, Pharmacist rx_inbox (ROLES in permissions.js);
--        every other preset none.
--    hospital_can(business, VARIADIC modules) is true when the caller has any
--    of them. Both SECURITY DEFINER and answer only for the caller (the
--    pattern of can_adjust_client_totals), so policies can call them.
-- 3. Policies, per command (no client DELETE on any table):
--      patients          read: any clinical module | insert: reception | update: any clinical module
--      triage            read: triage, doctor      | insert: triage
--      consultations     read: doctor              | insert: doctor          (no update: notes are not edited in place)
--      prescriptions     read: doctor, rx_inbox    | insert: doctor          | update: rx_inbox
--      lab_requests      read: doctor, lab         | insert: doctor          | update: lab
--      lab_results       read: doctor, lab         | insert: lab
--      imaging_requests  read: doctor, imaging     | insert: doctor          | update: imaging
--      patient_messages  read: any clinical module | insert: any clinical module
--    Platform admins: read only (they had full access).
-- 4. hospital_row_matches_patient (BEFORE INSERT OR UPDATE): every clinical
--    row names a patient and a business, the patient belongs to that business,
--    a linked consultation / lab request belongs to the same patient, and
--    neither the patient nor the business of a row can be changed afterwards.
--    The same trigger stops a patient being moved to another business.
-- 5. The patient foreign keys (and lab_results -> lab_requests,
--    prescriptions -> consultations) become NO ACTION instead of CASCADE: a
--    patient with clinical records cannot be deleted. NO ACTION rather than
--    RESTRICT so that the platform's hard delete of a whole business, which
--    removes the patients and their records in one statement, still works.
-- 6. clinical_audit_log: every INSERT and UPDATE on the eight tables, with
--    actor, row, patient and the previous values of changed columns. Written
--    only by the trigger; UPDATE, DELETE and TRUNCATE refused for every role;
--    readable by the Owner and platform admins. Reads are not audited
--    (Postgres has no read trigger): that comes with Phase 1's read functions.
-- 7. Grants: anon loses everything on the eight tables; authenticated loses
--    DELETE, TRUNCATE, REFERENCES and TRIGGER.
--
-- WHO IS AFFECTED (live 2026-11-17: 4 hospitals; staff Receptionist, Nurse,
-- Doctor, Lab Technician, Pharmacist, one each, all preset roles)
-- ----------------
-- Each keeps the screen they have. They lose API access to other departments'
-- clinical data. Managers and Cashiers had no clinical screens and now have no
-- API access either. Imaging has no preset role: only the Owner, or a custom
-- role with Imaging ticked, can work it (as in the app today). Non-hospital
-- businesses lose access to patient records: 3 live patients belong to such
-- businesses and stay in the database, readable by platform admins.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- Narrows access only. The two new helpers are SECURITY DEFINER and executable
-- by authenticated; they only describe the caller's own access. The audit
-- trigger and the consistency trigger are SECURITY DEFINER and not executable
-- by clients.
--
-- ROLLBACK
-- --------
-- DROP the policies created here and re-create the baseline FOR ALL policies
-- (carehub_20270123); GRANT ALL ON the eight tables TO anon, authenticated;
-- re-add the foreign keys ON DELETE CASCADE; DROP TRIGGER
-- hospital_row_matches_patient / hospital_audit_row ON each table and
-- businesses_guard_business_type ON businesses; DROP the functions; keep
-- clinical_audit_log (evidence).
--
-- TESTS
-- -----
-- apps/carefind/src/test/hospital/hospitalAccess.db.test.js
-- ============================================================================

-- ── 1. The business type is set at registration and changed only by CareHub ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_business_type_change(p_business_id uuid, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform staff can change a business type.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_audit_log (actor_admin_id, action, target_table, target_id, before, after)
  VALUES (auth.uid(), 'business.business_type_changed', 'businesses', p_business_id::text,
          jsonb_build_object('business_type', p_old), jsonb_build_object('business_type', p_new));
END;
$$;

REVOKE ALL ON FUNCTION public.log_business_type_change(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_business_type_change(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.businesses_guard_business_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.business_type IS NOT DISTINCT FROM OLD.business_type THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;
  IF current_user = 'anon' THEN
    RAISE EXCEPTION 'The business type is chosen at registration and can only be changed by CareHub.' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.is_platform_admin(), false) THEN
    RAISE EXCEPTION 'The business type is chosen at registration and can only be changed by CareHub.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.log_business_type_change(OLD.id, OLD.business_type, NEW.business_type);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.businesses_guard_business_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS businesses_guard_business_type ON public.businesses;
CREATE TRIGGER businesses_guard_business_type
  BEFORE UPDATE OF business_type ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_guard_business_type();

-- ── 2. The caller's clinical modules in a business ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hospital_clinical_modules(p_business_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_type    text;
  v_allowed text[];
  v_role    text;
  v_perms   jsonb;
  v_mods    text[];
BEGIN
  IF auth.uid() IS NULL OR p_business_id IS NULL
     OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN
    RETURN '{}'::text[];
  END IF;

  SELECT b.business_type INTO v_type FROM public.businesses b WHERE b.id = p_business_id;
  v_allowed := CASE
    WHEN v_type = 'hospital'   THEN ARRAY['reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging']
    WHEN v_type = 'laboratory' THEN ARRAY['lab']
    ELSE '{}'::text[]
  END;
  IF cardinality(v_allowed) = 0 THEN
    RETURN '{}'::text[];
  END IF;

  IF public.is_business_owner(p_business_id) THEN
    RETURN v_allowed;
  END IF;

  SELECT s.role INTO v_role
    FROM public.staff s
   WHERE s.business_id = p_business_id AND s.status = 'active'
     AND lower(s.email) = lower(btrim(auth.email()))
   LIMIT 1;
  IF v_role IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  SELECT r.permissions INTO v_perms FROM public.roles r WHERE r.business_id = p_business_id AND r.name = v_role LIMIT 1;
  IF FOUND THEN
    v_mods := CASE WHEN jsonb_typeof(v_perms -> 'nav') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(v_perms -> 'nav'))
                   ELSE '{}'::text[] END;
  ELSE
    v_mods := CASE v_role
      WHEN 'Receptionist'   THEN ARRAY['reception']
      WHEN 'Nurse'          THEN ARRAY['triage']
      WHEN 'Doctor'         THEN ARRAY['doctor']
      WHEN 'Lab Technician' THEN ARRAY['lab']
      WHEN 'Pharmacist'     THEN ARRAY['rx_inbox']
      ELSE '{}'::text[]
    END;
  END IF;

  RETURN ARRAY(SELECT m FROM unnest(v_allowed) m WHERE m = ANY (v_mods));
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_clinical_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_clinical_modules(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hospital_can(p_business_id uuid, VARIADIC p_modules text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(public.hospital_clinical_modules(p_business_id) && p_modules, false)
$$;

REVOKE ALL ON FUNCTION public.hospital_can(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_can(uuid, text[]) TO authenticated, service_role;

-- Who may read the clinical audit trail: the Owner and platform admins.
CREATE OR REPLACE FUNCTION public.clinical_audit_can_read(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(public.is_platform_admin(), false) OR coalesce(public.is_business_owner(p_business_id), false)
$$;

REVOKE ALL ON FUNCTION public.clinical_audit_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinical_audit_can_read(uuid) TO authenticated, service_role;

-- ── 3. Policies ───────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "patients of own business" ON public.patients;
DROP POLICY IF EXISTS "triage of own business" ON public.triage;
DROP POLICY IF EXISTS "consultations of own business" ON public.consultations;
DROP POLICY IF EXISTS "prescriptions of own business" ON public.prescriptions;
DROP POLICY IF EXISTS "lab_requests of own business" ON public.lab_requests;
DROP POLICY IF EXISTS "lab_results via parent lab_requests" ON public.lab_results;
DROP POLICY IF EXISTS "imaging_requests of own business" ON public.imaging_requests;
DROP POLICY IF EXISTS "patient_messages via parent patients" ON public.patient_messages;

CREATE POLICY "patients: read" ON public.patients FOR SELECT
  USING (public.hospital_can(business_id, 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging') OR public.is_platform_admin());
CREATE POLICY "patients: register" ON public.patients FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'reception'));
CREATE POLICY "patients: move along" ON public.patients FOR UPDATE
  USING (public.hospital_can(business_id, 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging'))
  WITH CHECK (public.hospital_can(business_id, 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging'));

CREATE POLICY "triage: read" ON public.triage FOR SELECT
  USING (public.hospital_can(business_id, 'triage', 'doctor') OR public.is_platform_admin());
CREATE POLICY "triage: record" ON public.triage FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'triage'));

CREATE POLICY "consultations: read" ON public.consultations FOR SELECT
  USING (public.hospital_can(business_id, 'doctor') OR public.is_platform_admin());
CREATE POLICY "consultations: record" ON public.consultations FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'doctor'));

CREATE POLICY "prescriptions: read" ON public.prescriptions FOR SELECT
  USING (public.hospital_can(business_id, 'doctor', 'rx_inbox') OR public.is_platform_admin());
CREATE POLICY "prescriptions: prescribe" ON public.prescriptions FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'doctor'));
CREATE POLICY "prescriptions: dispense" ON public.prescriptions FOR UPDATE
  USING (public.hospital_can(business_id, 'rx_inbox'))
  WITH CHECK (public.hospital_can(business_id, 'rx_inbox'));

CREATE POLICY "lab_requests: read" ON public.lab_requests FOR SELECT
  USING (public.hospital_can(business_id, 'doctor', 'lab') OR public.is_platform_admin());
CREATE POLICY "lab_requests: request" ON public.lab_requests FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'doctor'));
CREATE POLICY "lab_requests: work" ON public.lab_requests FOR UPDATE
  USING (public.hospital_can(business_id, 'lab'))
  WITH CHECK (public.hospital_can(business_id, 'lab'));

CREATE POLICY "lab_results: read" ON public.lab_results FOR SELECT
  USING (public.hospital_can(business_id, 'doctor', 'lab') OR public.is_platform_admin());
CREATE POLICY "lab_results: record" ON public.lab_results FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'lab'));

CREATE POLICY "imaging_requests: read" ON public.imaging_requests FOR SELECT
  USING (public.hospital_can(business_id, 'doctor', 'imaging') OR public.is_platform_admin());
CREATE POLICY "imaging_requests: request" ON public.imaging_requests FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'doctor'));
CREATE POLICY "imaging_requests: report" ON public.imaging_requests FOR UPDATE
  USING (public.hospital_can(business_id, 'imaging'))
  WITH CHECK (public.hospital_can(business_id, 'imaging'));

CREATE POLICY "patient_messages: read" ON public.patient_messages FOR SELECT
  USING (public.hospital_can(business_id, 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging') OR public.is_platform_admin());
CREATE POLICY "patient_messages: post" ON public.patient_messages FOR INSERT
  WITH CHECK (public.hospital_can(business_id, 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging'));

-- ── 4. Every clinical row belongs to its patient's business, for good ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hospital_row_matches_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_patient uuid;
  v_ok boolean;
BEGIN
  IF TG_TABLE_NAME = 'patients' THEN
    IF NEW.business_id IS NULL THEN
      RAISE EXCEPTION 'A patient must belong to a business.' USING ERRCODE = '23502';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'A patient cannot be moved to another business.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_patient := (v_new ->> 'patient_id')::uuid;
  IF v_patient IS NULL OR NEW.business_id IS NULL THEN
    RAISE EXCEPTION 'A clinical record must name its patient and business.' USING ERRCODE = '23502';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    IF v_new -> 'patient_id' IS DISTINCT FROM v_old -> 'patient_id' OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR v_new -> 'consultation_id' IS DISTINCT FROM v_old -> 'consultation_id'
       OR v_new -> 'lab_request_id' IS DISTINCT FROM v_old -> 'lab_request_id' THEN
      RAISE EXCEPTION 'A clinical record cannot be moved to another patient, business, consultation or request.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = v_patient AND p.business_id = NEW.business_id) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'That patient is not a patient of this business.' USING ERRCODE = '42501';
  END IF;

  IF v_new ? 'consultation_id' AND (v_new ->> 'consultation_id') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.consultations c
                    WHERE c.id = (v_new ->> 'consultation_id')::uuid AND c.patient_id = v_patient AND c.business_id = NEW.business_id) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'That consultation is not this patient''s.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_new ? 'lab_request_id' THEN
    SELECT EXISTS (SELECT 1 FROM public.lab_requests l
                    WHERE l.id = (v_new ->> 'lab_request_id')::uuid AND l.patient_id = v_patient AND l.business_id = NEW.business_id) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'That lab request is not this patient''s.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_row_matches_patient() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'triage', 'consultations', 'prescriptions', 'lab_requests', 'lab_results', 'imaging_requests', 'patient_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hospital_row_matches_patient ON public.%I', t);
    EXECUTE format('CREATE TRIGGER hospital_row_matches_patient BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.hospital_row_matches_patient()', t);
  END LOOP;
END $$;

-- ── 5. Clinical history is not deleted with the patient ───────────────────────────────────────────────────────
ALTER TABLE public.triage DROP CONSTRAINT IF EXISTS triage_patient_id_fkey,
  ADD CONSTRAINT triage_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.consultations DROP CONSTRAINT IF EXISTS consultations_patient_id_fkey,
  ADD CONSTRAINT consultations_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_patient_id_fkey,
  ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_consultation_id_fkey,
  ADD CONSTRAINT prescriptions_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id);
ALTER TABLE public.lab_requests DROP CONSTRAINT IF EXISTS lab_requests_patient_id_fkey,
  ADD CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.lab_results DROP CONSTRAINT IF EXISTS lab_results_patient_id_fkey,
  ADD CONSTRAINT lab_results_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.lab_results DROP CONSTRAINT IF EXISTS lab_results_lab_request_id_fkey,
  ADD CONSTRAINT lab_results_lab_request_id_fkey FOREIGN KEY (lab_request_id) REFERENCES public.lab_requests(id);
ALTER TABLE public.imaging_requests DROP CONSTRAINT IF EXISTS imaging_requests_patient_id_fkey,
  ADD CONSTRAINT imaging_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
ALTER TABLE public.patient_messages DROP CONSTRAINT IF EXISTS patient_messages_patient_id_fkey,
  ADD CONSTRAINT patient_messages_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);

-- ── 6. Clinical audit trail ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL,
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  patient_id  uuid,
  action      text NOT NULL CHECK (action IN ('insert', 'update')),
  actor_id    uuid,
  actor_name  text,
  changed     jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_audit_log_business_idx ON public.clinical_audit_log (business_id, at DESC);
CREATE INDEX IF NOT EXISTS clinical_audit_log_patient_idx ON public.clinical_audit_log (patient_id, at DESC);

ALTER TABLE public.clinical_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinical_audit_log: owner and platform read" ON public.clinical_audit_log;
CREATE POLICY "clinical_audit_log: owner and platform read" ON public.clinical_audit_log FOR SELECT
  USING (public.clinical_audit_can_read(business_id));

REVOKE ALL ON public.clinical_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinical_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.clinical_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.clinical_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'The clinical audit trail cannot be changed or deleted.' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.clinical_audit_log_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clinical_audit_log_append_only ON public.clinical_audit_log;
CREATE TRIGGER clinical_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.clinical_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.clinical_audit_log_append_only();
DROP TRIGGER IF EXISTS clinical_audit_log_no_truncate ON public.clinical_audit_log;
CREATE TRIGGER clinical_audit_log_no_truncate
  BEFORE TRUNCATE ON public.clinical_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.clinical_audit_log_append_only();

CREATE OR REPLACE FUNCTION public.hospital_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new     jsonb := to_jsonb(NEW);
  v_changed jsonb;
  v_actor   text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(o.key, o.value) INTO v_changed
      FROM jsonb_each(to_jsonb(OLD)) o
     WHERE o.value IS DISTINCT FROM (v_new -> o.key);
    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  -- The signed-in member's name (staff name, or the Owner's); none for platform staff and database jobs.
  IF auth.uid() IS NOT NULL THEN
    SELECT a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
  END IF;

  INSERT INTO public.clinical_audit_log (business_id, table_name, row_id, patient_id, action, actor_id, actor_name, changed)
  VALUES (NEW.business_id, TG_TABLE_NAME, NEW.id,
          CASE WHEN TG_TABLE_NAME = 'patients' THEN NEW.id ELSE (v_new ->> 'patient_id')::uuid END,
          lower(TG_OP), auth.uid(), v_actor, v_changed);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_audit_row() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'triage', 'consultations', 'prescriptions', 'lab_requests', 'lab_results', 'imaging_requests', 'patient_messages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hospital_audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER hospital_audit_row AFTER INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.hospital_audit_row()', t);
  END LOOP;
END $$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.patients, public.triage, public.consultations, public.prescriptions, public.lab_requests,
  public.lab_results, public.imaging_requests, public.patient_messages FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.patients, public.triage, public.consultations, public.prescriptions,
  public.lab_requests, public.lab_results, public.imaging_requests, public.patient_messages FROM authenticated;
