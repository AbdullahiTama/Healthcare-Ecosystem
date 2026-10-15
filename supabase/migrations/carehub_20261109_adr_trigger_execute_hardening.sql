-- ============================================================================
-- ADR Reporting Module - Phase 9 prep hardening: trigger-function EXECUTE
--
-- Status: APPLIED 2026-10-15 to live DB with explicit owner authorisation
--         (migration `adr_trigger_execute_hardening`).
--
-- Trigger functions never need direct RPC execution (Postgres does not check
-- EXECUTE when firing a trigger). Revoking PUBLIC/anon shrinks the RPC
-- surface to the documented RPCs only, matching the existing
-- adr_report_events_trigger precedent.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.adr_lock_report_source() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_lock_report_source() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_route_assessment_author() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_route_assessment_author() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_route_child_events_trigger() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_route_child_events_trigger() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_stamp_deadline_rule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_stamp_deadline_rule() TO authenticated;

-- Close the same gap on the pre-existing ADR trigger functions for consistency.
REVOKE EXECUTE ON FUNCTION public.adr_report_events_trigger() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_report_events_trigger() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_event_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_event_actor(uuid) TO authenticated;
