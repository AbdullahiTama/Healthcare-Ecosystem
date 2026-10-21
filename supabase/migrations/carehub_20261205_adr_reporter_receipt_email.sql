-- ============================================================================
-- Safety reports: e-mail the reporter their ADR number when the report is submitted.
--
-- Status: APPLIED to production (szdybxmgmhndoytqanfb) on 2026-10-21 with owner approval, AFTER the app with the
--         template `adr_report_received` was deployed (both Vercel projects green for commit d0b130a).
--         Verified live in a rolled-back transaction: one outbox row (template, subject, sender correct; payload is
--         report_number + recipient_name only), logged as sent, a re-fire adds no second row; trigger enabled; no API
--         role can execute the function. The 12 reports submitted earlier are not e-mailed (trigger fires only on
--         draft -> submitted).
--
-- How it works
--   * The e-mail goes through the platform's existing catalog-governed path:
--     enqueue_business_email_event('carefind', 'adr_report_received', ...). The
--     per-minute outbox cron (email-outbox-carefind, active in production) delivers
--     it through Resend. Nothing new on the delivery side.
--   * It is produced by a database trigger on the transition draft -> submitted of
--     a PUBLIC report, so it cannot be skipped by the browser, cannot be sent for a
--     draft, and is once-only: source_id = report_id is UNIQUE per (app, event).
--   * It goes to reporter_email, the address the reporter typed on the report, and
--     only when that is a valid address. No address, no e-mail (the receipt screen
--     in the app still shows the number).
--   * The payload is the report number and the reporter's own name, nothing else:
--     no product, patient, reaction or company detail ever leaves in an e-mail.
--   * Failure never blocks a submission: the trigger swallows the error and records
--     it in adr_notification_log (kind 'adr_reporter_receipt'), which the platform
--     reviewers already see through list_adr_notification_failures().
--
-- The catalog row satisfies production's CHECKs (strict payload schema, brand
-- check: sender, reply-to and a 'CareFind:' subject prefix, unprefixed template key).
-- Existing reports are NOT e-mailed by this migration (see the note at the end).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.email_event_catalog') IS NULL THEN
    RAISE EXCEPTION 'the e-mail catalog is not installed';
  END IF;

  INSERT INTO public.email_event_catalog
    (app, event_key, template_key, subject_template, from_email, reply_to, payload_schema,
     enabled, required_for_business, category, rollout_mode)
  VALUES
    ('carefind', 'adr_report_received', 'adr_report_received',
     'CareFind: Safety report {{report_number}} received',
     'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app',
     '{"type":"object","required":["report_number"],"properties":{"report_number":{"type":"string","maxLength":20,"pattern":"^ADR-[0-9]{4}-[0-9]{6}$"},"recipient_name":{"type":"string","maxLength":120}},"additionalProperties":false}'::jsonb,
     true, false, 'transactional', 'live')
  ON CONFLICT (app, event_key) DO UPDATE SET enabled = true;
END $$;

CREATE OR REPLACE FUNCTION public.adr_enqueue_reporter_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_name text;
  v_payload jsonb;
  v_outbox uuid;
BEGIN
  IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted'
          AND NEW.report_source = 'public'
          AND NEW.gate_validated_at IS NOT NULL
          AND NEW.report_number IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  v_email := nullif(btrim(coalesce(NEW.reporter_email, '')), '');
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_name := nullif(left(btrim(regexp_replace(coalesce(NEW.reporter_name, ''), '[[:cntrl:]]', ' ', 'g')), 120), '');
    v_payload := jsonb_build_object('report_number', NEW.report_number)
              || CASE WHEN v_name IS NOT NULL THEN jsonb_build_object('recipient_name', v_name) ELSE '{}'::jsonb END;
    v_outbox := public.enqueue_business_email_event('carefind', 'adr_report_received', v_email, v_payload, NEW.report_id);
    IF v_outbox IS NULL THEN
      -- the catalog suppressed it (event disabled or paused): say so instead of recording a send
      INSERT INTO adr_notification_log (report_id, kind, status, error)
      VALUES (NEW.report_id, 'adr_reporter_receipt', 'failed', 'suppressed by the e-mail catalog');
    ELSE
      INSERT INTO adr_notification_log (report_id, kind, status) VALUES (NEW.report_id, 'adr_reporter_receipt', 'sent');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A broken e-mail must never roll back a valid submission.
    INSERT INTO adr_notification_log (report_id, kind, status, error)
    VALUES (NEW.report_id, 'adr_reporter_receipt', 'failed', left(SQLERRM, 500));
  END;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.adr_enqueue_reporter_receipt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_adr_reporter_receipt ON public.adr_reports;
CREATE TRIGGER trg_adr_reporter_receipt
  AFTER UPDATE OF status ON public.adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_enqueue_reporter_receipt();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_event_catalog WHERE app = 'carefind' AND event_key = 'adr_report_received' AND enabled) THEN
    RAISE EXCEPTION 'adr_report_received is not enabled in the catalog';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'adr_enqueue_reporter_receipt') <> 1 THEN
    RAISE EXCEPTION 'unexpected function overloads';
  END IF;
  IF has_function_privilege('anon', 'public.adr_enqueue_reporter_receipt()', 'execute')
     OR has_function_privilege('authenticated', 'public.adr_enqueue_reporter_receipt()', 'execute') THEN
    RAISE EXCEPTION 'the trigger function must not be callable by API roles';
  END IF;
END $$;

-- NOTE (decision for the owner, deliberately not done here): reports submitted before
-- 2026-10-21 were given a wrong number (every public report was ADR-2026-000001) and were
-- renumbered by carehub_20261204. Their reporters have not been told. Sending each of them
-- their corrected number is a one-off, outward-facing e-mail to real people and needs the
-- owner's go-ahead and wording; it is not part of this migration.
