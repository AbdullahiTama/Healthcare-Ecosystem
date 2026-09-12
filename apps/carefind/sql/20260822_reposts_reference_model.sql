-- ============================================================================
-- 20260822_reposts_reference_model.sql
--
-- Issues #6 and #8: "reposted articles do not show on the reposting user's
-- profile" and "reposted articles show as original content by the reposting
-- user, with no attribution to the original author".
--
-- CONTEXT. The schema was already reference-based: `post_reposts` records
-- (source post, reposting user), and `posts.repost_of` links a repost row back
-- to its source (20260813_post_reposts.sql). The client, however, ALSO copied
-- the source's words into the repost row:
--
--     content = '🔁 ' || source.content,   post_type = 'text',
--     user_id = <the reposter>
--
-- so the row genuinely held someone else's writing under the reposter's id.
-- Three consequences, all reported:
--   * no attribution — the card had nothing to credit the author with;
--   * a reposted ARTICLE was stored as `🔁 [{"id":…,"type":"text",…}]` with
--     post_type 'text', and rendered to readers as raw JSON;
--   * engagement fragmented — likes and comments landed on the copy, so the
--     original never showed the reaction its author's writing earned.
--
-- The client now writes a reference and resolves the source at render time
-- (src/modules/social-feed/engagement.js, reposts.js, PostCard.jsx). This
-- migration brings the rows already in production into that same shape, so
-- there is ONE rendering path rather than one for old rows and one for new.
--
-- WHAT IT DOES. For every `posts` row with `repost_of` set, replace the copied
-- content with the bare marker. `content` is NOT NULL, and the marker is what
-- the pre-repost_of code recognised (postDisplay.isRepost), so an old client
-- served from cache still identifies the row correctly instead of showing an
-- empty post.
--
-- SAFETY. This deletes no user writing: every affected row's content is a COPY
-- of `repost_of`'s content, which is untouched. The verification block below
-- proves that claim for each row BEFORE the update rather than assuming it —
-- if any repost row's content is not derivable from its source, the migration
-- aborts and leaves that row alone for a human to look at.
-- ============================================================================

begin;

-- Guard: refuse to run if any repost row holds content that is NOT simply the
-- marker plus (a whitespace-collapsed form of) its source's content. Such a
-- row would be something other than a mechanical copy, and blanking it could
-- destroy writing. `writeRepost` collapsed whitespace when it copied, so the
-- comparison collapses both sides the same way.
do $$
declare
  suspicious int;
begin
  select count(*)
    into suspicious
    from public.posts r
    join public.posts s on s.id = r.repost_of
   where r.repost_of is not null
     and r.content is not null
     and btrim(r.content) <> '🔁'
     and regexp_replace(btrim(r.content), '\s+', ' ', 'g')
         <> regexp_replace(btrim('🔁 ' || coalesce(s.content, '')), '\s+', ' ', 'g');

  if suspicious > 0 then
    raise exception
      'Aborting: % repost row(s) hold content that is not a copy of their source. Inspect them before backfilling.',
      suspicious;
  end if;
end $$;

update public.posts
   set content = '🔁'
 where repost_of is not null
   and btrim(content) <> '🔁';

commit;

-- ============================================================================
-- VERIFICATION — run these; do not assume the UPDATE above did what it says.
--
--   -- (a) every repost row now carries the marker and nothing else
--   select count(*) filter (where btrim(content) = '🔁') as normalised,
--          count(*)                                      as total_reposts
--     from public.posts where repost_of is not null;
--   -- expect: normalised = total_reposts
--
--   -- (b) no source lost anything — the originals are untouched
--   select count(*) from public.posts p
--    where p.repost_of is null and (p.content is null or btrim(p.content) = '');
--   -- expect: unchanged from before the migration (0)
--
--   -- (c) every repost still resolves to a real source
--   select count(*) from public.posts r
--    left join public.posts s on s.id = r.repost_of
--    where r.repost_of is not null and s.id is null;
--   -- expect: 0 (posts.repost_of is ON DELETE CASCADE, so orphans cannot form)
-- ============================================================================
