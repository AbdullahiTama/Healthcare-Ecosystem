-- ============================================================================
-- 20260822_credentials_bucket_hardening.sql
--
-- Issue #5: "Licence verification only accepts images, and upload fails below
-- the stated size limit."
--
-- ROOT CAUSE (proven against the live project before writing this file, not
-- inferred from the symptom): the reported failure has nothing to do with file
-- size. `storage.objects` carries an INSERT policy for every bucket the app
-- writes to — news-images, story-images, promo-images, avatars, covers,
-- post-images, live-media, business-assets, message-files, order-files,
-- rep-receipts, activity-voice, adr-evidence — and NO policy of any kind for
-- `credentials`. RLS is enabled on storage.objects, so a bucket with no INSERT
-- policy is deny-all: every professional-licence upload has been rejected 42501
-- regardless of its size. VerifyProfessional.jsx then reported the generic
-- "Upload failed. Try a smaller image.", which is why this looked like a broken
-- size limit. Confirmed by enumerating pg_policies for schemaname='storage':
--
--   select policyname, cmd, with_check from pg_policies
--    where schemaname='storage' and tablename='objects';
--   -- 28 rows, none of them mentioning 'credentials'
--
-- SECOND FINDING, not in the issue report: the `credentials` bucket is
-- `public = true` with `file_size_limit = null` and `allowed_mime_types = null`.
-- Professional licences, MDCN/PCN certificates and work IDs — identity
-- documents — are therefore world-readable to anyone who has or can guess the
-- object URL, and `verification_requests.credential_url` stores exactly that
-- public URL. No size or type limit is enforced anywhere in the stack: neither
-- the "3 MB" nor the "5 MB" figure quoted in the UI has ever been real.
--
-- WHAT THIS MIGRATION DOES
--   1. Makes `credentials` a PRIVATE bucket, with a real 5 MB size limit and an
--      explicit MIME whitelist that includes application/pdf (many licences are
--      issued or scanned as PDFs — the missing-feature half of the issue).
--   2. Adds the missing INSERT policy, scoped so an authenticated user may only
--      write into their own `<auth.uid()>/…` folder — not a blanket
--      "bucket_id = 'credentials'" grant like the older buckets have.
--   3. Adds owner-only SELECT/UPDATE/DELETE so a user can re-read or replace
--      their own document, and nobody else can.
--   4. Leaves admin review working: AdminPanel reaches credentials through the
--      service-role client in api/_handlers/admin-auth.js (`credential_url`
--      action, added in the same change), which bypasses RLS by design. No
--      anon or authenticated role can read another user's document.
--
-- 5 MB is chosen over the 3 MB quoted in the report because 5 MB is the figure
-- the UI already showed and is comfortable for a scanned multi-page PDF. It is
-- now enforced in three places that agree: this bucket limit, the client-side
-- check in VerifyProfessional.jsx, and the copy the user reads.
--
-- PATH SHAPE: uploads move from a flat `<uid>-<ts>.<ext>` name to
-- `<uid>/<ts>.<ext>` so ownership is derivable from the key. The five legacy
-- flat objects stay readable to the admin service-role client, which is the
-- only thing that reads them.
-- ============================================================================

begin;

-- 1. Bucket configuration -----------------------------------------------------
update storage.buckets
   set public            = false,
       file_size_limit   = 5242880,                    -- 5 MB, in bytes
       allowed_mime_types = array[
         'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
         'image/heic', 'image/heif',
         'application/pdf'
       ]
 where id = 'credentials';

-- 2. Policies ----------------------------------------------------------------
-- Dropped by exact name first. These names are new in this migration, so the
-- drops are no-ops on a first run and make a re-run idempotent. (Note the
-- standing lesson in architecture/Security-Risks.md: DROP POLICY IF EXISTS on
-- a name that does not exist is a SILENT no-op, so the verification block at
-- the bottom re-reads pg_policies rather than trusting these statements.)
drop policy if exists "credentials owner insert" on storage.objects;
drop policy if exists "credentials owner read"   on storage.objects;
drop policy if exists "credentials owner update" on storage.objects;
drop policy if exists "credentials owner delete" on storage.objects;

-- Write: authenticated users only, and only into their own folder.
create policy "credentials owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read: the uploader only. Admin review does not use this path — it uses the
-- service-role client, which is not subject to RLS.
create policy "credentials owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Replace / remove: same ownership rule, so a user can re-submit a clearer
-- scan without an admin round trip.
create policy "credentials owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "credentials owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ============================================================================
-- VERIFICATION — run these, do not assume the statements above did anything.
--
--   -- (a) bucket is private, limited and typed
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'credentials';
--   -- expect: public=false, file_size_limit=5242880, 7 mime types incl. application/pdf
--
--   -- (b) the four policies exist, and are scoped (not qual:true)
--   select policyname, cmd, roles::text, qual, with_check
--     from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'credentials%'
--    order by policyname;
--   -- expect: 4 rows, all TO authenticated, all referencing storage.foldername
--
--   -- (c) anon cannot read the bucket at all
--   set local role anon;
--   select count(*) from storage.objects where bucket_id = 'credentials';
--   -- expect: 0
--   reset role;
--
--   -- (d) an authenticated user sees only their own folder. Impersonate a real
--   --     uploader and confirm they see their own objects and zero of anyone
--   --     else's, then roll back.
-- ============================================================================
