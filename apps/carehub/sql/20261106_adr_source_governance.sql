-- ============================================================================
-- ADR Reporting Module - Phase 5: report-source governance
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Source is the recorded submission channel, never inferred. This migration
-- makes that tamper-evident:
--   - adr_lock_report_source trigger: report_source is immutable to everyone
--     except the platform admin (admin corrections go through the RPC below
--     so they are always audited).
--   - correct_adr_report_source RPC (admin-only): the single legal path for
--     re-classification, writing a source_corrected audit event with from/to
--     and the recorded reason.
-- Evidence basis (unchanged, documented here):
--   - business_facility: rows with a non-NULL business_id written from an
--     authenticated business session (Phase 1 backfill + Hub flow).
--   - public: rows written through the public channel (NULL business_id,
--     reporter_auth_user_id set, Phase 2 flow).
--   - health_facility: reserved for an approved facility workflow; no flow
--     sets it yet and it is never backfilled without evidence.
--   - unknown: default for rows whose channel cannot be established reliably.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Immutability trigger (admin bypass for audited corrections)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_lock_report_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.report_source IS DISTINCT FROM NEW.report_source
     AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'report_source is immutable; ask a platform admin to correct it';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_lock_report_source ON adr_reports;
CREATE TRIGGER trg_adr_lock_report_source
  BEFORE UPDATE ON adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_lock_report_source();

COMMENT ON FUNCTION public.adr_lock_report_source() IS
  'Guards report_source against silent re-classification. Admin corrections use correct_adr_report_source (audited).';

-- ----------------------------------------------------------------------------
-- 2. source_corrected audit event type (existing values preserved)
-- ----------------------------------------------------------------------------
ALTER TABLE adr_report_events DROP CONSTRAINT IF EXISTS adr_report_events_event_type_check;
ALTER TABLE adr_report_events
  ADD CONSTRAINT adr_report_events_event_type_check
  CHECK (event_type IN (
    'created','status_changed','exported','note',
    'routing_created','routing_verified','routing_routed',
    'verification_recorded','history_linked',
    'acknowledged','assessment_recorded','followup_requested',
    'followup_addressed','workflow_updated',
    'source_corrected'
  ));

-- ----------------------------------------------------------------------------
-- 3. Admin correction RPC (the only legal re-classification path)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_adr_report_source(
  p_report_id uuid,
  p_source text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_actor record;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_source NOT IN ('public','health_facility','business_facility','unknown') THEN
    RAISE EXCEPTION 'invalid report_source %', p_source;
  END IF;

  SELECT report_source INTO v_old FROM adr_reports WHERE report_id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF p_reason IS NULL OR length(trim(both from p_reason)) = 0 THEN
    RAISE EXCEPTION 'a reason is required for source correction';
  END IF;

  UPDATE adr_reports SET report_source = p_source WHERE report_id = p_report_id;

  SELECT * INTO v_actor FROM adr_event_actor(p_report_id);
  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (p_report_id, 'source_corrected', v_actor.actor_type, v_actor.actor_name,
          jsonb_build_object('from', v_old, 'to', p_source, 'reason', trim(both from p_reason)));

  RETURN jsonb_build_object('report_id', p_report_id, 'report_source', p_source);
END
$$;

COMMENT ON FUNCTION public.correct_adr_report_source(uuid, text, text) IS
  'Admin-only source re-classification with mandatory reason, always audit-logged. Historical rows are only re-classified on reliable evidence.';

REVOKE EXECUTE ON FUNCTION public.correct_adr_report_source(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_adr_report_source(uuid, text, text) TO authenticated;
