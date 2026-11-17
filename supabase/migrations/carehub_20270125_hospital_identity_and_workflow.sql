-- ============================================================================
-- Hospital Model: clients are the patient identity, and clinical work is
-- saved all-or-nothing (CODE_AUDIT A36, A38)
--
-- STATUS: APPLIED 2026-11-17 as version 20261117092916, with owner approval,
--   after carehub_20270124 (20261117092614); the app change deployed after it.
--   Live result: 11/11 patients linked to 11 new clients (8 at hospitals, 3 at
--   pharmacies), no visit differing from its client, 12 audit rows written
--   by the backfill (11 links and 1 visit whose details were refreshed).
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
-- * A38: Reception writes a separate `patients` row holding the person's
--   biodata, next of kin and insurance, while the hospital "Patients" menu,
--   the POS, debts and appointments use `clients`: one person, two unrelated
--   records. Owner decision 2026-11-17: `clients` is the patient identity.
-- * A36: the Doctor screen saves the consultation, then the prescription,
--   then each request, then the patient's status, as separate requests. The
--   lab and imaging requests name a column (patient_name) those tables do not
--   have, so they fail after the consultation is already saved; a retry saves
--   the consultation again. Rx Inbox discharges the patient on dispensing even
--   when lab or imaging work is still pending.
--
-- FIX
-- ---
-- 1. clients gains next_of_kin_name, next_of_kin_phone and insurance.
-- 2. patients gains client_id (required; same business). A patients row is now
--    one hospital visit of a client. Its name, phone, date of birth, gender,
--    address, next of kin and insurance are a copy kept by the database
--    (patients_from_client): set from the client on every write and refreshed
--    when the client is edited (clients_refresh_patients), so a direct write
--    cannot make them disagree. A visit cannot be moved to another client.
--    The copy is removed in Phase 1, when encounters replace `patients`.
-- 3. Existing patients are linked by hospital_client_for: the client of the
--    same business with the same phone digits (the rule of
--    clients_phone_unique_per_business), else a new client made from the
--    patient's details. Next of kin and insurance fill the client's blanks.
--    Every visit is then refreshed from its client; where the visit's own
--    details differed (an existing client with the same phone), its previous
--    values are kept in clinical_audit_log.
--    A patient inserted without a client (the old Reception screen) is linked
--    the same way.
--    Live 2026-11-17: all 11 patients have a phone and none matches an existing
--    client, so 11 clients are created: 8 at hospitals and 3 at pharmacies
--    (test data of 2026-07-18). Those 3 appear in the pharmacies' client lists
--    and cannot be deleted there while their visit rows exist (delete_clients
--    keeps them, reason 'hospital'); removing that test data is a platform
--    task for the owner to decide.
-- 4. delete_clients keeps a client who has hospital visits, with the reason
--    'hospital' (live definition 2026-11-17, unchanged otherwise).
-- 5. Three functions, SECURITY DEFINER, each checking the caller's clinical
--    module (hospital_can), writing in one transaction, and taking the staff
--    name from the session:
--      register_hospital_visit (reception): creates or updates the client and
--        opens a visit at triage; refuses a second open visit.
--      complete_hospital_consultation (doctor): the consultation, the
--        prescription, the lab request, the imaging requests, the patient's
--        next status and the thread message, or nothing. The patient must be
--        waiting for the doctor, so a repeated submission cannot save twice.
--      dispense_prescription (rx_inbox): marks it dispensed (who, when) and
--        discharges the patient only when they are at the pharmacy or lab and
--        nothing else is pending for them. Stock is not deducted (it never
--        was); that is Phase 2.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- No new access: each function checks the same module the policies of
-- carehub_20270124 require for the writes it makes, and they write only rows
-- of the caller's business. hospital_client_for and the two sync triggers are
-- not executable by clients. Clients' new columns are readable and writable
-- by the members who already read and write clients.
--
-- ROLLBACK
-- --------
-- DROP FUNCTION register_hospital_visit, complete_hospital_consultation,
-- dispense_prescription, hospital_client_for, patients_from_client,
-- clients_refresh_patients (with their triggers); restore delete_clients from
-- carehub_20270111_client_bulk_delete; ALTER TABLE patients DROP COLUMN
-- client_id. The clients' new columns and the clients created for patients
-- can stay. No data is lost: visits keep their copies, and any details the
-- refresh replaced are in clinical_audit_log (changed).
--
-- TESTS
-- -----
-- apps/carefind/src/test/hospital/hospitalIdentityWorkflow.db.test.js
-- ============================================================================

