-- ============================================================================
-- ADR Reporting Module - Phase 6: analytics access logging
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Lets verified/routed responsible companies record `exported`/`note` audit
-- events (e.g. analytics drill-down access notes) on cases they may read.
-- The visibility check gains the routed-read branch; everything else about
-- adr_log_event is identical (allowed types, DEFINER write, raise otherwise).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adr_log_event(
  p_report_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
  v_event_id uuid;
BEGIN
  IF p_event_type NOT IN ('exported', 'note') THEN
    RAISE EXCEPTION 'event_type % not permitted from client', p_event_type;
  END IF;

  IF NOT public.can_access_adr_report(p_report_id)
     AND NOT public.can_access_adr_public_draft(p_report_id)
     AND NOT public.can_access_adr_routed_report(p_report_id) THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  SELECT * INTO v_actor FROM adr_event_actor(p_report_id);

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (p_report_id, p_event_type, v_actor.actor_type, v_actor.actor_name, p_metadata)
  RETURNING event_id INTO v_event_id;

  RETURN jsonb_build_object('event_id', v_event_id);
END
$$;

COMMENT ON FUNCTION public.adr_log_event(uuid, text, jsonb) IS
  'App-initiated audit events (Phase 6: + routed-company branch for analytics access logging). Visibility-checked; DEFINER write into the append-only trail.';
