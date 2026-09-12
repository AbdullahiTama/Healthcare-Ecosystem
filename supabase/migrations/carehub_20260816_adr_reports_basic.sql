-- ============================================================================
-- ADR Reporting Module - Core Schema
--
-- Status: APPLIED 2026-08-18 via MCP (migration `adr_reports_basic`) and
--         verified behaviorally. Tables, RLS, triggers and the adr-evidence
--         storage bucket are live.
--   - report_number column added (trigger references it)
--   - reporter_* and patient_* fields live on adr_reports (frontend reads
--     them from the report row, not from reactions)
--   - created_by_user_id made nullable (Owners have no staff row, so it is
--     null on insert) - "NOT NULL ... ON DELETE SET NULL" was contradictory
--   - report_number year-prefix comparison fixed (ADR-YYYY is 8 chars)
--   - idempotent triggers (DROP ... IF EXISTS before CREATE)
--   - industry/skincare optional columns the form engine references
--   - both trigger functions pinned with `set search_path = public` (keeps
--     the security advisors at baseline; mutable search_path is a WARN)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. adr_reports - primary ADR report entity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_type text NOT NULL CHECK (module_type IN ('community_pharmacy','hospital','industry','skincare')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','exported','follow_up_required')),
  report_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  follow_up_of_report_id uuid REFERENCES adr_reports(report_id) ON DELETE SET NULL,
  follow_up_version_number integer,

  -- Reporter section (read/written from the report row)
  reporter_name text,
  reporter_qualification text,
  reporter_facility_name text,
  reporter_phone text,
  reporter_email text,
  reporter_license_number text,
  reporter_consent_followup boolean,
  reporter_anonymous_confirmed_by_facility boolean NOT NULL DEFAULT false,

  -- Patient section
  patient_identifier text,
  patient_age integer,
  patient_dob date,
  patient_age_group text,
  patient_gender text,
  patient_weight_kg numeric(6,2),

  -- Deadline inputs
  reaction_expected boolean,
  new_safety_signal boolean NOT NULL DEFAULT false,

  -- Industry-specific (formEngine.industryConfig)
  batch_lot_number text,
  causality_assessment text,
  case_narrative_summary text,
  naranjo_score integer,
  distribution_batch_trace_notes text,

  -- Skincare-specific (formEngine.skincareConfig)
  application_site text,
  cosmetic_reaction_type text
);

-- Human-readable report number generated trigger
CREATE OR REPLACE FUNCTION public.generate_adr_report_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_max numeric;
begin
  if new.report_number is null then
    select coalesce(max(
      case when left(report_number, 8) = 'ADR-' || to_char(current_date, 'YYYY') then
        cast(substring(report_number from 9) as numeric)
      else 0 end
    ), 0) into v_max
    from adr_reports
    where business_id = new.business_id
      and module_type = new.module_type;

    if v_max is null then
      v_max := 0;
    end if;

    new.report_number := 'ADR-' || to_char(current_date, 'YYYY') || '-' || lpad((v_max + 1)::text, 6, '0');
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_adr_report_number ON adr_reports;
CREATE TRIGGER trg_adr_report_number
BEFORE INSERT ON adr_reports
FOR EACH ROW
WHEN (new.report_number is null)
EXECUTE FUNCTION public.generate_adr_report_number();

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_adr_reports_business ON adr_reports(business_id);
CREATE INDEX IF NOT EXISTS idx_adr_reports_module ON adr_reports(module_type);
CREATE INDEX IF NOT EXISTS idx_adr_reports_status ON adr_reports(status);
CREATE INDEX IF NOT EXISTS idx_adr_reports_created ON adr_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adr_reports_follow_up ON adr_reports(follow_up_of_report_id);
CREATE INDEX IF NOT EXISTS idx_adr_reports_created_by ON adr_reports(created_by_user_id);

-- ----------------------------------------------------------------------------
-- 2. adr_report_products - suspect products (at least 1 required before submission)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_report_products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  product_brand_name text NOT NULL,
  product_generic_name text,
  manufacturer text,
  batch_lot_number text,
  expiry_date date,
  dose text,
  route text,
  frequency text,
  start_date date,
  stop_date date,
  indication text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_products_report ON adr_report_products(report_id);
CREATE INDEX IF NOT EXISTS idx_adr_products_brand ON adr_report_products(product_brand_name);

