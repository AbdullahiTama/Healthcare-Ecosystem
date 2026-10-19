-- Make field-activity changes deliverable over Realtime. PREPARED, NOT APPLIED.
-- Tested on PGlite (scripts/db-tests/activity.pglite.mjs): idempotent, and a no-op
-- when the publication does not exist.
--
-- The app listens to INSERTs on field_activities and to any change on
-- activity_reactions and activity_comments (lib/realtime.js, LiveActivity.jsx).
-- A table only delivers changes if it is in the supabase_realtime publication.
-- Nothing in this repository previously added them, so whether they are published
-- today is configured in the dashboard and unknown here. Check first:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--
-- Delivery still respects RLS: a subscriber only receives rows they may SELECT, so
-- this does not widen who can see an activity (see carehub_20261125_field_activity_access).
-- Adding a table to a publication only adds replication overhead for that table.
--
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.<table>;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publication supabase_realtime does not exist; nothing to do';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['field_activities', 'activity_reactions', 'activity_comments'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
