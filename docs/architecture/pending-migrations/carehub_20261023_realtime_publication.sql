-- carehub_20261023_realtime_publication
--
-- Records which tables push live changes. Until 2026-10-23 this existed only as live state in the
-- project (found by reading pg_publication_tables), so a rebuilt or branched database would have
-- silently lost live updates for Live Field Activity and the notification bell.
--
-- Adds, only when missing:
--   public.field_activities     the feed (Postgres Changes, filtered by RLS for the connected role)
--   public.activity_comments    replies in the feed
--   public.activity_reactions   reactions in the feed
--   public.staff_notifications  the bell (lib/realtime.js watchTable)
--
-- Safe to run twice: each ADD TABLE is guarded by a pg_publication_tables check. It removes nothing and
-- does not touch any other member of the publication.
--
-- Verification at the end raises, and so rolls the whole migration back, if any table is not a member.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_activities', 'activity_comments', 'activity_reactions', 'staff_notifications']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['field_activities', 'activity_comments', 'activity_reactions', 'staff_notifications']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE EXCEPTION 'public.% is not in supabase_realtime after the migration', t;
    END IF;
  END LOOP;
END
$$;
