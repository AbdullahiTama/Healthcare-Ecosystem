-- Issue #7: multi-image posts + longer videos (2026-08-26).
--
-- 1. posts.image_urls — an ordered jsonb array of public storage URLs. The
--    legacy `image_url` column is KEPT and filled with the first photo by the
--    client, so every existing reader (and the crawler prerender before this
--    deploy) keeps working unchanged. Table-level grants already held by
--    anon/authenticated cover new columns automatically.
--
-- 2. live-media bucket size ceiling raised to match the client's new explicit
--    video cap (MAX_VIDEO_BYTES = 100MB in src/modules/social-feed/mediaLimits.js).
--    Duration is capped client-side at 180s by reading the clip's metadata;
--    storage has no duration concept, so the size limit is what it can enforce.

alter table public.posts
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update storage.buckets
  set file_size_limit = 104857600
  where id = 'live-media';
