-- Video posts (Feature Group H / Feature 9).
--
-- The posts.video_url column shipped directly to the live database before the
-- repo was tracking its DDL (same origin as video posts themselves). This
-- migration brings the schema definition into the repo idempotently and adds
-- the partial index the Videos tab filter relies on:
--
--   Feed.jsx: query.not('video_url', 'is', null) + order created_at desc
--
-- A partial index over (created_at DESC) WHERE video_url IS NOT NULL lets the
-- Videos tab read only video posts in creation order without scanning the
-- whole table.
--
-- The column is deliberately kept nullable and without a CHECK: older rows
-- predate it, and the composer writes video_url = null for every non-visual
-- post.

alter table public.posts
  add column if not exists video_url text;

create index if not exists posts_video_feed_idx
  on public.posts (created_at desc)
  where video_url is not null;
