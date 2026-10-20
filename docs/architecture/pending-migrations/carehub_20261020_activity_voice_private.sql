-- DRAFT, NOT APPLIED. DO NOT APPLY BEFORE THE APP RELEASE DESCRIBED BELOW IS LIVE. Needs explicit approval.
-- Audit finding F3 (docs/audits/live-field-activity-audit.md), the highest-severity open item.
--
-- WHAT IS WRONG TODAY (confirmed on the live project, 2026-10-20)
--   The activity-voice bucket is public. Its two storage policies ("activity-voice insert" and
--   "activity-voice read") grant INSERT and SELECT to anon and authenticated with no condition beyond the
--   bucket. So anyone on the internet, signed in or not, can upload any file there (no size or type limit)
--   and can read any voice note. File names are 'voice-<timestamp>-<5 digits>.<ext>', a small space to
--   guess. A voice note is a first-person account of field work and can name patients or clients.
--   Today: 6 of 12 reports carry one, stored as full public URLs ('.../object/public/activity-voice/voice-...').
--
-- WHAT THIS CHANGES
--   * The bucket becomes private, capped at 10 MB, audio types only.
--   * Every existing policy that mentions the bucket is dropped BY PREDICATE (not by name: a wrong name is a
--     silent no-op) and replaced by two:
--       - INSERT: signed-in users only, and only into a folder named after a company they belong to
--         ('<business id>/<file>'), so one company cannot fill or overwrite another's space.
--       - SELECT: signed-in users only, and only for a file they uploaded themselves, or that a report they
--         are allowed to see points to. The report's own row level security decides, so once saved a voice
--         note is exactly as visible as its report. This also covers the 6 existing flat-named files, which
--         keep working (5 were uploaded anonymously and have no owner; they are reached through their report).
--   * No UPDATE or DELETE policy: notes are records. Cleaning up files that never got a report is a
--     service-role job.
--
-- THIS BREAKS THE APP UNTIL IT IS CHANGED. Required first, in one app release that works both before and
-- after this migration:
--   1. Play voice notes through a signed URL (POST /storage/v1/object/sign/activity-voice/<path>) built from
--      the stored URL's path, not the stored public URL. Falls back to the stored URL if signing fails, so
--      the same release also works while the bucket is still public.
--   2. Upload to '<business id>/<activity id>.<ext>' with the signed-in session, and send the MIME type
--      WITHOUT parameters ('audio/webm', not 'audio/webm;codecs=opus'), which the allow-list matches exactly.
--   Without (1) every existing voice note stops playing; without (2) every new upload is refused.
--   The stored voice_url values need no data migration.
--
-- Rollback (restores the exposure, so only as an emergency measure):
--   UPDATE storage.buckets SET public = true, file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'activity-voice';
--   then recreate the two original policies (INSERT and SELECT for anon, authenticated; bucket_id = 'activity-voice').

UPDATE storage.buckets
   SET public = false,
       file_size_limit = 10485760,
       allowed_mime_types = ARRAY['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/x-m4a']
 WHERE id = 'activity-voice';

-- Drop by predicate, not by name.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-voice%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "activity-voice insert own business" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'activity-voice'
    AND (storage.foldername(name))[1] IN (SELECT b::text FROM public.current_business_ids() AS b)
  );

-- Readable by the person who uploaded it (the storage service records the uploader in owner_id for every
-- signed-in upload; live data confirms it), or by anyone who can see a report that points to it. The first
-- half matters in two ways: a new recording exists before its report does, and an INSERT ... RETURNING must
-- also pass the SELECT policy, so without it a brand-new upload could be refused.
CREATE POLICY "activity-voice read own or via report" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'activity-voice'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.field_activities a
         WHERE a.voice_url IS NOT NULL
           AND right(a.voice_url, length(objects.name) + 1) = '/' || objects.name
      )
    )
  );

-- Verify, do not assume.
DO $$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'activity-voice') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'activity-voice is still public';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-voice%'
       AND (roles && ARRAY['anon', 'public']::name[])
  ) THEN
    RAISE EXCEPTION 'a policy on activity-voice still admits anon or public';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-voice%') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two activity-voice policies';
  END IF;
END $$;
