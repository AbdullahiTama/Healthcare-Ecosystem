-- DRAFT, NOT APPLIED. Needs explicit approval before it goes to supabase/migrations and production.
-- Audit item U2 (docs/audits/live-field-activity-audit.md).
--
-- WHAT IS WRONG TODAY
--   The app tells people about a report (and about a reply to their report) by inserting
--   staff_notifications rows from the browser. The live policy on that table lets a person write a row
--   only for THEMSELVES (or the owner for the owner), so those inserts are refused with 42501. The old code
--   swallowed the refusal, so tagged colleagues, and reps whose reports got a reply, were most likely never
--   alerted. Proved on a replica of the live policy (scripts/db-tests/activity.pglite.mjs). There are no
--   triggers on staff_notifications, activity_viewers or activity_comments today.
--
-- WHAT THIS CHANGES
--   The database writes the alert itself, in the same transaction as the thing it announces:
--     * a row added to activity_viewers  -> the viewer is alerted ("<rep> logged field activity")
--     * a row added to activity_comments -> the report's author is alerted ("<name> replied to your activity")
--   Nobody is ever alerted about their own action, an inactive or other-company person is skipped, and a
--   retry that adds no new viewer row sends no second alert. The trigger functions run as their owner (they
--   write rows the caller may not write directly); they take no input from the caller beyond the row that
--   fired them, and cannot be called directly.
--
-- HOW IT PAIRS WITH THE APP
--   Independent of the app release: until the app stops its own (refused) attempt, behaviour is unchanged
--   apart from alerts now arriving. If a platform admin saves a report, the browser's own insert would also
--   succeed and the viewer would be alerted twice; log_field_activity() (carehub_20261020_log_field_activity)
--   reports alerts:'server' when these triggers exist so the app can skip its own attempt.
--
-- Rollback: DROP TRIGGER trg_activity_viewers_alert ON public.activity_viewers;
--           DROP TRIGGER trg_activity_comments_alert ON public.activity_comments;
--           DROP FUNCTION public.alert_activity_viewer(), public.alert_activity_comment();

CREATE OR REPLACE FUNCTION public.alert_activity_viewer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  a record;
BEGIN
  SELECT fa.business_id, fa.staff_id, fa.rep_name, fa.location_label
    INTO a FROM public.field_activities fa WHERE fa.id = NEW.activity_id;
  -- Not found, no viewer, or the author tagging themselves: nothing to say.
  IF a.business_id IS NULL OR NEW.staff_id IS NULL OR NEW.staff_id IS NOT DISTINCT FROM a.staff_id THEN
    RETURN NEW;
  END IF;
  -- Only an active member of the report's own company is alerted.
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                  WHERE s.id = NEW.staff_id AND s.business_id = a.business_id AND s.status = 'active') THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  VALUES (a.business_id, NEW.staff_id, false, 'activity', a.rep_name || ' logged field activity', a.location_label, 'activity');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.alert_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  a record;
BEGIN
  SELECT fa.business_id, fa.staff_id INTO a FROM public.field_activities fa WHERE fa.id = NEW.activity_id;
  -- A report written by the owner has no staff author to alert; replying to yourself alerts nobody.
  IF a.business_id IS NULL OR a.staff_id IS NULL OR a.staff_id IS NOT DISTINCT FROM NEW.staff_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                  WHERE s.id = a.staff_id AND s.business_id = a.business_id AND s.status = 'active') THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  VALUES (a.business_id, a.staff_id, false, 'activity_comment',
          COALESCE(NULLIF(btrim(NEW.actor_name), ''), 'Someone') || ' replied to your activity', NEW.body, 'activity');
  RETURN NEW;
END $$;

-- Trigger functions are not meant to be called. Supabase re-grants EXECUTE to anon and authenticated
-- when a function is created, after any earlier REVOKE, so remove it explicitly here.
REVOKE ALL ON FUNCTION public.alert_activity_viewer(), public.alert_activity_comment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_activity_viewers_alert ON public.activity_viewers;
CREATE TRIGGER trg_activity_viewers_alert AFTER INSERT ON public.activity_viewers
  FOR EACH ROW EXECUTE FUNCTION public.alert_activity_viewer();

DROP TRIGGER IF EXISTS trg_activity_comments_alert ON public.activity_comments;
CREATE TRIGGER trg_activity_comments_alert AFTER INSERT ON public.activity_comments
  FOR EACH ROW EXECUTE FUNCTION public.alert_activity_comment();

-- Verify, do not assume (a completed statement proves nothing; the ACL trap has bitten this project).
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgname IN ('trg_activity_viewers_alert', 'trg_activity_comments_alert') AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'expected both alert triggers';
  END IF;
  IF has_function_privilege('anon', 'public.alert_activity_viewer()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.alert_activity_viewer()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.alert_activity_comment()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.alert_activity_comment()', 'EXECUTE') THEN
    RAISE EXCEPTION 'alert trigger functions must not be executable by anon or authenticated';
  END IF;
END $$;