-- ── 1. The client carries next of kin and insurance ───────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS next_of_kin_name  text,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone text,
  ADD COLUMN IF NOT EXISTS insurance         text;

-- ── 2. A visit belongs to a client ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS client_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_client_id_fkey') THEN
    ALTER TABLE public.patients ADD CONSTRAINT patients_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_patients_client_id_fk ON public.patients USING btree (client_id);

-- The client of a business with these phone digits, or a new client from these details. Blank details of an
-- existing client are filled in; nothing it already has is overwritten.
CREATE OR REPLACE FUNCTION public.hospital_client_for(
  p_business_id uuid, p_full_name text, p_phone text, p_date_of_birth text, p_gender text, p_address text,
  p_next_of_kin_name text, p_next_of_kin_phone text, p_insurance text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id uuid;
BEGIN
  IF v_digits <> '' THEN
    SELECT c.id INTO v_id FROM public.clients c
     WHERE c.business_id = p_business_id AND c.phone IS NOT NULL AND btrim(c.phone) <> ''
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = v_digits
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.clients (business_id, full_name, phone, date_of_birth, gender, address, next_of_kin_name, next_of_kin_phone, insurance)
    VALUES (p_business_id, coalesce(nullif(btrim(p_full_name), ''), 'Unnamed patient'), nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_date_of_birth, '')), ''), nullif(btrim(coalesce(p_gender, '')), ''), nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_next_of_kin_name, '')), ''), nullif(btrim(coalesce(p_next_of_kin_phone, '')), ''),
            nullif(btrim(coalesce(p_insurance, '')), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.clients c SET
      date_of_birth     = coalesce(nullif(btrim(c.date_of_birth), ''), nullif(btrim(coalesce(p_date_of_birth, '')), '')),
      gender            = coalesce(nullif(btrim(c.gender), ''), nullif(btrim(coalesce(p_gender, '')), '')),
      address           = coalesce(nullif(btrim(c.address), ''), nullif(btrim(coalesce(p_address, '')), '')),
      next_of_kin_name  = coalesce(nullif(btrim(c.next_of_kin_name), ''), nullif(btrim(coalesce(p_next_of_kin_name, '')), '')),
      next_of_kin_phone = coalesce(nullif(btrim(c.next_of_kin_phone), ''), nullif(btrim(coalesce(p_next_of_kin_phone, '')), '')),
      insurance         = coalesce(nullif(btrim(c.insurance), ''), nullif(btrim(coalesce(p_insurance, '')), ''))
     WHERE c.id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hospital_client_for(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- Existing patients: linked before the copy trigger exists, so their own details are what is matched and copied.
UPDATE public.patients p
   SET client_id = public.hospital_client_for(p.business_id, p.full_name, p.phone, p.date_of_birth, p.gender, p.address,
                                              p.next_of_kin, p.next_of_kin_phone, p.insurance)
 WHERE p.client_id IS NULL;

ALTER TABLE public.patients ALTER COLUMN client_id SET NOT NULL;

-- The visit's copy of the client's details, kept by the database.
CREATE OR REPLACE FUNCTION public.patients_from_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c public.clients%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.client_id IS NULL THEN
    NEW.client_id := public.hospital_client_for(NEW.business_id, NEW.full_name, NEW.phone, NEW.date_of_birth, NEW.gender,
                                                NEW.address, NEW.next_of_kin, NEW.next_of_kin_phone, NEW.insurance);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'A hospital visit cannot be moved to another patient.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = NEW.client_id;
  IF NOT FOUND OR c.business_id IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'That client is not a client of this business.' USING ERRCODE = '42501';
  END IF;

  NEW.full_name         := c.full_name;
  NEW.phone             := c.phone;
  NEW.date_of_birth     := c.date_of_birth;
  NEW.gender            := c.gender;
  NEW.address           := c.address;
  NEW.next_of_kin       := c.next_of_kin_name;
  NEW.next_of_kin_phone := c.next_of_kin_phone;
  NEW.insurance         := c.insurance;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.patients_from_client() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS patients_from_client ON public.patients;
CREATE TRIGGER patients_from_client
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_from_client();

-- Existing visits now show their client's details. Where they differed (a client that already existed with the same
-- phone), the visit's previous values are kept in clinical_audit_log by the audit trigger.
UPDATE public.patients SET client_id = client_id;

-- Editing a client refreshes the copy on their visits.
CREATE OR REPLACE FUNCTION public.clients_refresh_patients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF (NEW.full_name, NEW.phone, NEW.date_of_birth, NEW.gender, NEW.address, NEW.next_of_kin_name, NEW.next_of_kin_phone, NEW.insurance)
     IS DISTINCT FROM
     (OLD.full_name, OLD.phone, OLD.date_of_birth, OLD.gender, OLD.address, OLD.next_of_kin_name, OLD.next_of_kin_phone, OLD.insurance) THEN
    UPDATE public.patients SET client_id = client_id WHERE client_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.clients_refresh_patients() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_refresh_patients ON public.clients;
CREATE TRIGGER clients_refresh_patients
  AFTER UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_refresh_patients();

-- ── 3. A client with hospital visits is kept by delete_clients ────────────────────────────────────────────────
-- Live definition (2026-11-17) with one added reason: 'hospital'.
create or replace function public.delete_clients(p_business_id uuid, p_client_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target     uuid[];
  v_requested  int;
  v_deletion   uuid := gen_random_uuid();
  v_actor_name text;
  v_kept       jsonb;
  v_deletable  uuid[];
  v_deleted    int := 0;
begin
  if not public.can_delete_clients(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can delete clients' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_client_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one client' using errcode = '22023';
  end if;
  if v_requested > 5000 then
    raise exception 'DELETE_TOO_MANY: delete at most 5,000 clients at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_target
    from (select id from public.clients where business_id = p_business_id and id = any (v_target) order by id for update) l;

  with reasons as (
    select c.id, c.full_name, array_remove(array[
             case when exists (select 1 from public.sales x where x.client_id = c.id) then 'sales' end,
             case when exists (select 1 from public.appointments x where x.client_id = c.id) then 'appointments' end,
             case when exists (select 1 from public.consultation_forms x where x.client_id = c.id)
                    or exists (select 1 from public.skincare_consultations x where x.client_id = c.id) then 'consultations' end,
             case when exists (select 1 from public.debts x where x.client_id = c.id) then 'debts' end,
             case when exists (select 1 from public.customer_requests x where x.client_id = c.id) then 'requests' end,
             case when exists (select 1 from public.clients x where x.global_client_id = c.id)
                    or exists (select 1 from public.client_visits x where x.global_client_id = c.id) then 'linked_records' end,
             case when exists (select 1 from public.patients x where x.client_id = c.id) then 'hospital' end
           ], null) as why
      from public.clients c where c.id = any (v_target)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'reasons', to_jsonb(why)) order by full_name) filter (where cardinality(why) > 0), '[]'),
         coalesce(array_agg(id) filter (where cardinality(why) = 0), '{}')
    into v_kept, v_deletable
    from reasons;

  if cardinality(v_deletable) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    insert into public.deleted_clients (deletion_id, business_id, client_id, client_name, client, deleted_by, deleted_by_name)
    select v_deletion, c.business_id, c.id, c.full_name, to_jsonb(c), auth.uid(), v_actor_name
      from public.clients c where c.id = any (v_deletable);

    delete from public.clients where id = any (v_deletable);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'clients.deleted', 'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'requested', v_requested));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

-- ── 4. Reception: register a visit ────────────────────────────────────────────────────────────────────────────
-- p_client: full_name, phone, date_of_birth, gender, address, email, next_of_kin_name, next_of_kin_phone, insurance
--   (for an existing client, only the keys present are changed).
-- p_visit: reg_no (generated when blank), department, assigned_doctor, pay_status.
CREATE OR REPLACE FUNCTION public.register_hospital_visit(p_business_id uuid, p_client_id uuid, p_client jsonb, p_visit jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_client  jsonb := coalesce(p_client, '{}'::jsonb);
  v_visit   jsonb := coalesce(p_visit, '{}'::jsonb);
  v_id      uuid := p_client_id;
  v_open    text;
  v_reg     text;
  v_patient uuid;
  k         text;
BEGIN
  IF NOT public.hospital_can(p_business_id, 'reception') THEN
    RAISE EXCEPTION 'Only reception can register a patient.' USING ERRCODE = '42501';
  END IF;
  IF v_client ? 'full_name' AND nullif(btrim(v_client ->> 'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the patient''s full name.' USING ERRCODE = '22023';
  END IF;
  IF v_client ? 'phone' AND regexp_replace(coalesce(v_client ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Enter a phone number of 7 to 15 digits.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      IF nullif(btrim(coalesce(v_client ->> 'full_name', '')), '') IS NULL OR nullif(btrim(coalesce(v_client ->> 'phone', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Enter the patient''s full name and phone number.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.clients (business_id, full_name, phone, date_of_birth, gender, address, email, next_of_kin_name, next_of_kin_phone, insurance)
      VALUES (p_business_id, btrim(v_client ->> 'full_name'), btrim(v_client ->> 'phone'),
              nullif(btrim(coalesce(v_client ->> 'date_of_birth', '')), ''), nullif(btrim(coalesce(v_client ->> 'gender', '')), ''),
              nullif(btrim(coalesce(v_client ->> 'address', '')), ''), nullif(btrim(coalesce(v_client ->> 'email', '')), ''),
              nullif(btrim(coalesce(v_client ->> 'next_of_kin_name', '')), ''), nullif(btrim(coalesce(v_client ->> 'next_of_kin_phone', '')), ''),
              nullif(btrim(coalesce(v_client ->> 'insurance', '')), ''))
      RETURNING id INTO v_id;
    ELSE
      PERFORM 1 FROM public.clients c WHERE c.id = v_id AND c.business_id = p_business_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That client is not a client of this business.' USING ERRCODE = '42501';
      END IF;
      FOREACH k IN ARRAY ARRAY['full_name', 'phone', 'date_of_birth', 'gender', 'address', 'email', 'next_of_kin_name', 'next_of_kin_phone', 'insurance'] LOOP
        IF v_client ? k THEN
          EXECUTE format('UPDATE public.clients SET %I = $1 WHERE id = $2', k)
            USING CASE WHEN k IN ('full_name', 'phone') THEN btrim(v_client ->> k) ELSE nullif(btrim(coalesce(v_client ->> k, '')), '') END, v_id;
        END IF;
      END LOOP;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another patient of this business already has that phone number. Search for them and register the visit on their record.'
      USING ERRCODE = '23505';
  END;

  SELECT p.status INTO v_open FROM public.patients p
   WHERE p.client_id = v_id AND p.status IN ('at_reception', 'at_triage', 'at_doctor', 'at_lab', 'at_pharmacy', 'admitted')
   LIMIT 1;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'This patient already has an open visit (%). Find them in the queue instead of registering again.', replace(v_open, '_', ' ')
      USING ERRCODE = '23505';
  END IF;

  v_reg := nullif(btrim(coalesce(v_visit ->> 'reg_no', '')), '');
  IF v_reg IS NULL THEN
    v_reg := 'REG-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
  END IF;

  INSERT INTO public.patients (business_id, client_id, reg_no, full_name, department, assigned_doctor, pay_status, status)
  VALUES (p_business_id, v_id, v_reg, '', nullif(btrim(coalesce(v_visit ->> 'department', '')), ''),
          nullif(btrim(coalesce(v_visit ->> 'assigned_doctor', '')), ''), coalesce(nullif(btrim(v_visit ->> 'pay_status'), ''), 'Pending'), 'at_triage')
  RETURNING id INTO v_patient;

  RETURN jsonb_build_object('patient_id', v_patient, 'client_id', v_id, 'reg_no', v_reg, 'status', 'at_triage');
END;
$$;

REVOKE ALL ON FUNCTION public.register_hospital_visit(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_hospital_visit(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;

-- ── 5. Doctor: complete a consultation ────────────────────────────────────────────────────────────────────────
-- p_consultation: hpi, examination, primary_diagnosis (required), secondary_diagnosis, clinical_notes, disposition
--   (Discharge | Admit | Refer to Specialist | Emergency Transfer), referral_dest, referral_reason, ward, counselling,
--   prescription_notes.
-- p_medicines: array of medicine objects (as the Doctor screen builds them); none = no prescription.
-- p_lab: { tests: [names or {name}], priority: routine | urgent, notes }; no tests = no lab request.
-- p_imaging: array of { scan_type, body_part, clinical_info }; entries without a scan type are ignored.
CREATE OR REPLACE FUNCTION public.complete_hospital_consultation(
  p_patient_id uuid, p_consultation jsonb, p_medicines jsonb, p_lab jsonb, p_imaging jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p             public.patients%ROWTYPE;
  v_c           jsonb := coalesce(p_consultation, '{}'::jsonb);
  v_meds        jsonb := CASE WHEN jsonb_typeof(p_medicines) = 'array' THEN p_medicines ELSE '[]'::jsonb END;
  v_lab         jsonb := coalesce(p_lab, '{}'::jsonb);
  v_tests       jsonb;
  v_imaging     jsonb := CASE WHEN jsonb_typeof(p_imaging) = 'array' THEN p_imaging ELSE '[]'::jsonb END;
  v_disposition text := coalesce(nullif(btrim(v_c ->> 'disposition'), ''), 'Discharge');
  v_dx          text := nullif(btrim(coalesce(v_c ->> 'primary_diagnosis', '')), '');
  v_doctor      text;
  v_consult     uuid;
  v_rx          uuid;
  v_labreq      uuid;
  v_img_ids     uuid[] := '{}';
  v_img         jsonb;
  v_one         uuid;
  v_sent        text[] := '{}';
  v_status      text;
BEGIN
  SELECT * INTO p FROM public.patients WHERE id = p_patient_id FOR UPDATE;
  IF NOT FOUND OR NOT public.hospital_can(p.business_id, 'doctor') THEN
    RAISE EXCEPTION 'Only a doctor of this hospital can complete a consultation for this patient.' USING ERRCODE = '42501';
  END IF;
  IF p.status IS DISTINCT FROM 'at_doctor' THEN
    RAISE EXCEPTION 'This patient is not waiting for the doctor (%). Their consultation may already have been saved.', replace(coalesce(p.status, 'no status'), '_', ' ')
      USING ERRCODE = '22023';
  END IF;
  IF v_dx IS NULL THEN
    RAISE EXCEPTION 'Enter at least a primary diagnosis.' USING ERRCODE = '22023';
  END IF;
  IF v_disposition NOT IN ('Discharge', 'Admit', 'Refer to Specialist', 'Emergency Transfer') THEN
    RAISE EXCEPTION 'Unknown disposition: %', v_disposition USING ERRCODE = '22023';
  END IF;

  SELECT a.staff_name INTO v_doctor FROM public.pos_actor(p.business_id) a LIMIT 1;
  v_doctor := coalesce(v_doctor, 'Doctor');

  INSERT INTO public.consultations (patient_id, business_id, hpi, examination, primary_diagnosis, secondary_diagnosis, clinical_notes,
                                    disposition, referral_dest, referral_reason, ward, counselling, doctor_name, performed_by, status)
  VALUES (p.id, p.business_id, coalesce(v_c ->> 'hpi', ''), coalesce(v_c ->> 'examination', ''), v_dx, coalesce(v_c ->> 'secondary_diagnosis', ''),
          coalesce(v_c ->> 'clinical_notes', ''), v_disposition, coalesce(v_c ->> 'referral_dest', ''), coalesce(v_c ->> 'referral_reason', ''),
          coalesce(v_c ->> 'ward', ''), coalesce(v_c ->> 'counselling', ''), v_doctor, v_doctor, 'completed')
  RETURNING id INTO v_consult;

  IF jsonb_array_length(v_meds) > 0 THEN
    INSERT INTO public.prescriptions (patient_id, consultation_id, business_id, patient_name, doctor_name, medicines, notes, status)
    VALUES (p.id, v_consult, p.business_id, p.full_name, v_doctor, v_meds, coalesce(v_c ->> 'prescription_notes', ''), 'pending')
    RETURNING id INTO v_rx;
    v_sent := array_append(v_sent, 'pharmacy');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('name', n)), '[]'::jsonb) INTO v_tests
    FROM (
      SELECT btrim(CASE WHEN jsonb_typeof(t) = 'object' THEN t ->> 'name' ELSE t #>> '{}' END) n
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_lab -> 'tests') = 'array' THEN v_lab -> 'tests' ELSE '[]'::jsonb END) t
    ) x
   WHERE n IS NOT NULL AND n <> '';
  IF jsonb_array_length(v_tests) > 0 THEN
    INSERT INTO public.lab_requests (patient_id, business_id, consultation_id, requested_by, requested_by_id, tests, priority, notes, status)
    VALUES (p.id, p.business_id, v_consult, v_doctor, auth.uid(), v_tests,
            CASE WHEN v_lab ->> 'priority' = 'urgent' THEN 'urgent' ELSE 'routine' END, coalesce(v_lab ->> 'notes', ''), 'pending')
    RETURNING id INTO v_labreq;
    v_sent := array_append(v_sent, 'lab');
  END IF;

  FOR v_img IN SELECT x FROM jsonb_array_elements(v_imaging) x LOOP
    IF nullif(btrim(coalesce(v_img ->> 'scan_type', '')), '') IS NOT NULL THEN
      INSERT INTO public.imaging_requests (patient_id, business_id, consultation_id, requested_by, scan_type, body_part, clinical_info, status)
      VALUES (p.id, p.business_id, v_consult, v_doctor, btrim(v_img ->> 'scan_type'), coalesce(v_img ->> 'body_part', ''),
              coalesce(nullif(btrim(coalesce(v_img ->> 'clinical_info', '')), ''), v_dx), 'pending')
      RETURNING id INTO v_one;
      v_img_ids := array_append(v_img_ids, v_one);
    END IF;
  END LOOP;
  IF cardinality(v_img_ids) > 0 THEN
    v_sent := array_append(v_sent, 'imaging');
  END IF;

  -- The disposition is the clinical outcome and wins; otherwise the patient goes where the work is.
  v_status := CASE
    WHEN v_disposition = 'Admit' THEN 'admitted'
    WHEN v_disposition = 'Refer to Specialist' THEN 'referred'
    WHEN v_disposition = 'Emergency Transfer' THEN 'transferred'
    WHEN 'lab' = ANY (v_sent) OR 'imaging' = ANY (v_sent) THEN 'at_lab'
    WHEN 'pharmacy' = ANY (v_sent) THEN 'at_pharmacy'
    ELSE 'discharged'
  END;
  UPDATE public.patients SET status = v_status WHERE id = p.id;

  INSERT INTO public.patient_messages (patient_id, business_id, sender_name, sender_role, department, message, message_type)
  VALUES (p.id, p.business_id, v_doctor, 'Doctor', 'Consultation',
          'Consultation complete. Diagnosis: ' || v_dx || '.'
            || CASE WHEN cardinality(v_sent) > 0 THEN ' Sent to: ' || array_to_string(v_sent, ', ') || '.' ELSE '' END,
          'consultation');

  RETURN jsonb_build_object('consultation_id', v_consult, 'prescription_id', v_rx, 'lab_request_id', v_labreq,
                            'imaging_request_ids', to_jsonb(v_img_ids), 'sent', to_jsonb(v_sent), 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_hospital_consultation(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_hospital_consultation(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;

-- ── 6. Pharmacy: dispense ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispense_prescription(p_prescription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  rx          public.prescriptions%ROWTYPE;
  v_by        text;
  v_status    text;
  v_pending   boolean;
  v_discharge boolean := false;
BEGIN
  SELECT * INTO rx FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.hospital_can(rx.business_id, 'rx_inbox') THEN
    RAISE EXCEPTION 'Only the pharmacy of this hospital can dispense this prescription.' USING ERRCODE = '42501';
  END IF;
  IF rx.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'This prescription has already been dispensed.' USING ERRCODE = '22023';
  END IF;

  SELECT a.staff_name INTO v_by FROM public.pos_actor(rx.business_id) a LIMIT 1;
  UPDATE public.prescriptions SET status = 'dispensed', dispensed_by = coalesce(v_by, ''), dispensed_at = now() WHERE id = rx.id;

  SELECT status INTO v_status FROM public.patients WHERE id = rx.patient_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.lab_requests x WHERE x.patient_id = rx.patient_id AND x.status IS DISTINCT FROM 'completed')
      OR EXISTS (SELECT 1 FROM public.imaging_requests x WHERE x.patient_id = rx.patient_id AND x.status IS DISTINCT FROM 'completed')
      OR EXISTS (SELECT 1 FROM public.prescriptions x WHERE x.patient_id = rx.patient_id AND x.id <> rx.id AND x.status = 'pending')
    INTO v_pending;
  IF v_status IN ('at_pharmacy', 'at_lab') AND NOT v_pending THEN
    UPDATE public.patients SET status = 'discharged' WHERE id = rx.patient_id;
    v_discharge := true;
  END IF;

  RETURN jsonb_build_object('prescription_id', rx.id, 'dispensed_by', coalesce(v_by, ''), 'discharged', v_discharge,
                            'patient_status', CASE WHEN v_discharge THEN 'discharged' ELSE v_status END);
END;
$$;

REVOKE ALL ON FUNCTION public.dispense_prescription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispense_prescription(uuid) TO authenticated, service_role;
