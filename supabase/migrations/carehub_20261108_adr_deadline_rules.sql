-- ============================================================================
-- ADR Reporting Module - Phase 8: versioned deadline rules
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Deadlines become data, not code:
--   - adr_deadline_rules holds versioned interval sets. The single seed row
--     carries the SUPPLIED BRIEF values, explicitly marked UNVERIFIED — they
--     are not confirmed NAFDAC requirements. New regulatory understanding
--     ships as a NEW row (history is never rewritten); writes are admin-only.
--   - adr_compute_deadline reads the active row; both submit RPCs stamp
--     deadline_rule_version. With no active row the calculator falls back to
--     the brief constants under version 'fallback-brief-unverified' — honest
--     labeling instead of silent defaults.
-- No scheduler is wired here (pg_cron vs app-cron is an infra decision for a
-- follow-up); this phase makes every displayed deadline explainable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Versioned rule table (history-preserving; admin-written)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adr_deadline_rules (
  rule_version text PRIMARY KEY,
  effective_from timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    (rules ? 'serious_unexpected_hours')
    AND (rules ? 'serious_expected_days')
    AND (rules ? 'non_serious_unexpected_days')
    AND (rules ? 'non_serious_expected_days')
    AND (rules ? 'safety_signal_days')
  ),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE adr_deadline_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adr_deadline_rules read" ON adr_deadline_rules;
CREATE POLICY "adr_deadline_rules read" ON adr_deadline_rules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "adr_deadline_rules admin write" ON adr_deadline_rules;
CREATE POLICY "adr_deadline_rules admin write" ON adr_deadline_rules
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

COMMENT ON TABLE adr_deadline_rules IS
  'Versioned ADR deadline intervals. Regulatory changes ship as NEW rows; past rows are never edited. Reads are authenticated-wide (intervals are policy, not secrets).';

INSERT INTO adr_deadline_rules (rule_version, effective_from, is_active, rules, notes)
VALUES (
  'brief-2026-10-unverified',
  now(),
  true,
  '{"serious_unexpected_hours": 72, "serious_expected_days": 15, "non_serious_unexpected_days": 15, "non_serious_expected_days": 90, "safety_signal_days": 3}'::jsonb,
  'UNVERIFIED values from the supplied brief — NOT independently confirmed current NAFDAC requirements. ' ||
  'Production enforcement requires PV/regulatory lead verification and a superseding version row.'
)
ON CONFLICT (rule_version) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Active-rule helper + table-driven calculator
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_active_deadline_rule()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT rule_version FROM adr_deadline_rules WHERE is_active IS TRUE
     ORDER BY effective_from DESC LIMIT 1),
    'fallback-brief-unverified')
$$;

COMMENT ON FUNCTION public.adr_active_deadline_rule() IS
  'Active deadline rule version, or the labeled fallback when no row is active.';

REVOKE EXECUTE ON FUNCTION public.adr_active_deadline_rule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_active_deadline_rule() TO authenticated;

CREATE OR REPLACE FUNCTION public.adr_compute_deadline(
  p_created_at timestamptz,
  p_is_serious boolean,
  p_reaction_expected boolean,
  p_new_safety_signal boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
BEGIN
  SELECT rules INTO v_rules FROM adr_deadline_rules
  WHERE is_active IS TRUE ORDER BY effective_from DESC LIMIT 1;

  IF v_rules IS NULL THEN
    -- Labeled fallback: identical numbers to the brief seed, never silent.
    v_rules := '{"serious_unexpected_hours": 72, "serious_expected_days": 15, "non_serious_unexpected_days": 15, "non_serious_expected_days": 90, "safety_signal_days": 3}'::jsonb;
  END IF;

  RETURN CASE
    WHEN p_new_safety_signal IS TRUE
      THEN p_created_at + ((v_rules->>'safety_signal_days')::numeric || ' days')::interval
    WHEN p_is_serious AND p_reaction_expected IS NOT TRUE
      THEN p_created_at + ((v_rules->>'serious_unexpected_hours')::numeric || ' hours')::interval
    WHEN p_is_serious
      THEN p_created_at + ((v_rules->>'serious_expected_days')::numeric || ' days')::interval
    WHEN p_reaction_expected IS NOT TRUE
      THEN p_created_at + ((v_rules->>'non_serious_unexpected_days')::numeric || ' days')::interval
    ELSE p_created_at + ((v_rules->>'non_serious_expected_days')::numeric || ' days')::interval
  END;
END
$$;

COMMENT ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) IS
  'Table-driven deadline (Phase 8). Values come from the active adr_deadline_rules row; the brief numbers survive only as labeled fallback.';

REVOKE EXECUTE ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_compute_deadline(timestamptz, boolean, boolean, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Version stamping trigger (covers both submit RPCs and any future path)
--    A draft->submitted transition without an explicit version inherits the
--    active rule version, so gate_validated_at and deadline_rule_version can
--    never disagree about which rules produced the deadline.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_stamp_deadline_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'submitted' AND NEW.status = 'submitted'
     AND NEW.deadline_rule_version IS NULL THEN
    NEW.deadline_rule_version := public.adr_active_deadline_rule();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_stamp_deadline_rule ON adr_reports;
CREATE TRIGGER trg_adr_stamp_deadline_rule
  BEFORE UPDATE ON adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_stamp_deadline_rule();

COMMENT ON FUNCTION public.adr_stamp_deadline_rule() IS
  'Stamps the active deadline rule version on every draft->submitted transition lacking one.';
