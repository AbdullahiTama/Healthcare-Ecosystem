-- ============================================================================
-- ADR reports: a UNIQUE reference number, and a way for the reporter to track it.
--
-- Status: DRAFT, NOT APPLIED. Needs owner approval before it goes to production.
-- It renumbers existing reports (section 2): read that section first.
--
-- Problem (verified live 2026-10-21): generate_adr_report_number() numbers per
-- (business_id, module_type). Public CareFind reports have business_id NULL, so
-- "business_id = NULL" matches nothing and every public report gets
-- ADR-2026-000001. It also reads substring(report_number from 9), which is
-- '-000001' (a negative number), so business reports collide too: 50 reports
-- carry only two distinct numbers (ADR-2026-000000, ADR-2026-000001). A number
-- that is not unique cannot identify a report, so nothing can be tracked by it.
--
-- What this does
--   1. Numbers come from a per-year counter row (one atomic UPSERT, serialised by
--      the row lock): ADR-YYYY-NNNNNN, year in Africa/Lagos. Never reused.
--   2. Existing reports are renumbered ONCE in creation order so the unique index
--      can exist. Every existing number was a duplicate, so none identified a
--      report; public reporters were shown ADR-2026-000001 on their receipt, which
--      will now belong to the first report only. report_id (uuid) is unchanged.
--   3. UNIQUE index on report_number.
--   4. track_adr_report(number, contact): the reporter's status lookup. It returns
--      stage names only (never patient data, narrative, company name or reviewer
--      notes). Allowed when the caller is the signed-in reporter of that report, or
--      supplies the e-mail / phone the report was submitted with. Every mismatch
--      returns the same {found:false} so numbers cannot be enumerated, and failures
--      are rate-limited per signed-in user (8 in 15 minutes).
-- Not changed: who can see a case in the company's PV Tracker. That is still the
-- reviewer-approval policy (a route must be approved before the company sees it).
--
-- Traps handled (memory: reference-supabase-carehub-gotchas): new functions get an
-- explicit REVOKE from anon and the ACL is asserted at the end; the old trigger
-- function is replaced in place (same name, same trigger) so no sibling remains.
-- ============================================================================

-- 1. Counter ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adr_report_counters (
  year integer PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.adr_report_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.adr_report_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_adr_report_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := extract(year FROM (now() AT TIME ZONE 'Africa/Lagos'))::integer;
  v_n bigint;
BEGIN
  IF NEW.report_number IS NULL THEN
    INSERT INTO adr_report_counters AS c (year, last_value) VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = c.last_value + 1
    RETURNING last_value INTO v_n;
    NEW.report_number := 'ADR-' || v_year || '-' || lpad(v_n::text, 6, '0');
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.generate_adr_report_number() FROM PUBLIC, anon, authenticated;

-- 2. One-time renumbering of the existing (all duplicate) numbers ---------------
DO $$
DECLARE
  r record;
  v_year integer;
  v_n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM adr_report_counters) THEN
    RETURN;   -- already renumbered / numbering already in use: never touch again
  END IF;
  FOR r IN SELECT report_id, created_at FROM adr_reports ORDER BY created_at, report_id LOOP
    v_year := extract(year FROM (r.created_at AT TIME ZONE 'Africa/Lagos'))::integer;
    INSERT INTO adr_report_counters AS c (year, last_value) VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = c.last_value + 1
    RETURNING last_value INTO v_n;
    UPDATE adr_reports SET report_number = 'ADR-' || v_year || '-' || lpad(v_n::text, 6, '0')
     WHERE report_id = r.report_id;
  END LOOP;
END $$;

-- 3. Uniqueness -----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS adr_reports_report_number_key ON public.adr_reports (report_number);

-- 4. Tracking -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adr_track_attempts (
  attempt_id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  ok boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adr_track_attempts_user ON public.adr_track_attempts (user_id, at DESC);
ALTER TABLE public.adr_track_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.adr_track_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_adr_report(p_report_number text, p_contact text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_num text := upper(trim(coalesce(p_report_number, '')));
  v_contact text := trim(coalesce(p_contact, ''));
  v_digits text := right(regexp_replace(v_contact, '\D', '', 'g'), 9);
  rep adr_reports;
  v_ok boolean := false;
  v_products jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sign_in_required' USING ERRCODE = '42501';
  END IF;
  IF v_num !~ '^ADR-[0-9]{4}-[0-9]{6}$' THEN
    RETURN jsonb_build_object('found', false, 'reason', 'format');
  END IF;
  IF (SELECT count(*) FROM adr_track_attempts
       WHERE user_id = v_uid AND NOT ok AND at > now() - interval '15 minutes') >= 8 THEN
    RAISE EXCEPTION 'too_many_attempts';
  END IF;

  SELECT * INTO rep FROM adr_reports
   WHERE report_number = v_num AND report_source = 'public' AND status <> 'draft';
  IF FOUND THEN
    v_ok := rep.reporter_auth_user_id IS NOT DISTINCT FROM v_uid
         OR (v_contact <> '' AND rep.reporter_email IS NOT NULL
             AND lower(trim(rep.reporter_email)) = lower(v_contact))
         OR (length(v_digits) >= 9 AND rep.reporter_phone IS NOT NULL
             AND right(regexp_replace(rep.reporter_phone, '\D', '', 'g'), 9) = v_digits);
  END IF;

  -- Logged and returned (not raised): an exception would roll the attempt row back
  -- and the rate limit above would never see a failure.
  INSERT INTO adr_track_attempts (user_id, ok) VALUES (v_uid, v_ok);
  IF NOT v_ok THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product', p.product_brand_name,
           'stage', CASE
                      WHEN r.route_id IS NULL OR (r.status = 'pending' AND r.held_at IS NULL) THEN 'received'
                      WHEN r.status = 'pending' THEN 'in_review'
                      WHEN r.company_status = 'new' THEN 'sent_to_company'
                      WHEN r.company_status = 'acknowledged' THEN 'acknowledged_by_company'
                      WHEN r.company_status = 'closed' THEN 'closed'
                      ELSE 'under_assessment'
                    END) ORDER BY p.created_at), '[]'::jsonb)
    INTO v_products
    FROM adr_report_products p
    LEFT JOIN adr_product_company_routes r ON r.product_id = p.product_id
   WHERE p.report_id = rep.report_id;

  RETURN jsonb_build_object(
    'found', true,
    'report_number', rep.report_number,
    'submitted_at', rep.gate_validated_at,
    'products', v_products);
END
$$;
REVOKE EXECUTE ON FUNCTION public.track_adr_report(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_adr_report(text, text) TO authenticated;

-- 5. Verification ---------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM adr_reports GROUP BY report_number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'report numbers are still not unique';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('track_adr_report', 'generate_adr_report_number')) <> 2 THEN
    RAISE EXCEPTION 'unexpected function overloads';
  END IF;
  IF has_function_privilege('anon', 'public.track_adr_report(text, text)', 'execute') THEN
    RAISE EXCEPTION 'anon must not be able to track reports';
  END IF;
END $$;