-- ----------------------------------------------------------------------------
-- 3. adr_report_concomitant_meds - concomitant medications (no minimum count)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_report_concomitant_meds (
  med_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  name text NOT NULL,
  dose text,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_concomitant_report ON adr_report_concomitant_meds(report_id);

-- ----------------------------------------------------------------------------
-- 4. adr_report_reactions - adverse reactions (at least 1 required before submission)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_report_reactions (
  reaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  reaction_description text NOT NULL,
  onset_date date,
  duration text,
  severity text CHECK (severity IN ('mild','moderate','severe')),
  outcome text CHECK (outcome IN ('recovered','recovering','not_recovered','recovered_with_sequelae','fatal','unknown')),
  -- The six seriousness booleans - must be non-null when submitting
  seriousness_death boolean NOT NULL DEFAULT false,
  seriousness_life_threatening boolean NOT NULL DEFAULT false,
  seriousness_hospitalization boolean NOT NULL DEFAULT false,
  seriousness_disability boolean NOT NULL DEFAULT false,
  seriousness_congenital_anomaly boolean NOT NULL DEFAULT false,
  seriousness_other_medically_important boolean NOT NULL DEFAULT false,
  causality_assessment text CHECK (causality_assessment IN ('certain','probable_likely','possible','unlikely','conditional_unclassified','unassessable')),
  dechallenge_result text CHECK (dechallenge_result IN ('positive','negative','not_applicable')),
  rechallenge_result text CHECK (rechallenge_result IN ('positive','negative','not_done')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_reactions_report ON adr_report_reactions(report_id);

-- ----------------------------------------------------------------------------
-- 5. adr_report_evidence_photos - evidence photos (optional, never part of submission gate)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_report_evidence_photos (
  photo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  evidence_photo_file text NOT NULL, -- storage path
  evidence_photo_type text NOT NULL CHECK (evidence_photo_type IN ('product','patient_effect','other')),
  evidence_photo_caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_photos_report ON adr_report_evidence_photos(report_id);

-- ----------------------------------------------------------------------------
-- 6. RLS: Business isolation for all ADR tables
--    Users from Business A must not access Business B's ADR records.
--    Relies on current_business_ids() / is_platform_admin() from
--    sql/phase2_rls_pilot.sql - apply that first if not already applied.
-- ----------------------------------------------------------------------------
ALTER TABLE adr_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE adr_report_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE adr_report_concomitant_meds ENABLE ROW LEVEL SECURITY;
ALTER TABLE adr_report_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adr_report_evidence_photos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- adr_reports RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adr_reports' AND policyname = 'adr_reports business isolation') THEN
    CREATE POLICY "adr_reports business isolation" ON adr_reports
      FOR ALL USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;

  -- adr_report_products RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adr_report_products' AND policyname = 'adr_report_products business isolation') THEN
    CREATE POLICY "adr_report_products business isolation" ON adr_report_products
      FOR ALL USING (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()))
      WITH CHECK (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;

  -- adr_report_concomitant_meds RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adr_report_concomitant_meds' AND policyname = 'adr_report_concomitant_meds business isolation') THEN
    CREATE POLICY "adr_report_concomitant_meds business isolation" ON adr_report_concomitant_meds
      FOR ALL USING (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()))
      WITH CHECK (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;

  -- adr_report_reactions RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adr_report_reactions' AND policyname = 'adr_report_reactions business isolation') THEN
    CREATE POLICY "adr_report_reactions business isolation" ON adr_report_reactions
      FOR ALL USING (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()))
      WITH CHECK (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;

  -- adr_report_evidence_photos RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'adr_report_evidence_photos' AND policyname = 'adr_report_evidence_photos business isolation') THEN
    CREATE POLICY "adr_report_evidence_photos business isolation" ON adr_report_evidence_photos
      FOR ALL USING (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()))
      WITH CHECK (report_id IN (SELECT report_id FROM adr_reports WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin()));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Update adr_reports.updated_at on each row update
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_adr_reports_updated_at ON adr_reports;
CREATE TRIGGER trg_adr_reports_updated_at
BEFORE UPDATE ON adr_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE adr_reports IS 'Adverse Drug Reaction (ADR) reporting module - primary report entity';
COMMENT ON TABLE adr_report_products IS 'Suspect products in ADR reports';
COMMENT ON TABLE adr_report_concomitant_meds IS 'Concomitant medications in ADR reports';
COMMENT ON TABLE adr_report_reactions IS 'Adverse reactions in ADR reports';
COMMENT ON TABLE adr_report_evidence_photos IS 'Evidence photos in ADR reports';

-- ----------------------------------------------------------------------------
-- 8. adr-evidence storage bucket — the evidence-photo upload destination
--    (AdrReportPage.jsx uploads to `adr-evidence` and stores the public URL in
--    adr_report_evidence_photos.evidence_photo_file). Public read so the stored
--    URL renders; INSERT restricted to authenticated so only logged-in staff/
--    owners can upload. APPLIED live 2026-08-18.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adr-evidence', 'adr-evidence', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='adr-evidence public read') then
    create policy "adr-evidence public read" on storage.objects
      for select to public using (bucket_id = 'adr-evidence');
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='adr-evidence authenticated insert') then
    create policy "adr-evidence authenticated insert" on storage.objects
      for insert to authenticated with check (bucket_id = 'adr-evidence');
  end if;
end $$;