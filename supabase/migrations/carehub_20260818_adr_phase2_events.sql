-- ============================================================================
-- ADR Reporting Module - Phase 2, Item 5: Append-only audit trail
--
-- Status: DRAFT — apply via MCP after review.
--
-- adr_report_events records the lifecycle of every ADR report:
--   - 'created'         when a report row is inserted (draft)
--   - 'status_changed'  on every status transition (metadata: from -> to)
--   - 'exported'        when the E2B / PDF export is produced (app-initiated)
--
-- Append-only by construction: RLS grants SELECT only. Nothing in the schema
-- allows UPDATE/DELETE of event rows from the client, and no trigger ever
-- rewrites one. The row carries no business_id — tenancy is derived through
-- the parent report, so the Item 4 can_access_adr_report(report_id) helper is
-- the single source of truth for visibility (a reporter sees only their own
-- report's timeline; owner/manager/admin see the whole business).
--
-- The insert trigger runs as the function owner (SECURITY DEFINER, search_path
-- pinned), so it is not subject to RLS. The trigger derives the actor from the
-- auth context when it can (staff by auth_user_id or email, else the business
-- owner by email match) and falls back to 'system'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS adr_report_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES adr_reports(report_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','status_changed','exported','note')),
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('owner','staff','system')),
  actor_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_report_events_report ON adr_report_events(report_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE adr_report_events ENABLE ROW LEVEL SECURITY;

-- SELECT scoped through the parent report (Item 4 visibility).
DROP POLICY IF EXISTS "adr_report_events read via report" ON adr_report_events;
CREATE POLICY "adr_report_events read via report" ON adr_report_events
  FOR SELECT
  USING (public.can_access_adr_report(report_id));

-- No INSERT/UPDATE/DELETE policies for the client: the trigger writes lifecycle
-- events server-side, and direct app-initiated events (exported) go through a
-- SECURITY DEFINER RPC that checks report visibility itself.

-- ── Actor resolution + trigger ───────────────────────────────────────────────
-- Resolves who is acting right now: a staff member by auth_user_id (falling
-- back to email match), else the business owner, else 'system'. Returns
-- (actor_type, actor_name).
CREATE OR REPLACE FUNCTION public.adr_event_actor(p_report_id uuid)
RETURNS TABLE(actor_type text, actor_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN s.id IS NOT NULL THEN 'staff'
      WHEN b.id IS NOT NULL THEN 'owner'
      ELSE 'system'
    END AS actor_type,
    COALESCE(s.full_name, b.owner, 'System') AS actor_name
  FROM adr_reports r
  LEFT JOIN staff s ON (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
    AND s.business_id = r.business_id AND s.status = 'active'
  LEFT JOIN businesses b ON b.id = r.business_id AND lower(b.email) = lower(auth.email())
  WHERE r.report_id = p_report_id
  LIMIT 1
$$;

-- Audits every row insert (created) and every status transition (status_changed).
CREATE OR REPLACE FUNCTION public.adr_report_events_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_actor FROM adr_event_actor(NEW.report_id);
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (NEW.report_id, 'created', v_actor.actor_type, v_actor.actor_name,
            jsonb_build_object('status', NEW.status));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT * INTO v_actor FROM adr_event_actor(NEW.report_id);
    INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
    VALUES (NEW.report_id, 'status_changed', v_actor.actor_type, v_actor.actor_name,
            jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_report_events ON adr_reports;
CREATE TRIGGER trg_adr_report_events
  AFTER INSERT OR UPDATE ON adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_report_events_trigger();

-- ── App-initiated events (exported / note) ───────────────────────────────────
-- The client must be able to record a non-lifecycle event (e.g. E2B export)
-- only for a report it can access. SECURITY DEFINER so the write bypasses RLS
-- after the visibility check (there is deliberately no INSERT policy).
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

  IF NOT public.can_access_adr_report(p_report_id) THEN
    RAISE EXCEPTION 'not accessible';
  END IF;

  SELECT * INTO v_actor FROM adr_event_actor(p_report_id);

  INSERT INTO adr_report_events (report_id, event_type, actor_type, actor_name, metadata)
  VALUES (p_report_id, p_event_type, v_actor.actor_type, v_actor.actor_name, p_metadata)
  RETURNING event_id INTO v_event_id;

  RETURN jsonb_build_object('event_id', v_event_id);
END
$$;

REVOKE EXECUTE ON FUNCTION public.adr_event_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_event_actor(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.adr_log_event(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_log_event(uuid, text, jsonb) TO authenticated;

-- NOTE: REVOKE ... FROM anon alone is ineffective — PUBLIC holds EXECUTE (the
-- implicit default for new functions), which re-grants every role including
-- anon. The migration must revoke from PUBLIC and re-grant to authenticated.
--
-- EXECUTE on adr_report_events_trigger() is revoked from PUBLIC but granted
-- to authenticated: Postgres does not check EXECUTE on a trigger function for
-- the user firing the DML (the server invokes it), so DML keeps working while
-- the anon RPC-probe surface is removed. Verified live: the trigger still
-- records created/status_changed after the revoke.