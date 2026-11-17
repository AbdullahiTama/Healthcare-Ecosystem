-- ============================================================================
-- Hospital Model: baseline of the eight hospital tables as they are live
-- (CODE_AUDIT A37)
--
-- STATUS: APPLIED 2026-11-17 as version 20261117092425, with owner approval.
--   A record of the live schema: it changed nothing (the policies and grants
--   it states were already live; read 2026-11-16/17: columns, defaults, keys,
--   foreign keys, indexes, policies, grants; no triggers, no CHECK or UNIQUE
--   constraints). Its purpose is that the schema exists in the repository, so
--   a rebuild, a branch and the PGlite tests reproduce it.
--
-- PROBLEM
-- -------
-- patients, triage, consultations, prescriptions, lab_requests, lab_results,
-- imaging_requests and patient_messages were created outside the migrations
-- (no CREATE TABLE for them in supabase/migrations/). Their protections could
-- not be reviewed or tested from the repository.
--
-- FIX
-- ---
-- Re-state them exactly. Nothing here is an improvement: the weaknesses found
-- in the audit (one FOR ALL policy per table, every privilege to anon and
-- authenticated, ON DELETE CASCADE from the patient) are reproduced as they are
-- and corrected by carehub_20270124_hospital_access.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- None on production (no-op). On a fresh database it reproduces today's access,
-- which carehub_20270124 then narrows; the two are meant to be applied together.
--
-- ROLLBACK
-- --------
-- Nothing to roll back on production. (On a fresh database: drop the eight
-- tables.)
--
-- TESTS
-- -----
-- apps/carefind/src/test/hospital/hospitalBaseline.db.test.js
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patients (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id       uuid,
  reg_no            text NOT NULL,
  full_name         text NOT NULL,
  date_of_birth     text,
  gender            text,
  phone             text,
  address           text,
  next_of_kin       text,
  next_of_kin_phone text,
  insurance         text,
  pay_status        text DEFAULT 'pending'::text,
  department        text,
  assigned_doctor   text,
  status            text DEFAULT 'at_reception'::text,
  created_at        timestamp without time zone DEFAULT now(),
  CONSTRAINT patients_pkey PRIMARY KEY (id),
  CONSTRAINT patients_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.triage (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id      uuid,
  business_id     uuid,
  weight          text,
  height          text,
  bp              text,
  pulse           text,
  temperature     text,
  rr              text,
  spo2            text,
  blood_sugar     text,
  chief_complaint text,
  allergies       text,
  nurse_name      text,
  status          text DEFAULT 'done'::text,
  created_at      timestamp without time zone DEFAULT now(),
  performed_by    text DEFAULT ''::text,
  CONSTRAINT triage_pkey PRIMARY KEY (id),
  CONSTRAINT triage_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT triage_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.consultations (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id          uuid,
  business_id         uuid,
  hpi                 text,
  examination         text,
  primary_diagnosis   text,
  secondary_diagnosis text,
  clinical_notes      text,
  disposition         text,
  referral_dest       text,
  referral_reason     text,
  ward                text,
  counselling         text,
  doctor_name         text,
  status              text DEFAULT 'open'::text,
  created_at          timestamp without time zone DEFAULT now(),
  performed_by        text DEFAULT ''::text,
  CONSTRAINT consultations_pkey PRIMARY KEY (id),
  CONSTRAINT consultations_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT consultations_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id      uuid,
  consultation_id uuid,
  business_id     uuid,
  patient_name    text,
  doctor_name     text,
  medicines       jsonb DEFAULT '[]'::jsonb,
  lab_tests       text,
  imaging         text,
  notes           text,
  status          text DEFAULT 'pending'::text,
  created_at      timestamp without time zone DEFAULT now(),
  dispensed_by    text DEFAULT ''::text,
  dispensed_at    timestamp without time zone,
  CONSTRAINT prescriptions_pkey PRIMARY KEY (id),
  CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT prescriptions_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id) ON DELETE CASCADE,
  CONSTRAINT prescriptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.lab_requests (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id      uuid,
  business_id     uuid,
  consultation_id uuid,
  requested_by    text,
  requested_by_id uuid,
  tests           jsonb DEFAULT '[]'::jsonb,
  status          text DEFAULT 'pending'::text,
  priority        text DEFAULT 'routine'::text,
  notes           text,
  created_at      timestamp without time zone DEFAULT now(),
  CONSTRAINT lab_requests_pkey PRIMARY KEY (id),
  CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT lab_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
  CONSTRAINT lab_requests_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id)
);

CREATE TABLE IF NOT EXISTS public.lab_results (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_request_id  uuid,
  patient_id      uuid,
  business_id     uuid,
  performed_by    text,
  performed_by_id uuid,
  results         jsonb DEFAULT '[]'::jsonb,
  summary         text,
  report_url      text,
  status          text DEFAULT 'pending'::text,
  created_at      timestamp without time zone DEFAULT now(),
  CONSTRAINT lab_results_pkey PRIMARY KEY (id),
  CONSTRAINT lab_results_lab_request_id_fkey FOREIGN KEY (lab_request_id) REFERENCES public.lab_requests(id) ON DELETE CASCADE,
  CONSTRAINT lab_results_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT lab_results_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.imaging_requests (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id      uuid,
  business_id     uuid,
  consultation_id uuid,
  requested_by    text,
  scan_type       text,
  body_part       text,
  clinical_info   text,
  status          text DEFAULT 'pending'::text,
  report          text,
  report_url      text,
  performed_by    text,
  created_at      timestamp without time zone DEFAULT now(),
  CONSTRAINT imaging_requests_pkey PRIMARY KEY (id),
  CONSTRAINT imaging_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT imaging_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
  CONSTRAINT imaging_requests_consultation_id_fkey FOREIGN KEY (consultation_id) REFERENCES public.consultations(id)
);

CREATE TABLE IF NOT EXISTS public.patient_messages (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id   uuid,
  business_id  uuid,
  sender_name  text,
  sender_role  text,
  department   text,
  message      text NOT NULL,
  message_type text DEFAULT 'note'::text,
  created_at   timestamp without time zone DEFAULT now(),
  CONSTRAINT patient_messages_pkey PRIMARY KEY (id),
  CONSTRAINT patient_messages_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE,
  CONSTRAINT patient_messages_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patients_business_id_fk ON public.patients USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_triage_patient_id_fk ON public.triage USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_triage_business_id_fk ON public.triage USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient_id_fk ON public.consultations USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_business_id_fk ON public.consultations USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_id_fk ON public.prescriptions USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation_id_fk ON public.prescriptions USING btree (consultation_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_business_id_fk ON public.prescriptions USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient_id_fk ON public.lab_requests USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_business_id_fk ON public.lab_requests USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_consultation_id_fk ON public.lab_requests USING btree (consultation_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_lab_request_id_fk ON public.lab_results USING btree (lab_request_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_patient_id_fk ON public.lab_results USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_business_id_fk ON public.lab_results USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_imaging_requests_patient_id_fk ON public.imaging_requests USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_imaging_requests_business_id_fk ON public.imaging_requests USING btree (business_id);
CREATE INDEX IF NOT EXISTS idx_imaging_requests_consultation_id_fk ON public.imaging_requests USING btree (consultation_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_patient_id_fk ON public.patient_messages USING btree (patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_business_id_fk ON public.patient_messages USING btree (business_id);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imaging_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_messages ENABLE ROW LEVEL SECURITY;

-- The live policies, verbatim (one FOR ALL policy per table). Created only when absent, so production is untouched.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'triage', 'consultations', 'prescriptions', 'lab_requests', 'imaging_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' of own business') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING ((business_id IN (SELECT current_business_ids() AS current_business_ids)) OR is_platform_admin()) '
        'WITH CHECK ((business_id IN (SELECT current_business_ids() AS current_business_ids)) OR is_platform_admin())',
        t || ' of own business', t);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lab_results' AND policyname = 'lab_results via parent lab_requests') THEN
    CREATE POLICY "lab_results via parent lab_requests" ON public.lab_results FOR ALL
      USING (is_platform_admin() OR (lab_request_id IN (SELECT lab_requests.id FROM lab_requests WHERE (lab_requests.business_id IN (SELECT current_business_ids() AS current_business_ids)))))
      WITH CHECK (is_platform_admin() OR (lab_request_id IN (SELECT lab_requests.id FROM lab_requests WHERE (lab_requests.business_id IN (SELECT current_business_ids() AS current_business_ids)))));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'patient_messages' AND policyname = 'patient_messages via parent patients') THEN
    CREATE POLICY "patient_messages via parent patients" ON public.patient_messages FOR ALL
      USING (is_platform_admin() OR (patient_id IN (SELECT patients.id FROM patients WHERE (patients.business_id IN (SELECT current_business_ids() AS current_business_ids)))))
      WITH CHECK (is_platform_admin() OR (patient_id IN (SELECT patients.id FROM patients WHERE (patients.business_id IN (SELECT current_business_ids() AS current_business_ids)))));
  END IF;
END $$;

-- The live grants (every privilege to anon and authenticated); narrowed by carehub_20270124_hospital_access.
GRANT ALL ON public.patients, public.triage, public.consultations, public.prescriptions, public.lab_requests,
  public.lab_results, public.imaging_requests, public.patient_messages TO anon, authenticated, service_role;
