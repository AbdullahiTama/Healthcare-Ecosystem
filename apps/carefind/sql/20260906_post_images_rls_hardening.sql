-- ============================================================================
-- 20260906_post_images_rls_hardening.sql
--
-- Harden post-images bucket to owner-scoped writes (spec-post-images-rls-hardening)
--
-- Problem: post-images bucket is public with anon+authenticated write
-- (storage.objects bucket_id='post-images' TO {anon,authenticated}) — any anon
-- can upload, no size/MIME limit, unlike credentials owner-scoped pattern.
--
-- What this migration does:
--   1. Keep post-images public read, but set file_size_limit=5242880 (5MB)
--      and allowed_mime_types={image/jpeg,image/png,image/webp}
--   2. Replace blanket anon+authenticated INSERT with owner-scoped
--      authenticated-only INSERT using (storage.foldername(name))[1]=auth.uid()::text
--      like credentials (sql/20260822_credentials_bucket_hardening.sql:11)
--   3. Keep image_urls jsonb + image_url mirror; keep live-media 100MB as is.
--
-- Path shape: uploads move from flat `<uid>-<ts>.jpg` to `<uid>/<ts>.jpg`
-- so ownership is derivable from the key. Public read via getPublicUrl keeps
-- working for anon (bucket public=true, SELECT policy anon,authenticated).
-- ============================================================================

begin;

-- 1. Bucket configuration -----------------------------------------------------
-- public read stays true; add 5MB limit and MIME whitelist.
update storage.buckets
   set public = true,
       file_size_limit = 5242880,                 -- 5 MB in bytes
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'post-images';

-- 2. Policies ----------------------------------------------------------------
-- Drops are idempotent (IF EXISTS) so re-run is safe. Names are exact as
-- seen in pg_policies for this bucket.
drop policy if exists "post-images write" on storage.objects;
drop policy if exists "post-images owner write" on storage.objects;

-- Write: authenticated users only, and only into their own folder (<uid>/...).
-- Mirrors credentials owner insert pattern.
create policy "post-images owner write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ============================================================================
-- VERIFICATION — run these, do not assume the statements above did anything.
--
--   -- (a) bucket is public, limited and typed
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'post-images';
--   -- expect: public=true, file_size_limit=5242880, 3 mime types (jpeg/png/webp)
--
--   -- (b) policies: read stays anon,authenticated; write is owner-scoped authenticated only
--   select policyname, cmd, roles::text, qual, with_check
--     from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'post-images%'
--    order by policyname;
--   -- expect: 2 rows
--   --   "post-images read"        SELECT  TO {anon,authenticated}  USING (bucket_id='post-images')
--   --   "post-images owner write" INSERT TO {authenticated}       WITH CHECK (bucket_id='post-images' AND foldername(name)[1]=auth.uid()::text)
--   --   and NO policy granting INSERT TO anon for post-images
--
--   -- (c) anon cannot insert
--   set local role anon;
--   select count(*) from storage.objects where bucket_id='post-images';
--   -- expect: read allowed (public bucket); INSERT should fail 42501 if attempted
--   reset role;
--
--   -- (d) live-media unchanged
--   select id, public, file_size_limit from storage.buckets where id='live-media';
--   -- expect: public=true, file_size_limit=104857600
-- ============================================================================
