-- =============================================================================
-- CareFind engagement phase — combined paste-ready migration
-- GENERATED artifact: concatenates the seven 2026-08-13 migration files so the
-- whole phase can be applied in one paste. Do not hand-edit — change the
-- source files in apps/carefind/sql/ and regenerate. Order is not significant
-- (all seven are independent and idempotent).
--
-- APPLY: paste the whole file into the Supabase SQL editor for the live project
-- (szdybxmgmhndoytqanfb) and Run. Everything runs inside one transaction — if
-- any statement fails the whole phase rolls back and can be re-run after fixing.
--
-- DESTRUCTIVE BUT INTENTIONAL:
--   * post_reactions / saved_posts duplicate rows are collapsed to the earliest
--     id (this phase's whole point).
--   * follows rows pointing at profiles that no longer exist, and self-follows,
--     are deleted so the new FKs can validate.
--   * follows.created_at is backfilled to now() for pre-existing rows.
--
-- VERIFY AFTER APPLYING: each section carries its own VERIFY block; a compact
-- checklist is appended after commit.
-- =============================================================================

begin;

-- =============================================================================
-- SECTION 1/7 : 20260813_post_engagement_uniqueness.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind engagement integrity: unique (post, user) rows
--
-- WHY THIS EXISTS
-- ---------------
-- A like or a save must be at most one row per (post, user). The tables have
-- never enforced that (Schema-Reference-CareFind.md: post_reactions is "One
-- row per (user, post) in practice, not DB-enforced"), and the client toggles
-- are optimistic — fire-and-forget inserts with temp ids. Two consequences:
--
--   1. Duplicates. A double-tap or a retried optimistic write can insert two
--      rows for the same (post, user); counts double and unlike-by-id removes
--      only one of them.
--   2. Vanish-on-reload. The insert is not reconciled: if it silently failed
--      (RLS, network), the UI kept the temp row until the next full load,
--      which re-derives state from the DB and the like/save simply disappears.
--
-- This migration closes #1 at the source (the DB). The client-side
-- reconciliation (#2) is handled in the matching app change
-- (Feed.jsx/useFeed.js toggle reconciliation) — this SQL is the foundation
-- that lets the write path be made atomic and idempotent.
--
-- DESIGN
-- ------
-- * Duplicates are collapsed FIRST, keeping the earliest id (these tables
--   have no created_at, so id order is the deterministic proxy), because a
--   unique index cannot be built over duplicate data.
-- * Unique INDEXES (not constraints) so ON CONFLICT in app/future RPC writes
--   can target them by name and the feed can upsert idempotently.
--
-- SCOPE
-- -----
-- Two dedupe sweeps + two unique indexes. RLS untouched (post_reactions and
-- saved_posts are already correctly self-scoped). Idempotent; run once via
-- the Supabase SQL editor.
-- ============================================================================

-- 1a. Collapse duplicate likes to the earliest row.
delete from public.post_reactions r
 where exists (
   select 1 from public.post_reactions k
    where k.post_id = r.post_id and k.user_id = r.user_id and k.id < r.id
 );

-- 1b. Collapse duplicate saves to the earliest row.
delete from public.saved_posts s
 where exists (
   select 1 from public.saved_posts k
    where k.post_id = s.post_id and k.user_id = s.user_id and k.id < s.id
 );

-- 2a. One like per (post, user). ON CONFLICT (post_id, user_id) targets this.
create unique index if not exists post_reactions_user_post_uniq
  on public.post_reactions (post_id, user_id);

-- 2b. One save per (post, user). ON CONFLICT (post_id, user_id) targets this.
create unique index if not exists saved_posts_user_post_uniq
  on public.saved_posts (post_id, user_id);

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Indexes exist:
--        select indexname from pg_indexes
--        where indexname in ('post_reactions_user_post_uniq', 'saved_posts_user_post_uniq');
--   2. No duplicates remain:
--        select post_id, user_id, count(*) from public.post_reactions
--        group by post_id, user_id having count(*) > 1;  -- must be empty
--        select post_id, user_id, count(*) from public.saved_posts
--        group by post_id, user_id having count(*) > 1;  -- must be empty
--   3. A raw insert of an existing (post, user) pair now errors with
--      duplicate_key_value_contraint instead of silently adding a row.
-- ============================================================================


-- =============================================================================
-- SECTION 2/7 : 20260813_post_reposts.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind universal reposts: post_reposts reference table
--
-- WHY THIS EXISTS
-- ---------------
-- A "repost" has never been a real feature — it exists only as a display
-- convention: posts rows whose content begins with REPOST_MARK ('🔁',
-- postDisplay.jsx), with no structured record of which post was reposted,
-- who did it, or when. There is no repost button on feed cards at all (the
-- only "repost" in the codebase, LiveShow.jsx, is local UI state that is
-- never persisted). apply_feed_audit.sql itself notes "there is no
-- post_reposts table".
--
-- This adds the real persistence layer: one row per (reposter, post), with a
-- unique index so a double-tap is idempotent, RLS in the same public-read /
-- self-write shape as `follows`, and a trigger-maintained `posts.repost_count`
-- so the feed can show a count without joining this table.
--
-- DESIGN DECISION (classic feed repost, agreed in the phase plan)
-- ---------------------------------------------------------------
-- A repost is BOTH a real feed post and a reference to its source:
--   1. A new posts row whose content starts with 🔁 (the reposter's feed,
--      exactly the display convention postDisplay.jsx already understands)
--      and whose `repost_of` column records the source post.
--   2. A post_reposts row (post_id = source, user_id = reposter) that is the
--      machine-readable reference: it is what the unique index guards against
--      duplicate reposts, what the Reposts tab on profiles can join, and what
--      the trigger counts on the source post.
-- Deleting the source post cascades: its reposts (repost_of) and its
-- post_reposts references both die with it.
-- Legacy 🔁-marked rows are left in place (they remain ordinary posts) — they
-- cannot be reliably mapped to a source post because the marker convention
-- never recorded one, so backfilling would guess wrong.
--
-- DESIGN
-- ------
-- * `post_reposts(post_id, user_id)` + partial unique index => at most one
--   repost per user per post; writes use ON CONFLICT DO NOTHING.
-- * Cascading deletes: removing a post removes its reposts; removing a
--   profile removes their reposts.
-- * RLS mirrors follows: SELECT public (a repost is public social graph
--   data, exactly like a follow), INSERT/DELETE self-scoped.
-- * `repost_count` is maintained by a SECURITY DEFINER trigger function so a
--   repost write updates posts.repost_count without a client round-trip and
--   without RLS standing in the way of a count-only write.
--
-- SCOPE
-- -----
-- One table, one column on posts, two indexes, one trigger function, one
-- trigger, three policies. Idempotent; run once via the Supabase SQL editor.
-- ============================================================================

-- 1. The reference table.
create table if not exists public.post_reposts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One repost per user per post; ON CONFLICT (post_id, user_id) targets this.
create unique index if not exists post_reposts_user_post_uniq
  on public.post_reposts (post_id, user_id);

create index if not exists post_reposts_post_id_idx on public.post_reposts (post_id);
create index if not exists post_reposts_user_id_idx on public.post_reposts (user_id);

-- 2. Denormalized count on posts, so feed cards render a count cheaply.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'posts' and column_name = 'repost_count') then
    alter table public.posts add column repost_count integer not null default 0;
  end if;
end $$;

-- 3. Classic-repost linkage: a 🔁 post records which original it reposts.
--    on delete cascade removes the repost when the source is deleted.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'posts' and column_name = 'repost_of') then
    alter table public.posts add column repost_of uuid references public.posts(id) on delete cascade;
  end if;
end $$;

create index if not exists posts_repost_of_idx on public.posts (repost_of)
  where repost_of is not null;

-- 4. RLS in the follows shape (public read, self write).
alter table public.post_reposts enable row level security;

drop policy if exists "post_reposts publicly readable" on public.post_reposts;
create policy "post_reposts publicly readable"
  on public.post_reposts for select using (true);

drop policy if exists "post_reposts insertable by their own user" on public.post_reposts;
create policy "post_reposts insertable by their own user"
  on public.post_reposts for insert with check (user_id = auth.uid());

drop policy if exists "post_reposts deletable by their own user" on public.post_reposts;
create policy "post_reposts deletable by their own user"
  on public.post_reposts for delete using (user_id = auth.uid());

-- 5. Trigger-maintained count. SECURITY DEFINER so the count write (a column
--    a normal session is never asked to update) is not blocked by RLS.
create or replace function public.maintain_post_repost_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if tg_op = 'INSERT' then
    update public.posts set repost_count = repost_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set repost_count = greatest(repost_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$func$;

drop trigger if exists trg_maintain_post_repost_count on public.post_reposts;
create trigger trg_maintain_post_repost_count
  after insert or delete on public.post_reposts
  for each row execute function public.maintain_post_repost_count();

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Table + indexes + columns exist:
--        select table_name from information_schema.tables where table_name = 'post_reposts';
--        select column_name from information_schema.columns
--        where table_name = 'posts' and column_name in ('repost_count','repost_of');
--   2. RLS policies:
--        select policyname from pg_policies where tablename = 'post_reposts';
--      (publicly readable / insertable by their own user / deletable by
--      their own user).
--   3. Behavioural probe (owner session, rolled-back block): insert a
--      post_reposts row for user A on post P => posts.repost_count for P
--      becomes 1; a second insert for the same pair => unique violation
--      (or 0 rows with ON CONFLICT DO NOTHING); delete the row => count
--      back to 0. Insert a posts row with repost_of = P => deleting P
--      removes the repost (cascade).
--   4. Anon session: SELECT on post_reposts works; INSERT without auth.uid()
--      matching user_id is rejected.
-- ============================================================================


-- =============================================================================
-- SECTION 3/7 : 20260813_post_shares_and_gifts.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind share tracking + post gift statistics
--
-- WHY THIS EXISTS
-- ---------------
-- Sharing currently has no persistence: sharePost() builds text and calls
-- shareOrCopy(), and the outcome ('shared'|'copied'|'dismissed'|'failed') is
-- discarded. The engagement system needs per-post share counts, and post
-- cards need a way to show how many gifts a post has received (GiftPanel
-- records gifts via the already-applied send_gift SECURITY DEFINER RPC, whose
-- SQL is not in this repository).
--
-- DESIGN
-- ------
-- * `post_shares` is a best-effort tracking row: the client inserts it
--   fire-and-forget after a successful share (or a copy, which the brief
--   counts as sharing). A partial unique index on (post_id, user_id,
--   platform) makes repeat shares idempotent for logged-in users; anonymous
--   shares (user_id NULL) are allowed but not deduplicated (Postgres treats
--   NULLs as distinct in unique indexes). platform is a free label the client
--   chooses ('web', 'whatsapp', 'copy', …). RLS mirrors follows: public read,
--   self-or-anon write.
-- * `post_gift_stats(p_post_id)` is a defensive RPC rather than a view: the
--   live `gifts` table's exact column set can't be verified from this repo
--   (send_gift was applied directly), so it checks that the table and its
--   `post_id`/`coins` columns exist and falls back to zeros rather than
--   erroring on a schema it can't see. Returns (gift_count, total_coins).
--
-- SCOPE
-- -----
-- One table, one index, three policies, one RPC, one grant. Idempotent; run
-- once via the Supabase SQL editor.
-- ============================================================================

-- 1. Share tracking.
create table if not exists public.post_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  platform text,
  created_at timestamptz not null default now()
);

create unique index if not exists post_shares_user_post_platform_uniq
  on public.post_shares (post_id, user_id, platform);

create index if not exists post_shares_post_id_idx on public.post_shares (post_id);

alter table public.post_shares enable row level security;

drop policy if exists "post_shares publicly readable" on public.post_shares;
create policy "post_shares publicly readable"
  on public.post_shares for select using (true);

drop policy if exists "post_shares insertable by self or anon" on public.post_shares;
create policy "post_shares insertable by self or anon"
  on public.post_shares for insert
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "post_shares deletable by their own user" on public.post_shares;
create policy "post_shares deletable by their own user"
  on public.post_shares for delete using (user_id = auth.uid());

-- 2. Gift statistics per post — resilient to the live gifts schema.
create or replace function public.post_gift_stats(p_post_id uuid)
returns table (gift_count bigint, total_coins numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.gifts') is null then
    gift_count := 0; total_coins := 0;
    return next;
    return;
  end if;
  begin
    select count(*)::bigint, coalesce(sum(coins), 0)::numeric
      into gift_count, total_coins
      from public.gifts
     where post_id = p_post_id;
    return next;
  exception
    when undefined_column or undefined_table or syntax_error then
      -- gifts exists but doesn't carry post_id/coins as assumed; degrade to
      -- zeros rather than failing the whole card.
      gift_count := 0; total_coins := 0;
      return next;
  end;
end;
$$;

revoke execute on function public.post_gift_stats(uuid) from public, anon;
grant execute on function public.post_gift_stats(uuid) to authenticated;

-- 3. Batch gift statistics for a whole feed page in one round-trip, so the
--    card buttons get counts without one RPC per post. Same defensive
--    contract as post_gift_stats: empty result when gifts is absent or the
--    assumed columns don't exist.
create or replace function public.post_gift_stats_batch(p_post_ids uuid[])
returns table (post_id uuid, gift_count bigint, total_coins numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.gifts') is null then
    return;
  end if;
  begin
    return query
      select g.post_id, count(*)::bigint, coalesce(sum(g.coins), 0)::numeric
        from public.gifts g
       where g.post_id = any(p_post_ids)
       group by g.post_id;
    return;
  exception
    when undefined_column or undefined_table or syntax_error then
      return;
  end;
end;
$$;

revoke execute on function public.post_gift_stats_batch(uuid[]) from public, anon;
grant execute on function public.post_gift_stats_batch(uuid[]) to authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Table + policies exist (tablename = 'post_shares', three policies).
--   2. post_gift_stats responds for a real post id:
--        select * from public.post_gift_stats('<post-uuid>');
--      Returns gift_count/total_coins (0/0 when no gifts or no gifts table
--      columns matched) — never errors.
--   3. post_gift_stats_batch('{"<uuid>","<uuid>"}'::uuid[]) returns one row
--      per gifted post with its gift_count/total_coins.
--   4. Anon cannot call post_gift_stats or post_gift_stats_batch (42501);
--      authenticated can.
--   5. A second post_shares insert for the same (post, user, platform)
--      produces no extra row (unique index).
-- ============================================================================


-- =============================================================================
-- SECTION 4/7 : 20260813_post_view_events.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind post view events + aggregate view count
--
-- WHY THIS EXISTS
-- ---------------
-- View tracking today is only a counter: the client fire-and-forgets
-- increment_post_view (a live-DB RPC with no SQL in this repo), which bumps
-- posts.view_count directly. There is no event log, no session/device
-- identifier, and no guard against React re-renders double-counting a view.
-- This migration adds the append-only event table Feature Group D §7 calls
-- for, keeps posts.view_count as the fast-read aggregate, and makes the two
-- reconcileable (sum of events per post = its aggregate).
--
-- DESIGN
-- ------
-- * `post_view_events` is append-only: one row per qualifying view.
--   viewer_id is derived server-side (auth.uid()), never client-supplied;
--   anonymous views are recorded with viewer_id NULL. session_id identifies
--   the viewing session (the client sends one random id per app load).
-- * Idempotency: a partial-expression unique index on
--   (post_id, session_id, viewer_id-coalesced) means a repeated event for
--   the same post in the same session is a no-op — so a re-render or a
--   pull-to-refresh cannot inflate the count, while a genuinely new session
--   (new page load) still records a repeat view.
-- * The aggregate posts.view_count is maintained by a trigger on the event
--   table (same pattern as posts.repost_count), so there is exactly one
--   write path and the aggregate can be recomputed from the events.
-- * RLS: the table is publicly readable (so it can be reconciled) but has
--   NO direct INSERT policy — writes go exclusively through
--   record_post_view(), which is SECURITY DEFINER and pins viewer_id to the
--   caller's identity. The existing increment_post_view RPC stays in the
--   database but is no longer called by the app.
--
-- SCOPE
-- -----
-- One table, three indexes, two policies, one function, one trigger.
-- Idempotent; run once via the Supabase SQL editor.
-- ============================================================================

-- 1. Append-only view event table.
create table if not exists public.post_view_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_id uuid references public.profiles(id) on delete set null,
  session_id text,
  created_at timestamptz not null default now()
);

-- Per-post aggregate reads (count events grouped by post).
create index if not exists post_view_events_post_id_created_at_idx
  on public.post_view_events (post_id, created_at desc);

-- One event per (post, session, viewer): re-renders/refreshes in the same
-- session are no-ops, new sessions still count.
create unique index if not exists post_view_events_session_uniq
  on public.post_view_events (
    post_id,
    session_id,
    coalesce(viewer_id, '00000000-0000-0000-0000-000000000000')
  );

-- Reader-side lookups (e.g. "has this session seen this post") — optional
-- but cheap and matches the seen_posts pattern.
create index if not exists post_view_events_viewer_id_idx
  on public.post_view_events (viewer_id, created_at desc);

alter table public.post_view_events enable row level security;

-- Readable by everyone (reconciliation), writable by nobody directly.
drop policy if exists "post_view_events publicly readable" on public.post_view_events;
create policy "post_view_events publicly readable"
  on public.post_view_events for select using (true);

-- 2. The only write path: record a view and keep the aggregate in sync.
create or replace function public.record_post_view(p_post_id uuid, p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.post_view_events (post_id, viewer_id, session_id)
  values (p_post_id, auth.uid(), p_session_id)
  on conflict do nothing;
end;
$$;

revoke execute on function public.record_post_view(uuid, text) from public;
grant execute on function public.record_post_view(uuid, text) to anon, authenticated;

-- 3. Aggregate trigger: a real (non-deduped) view event bumps the counter.
create or replace function public.maintain_post_view_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.posts
     set view_count = view_count + 1
   where id = new.post_id;
  return new;
end;
$$;

drop trigger if exists trg_post_view_events_maintain_count on public.post_view_events;
create trigger trg_post_view_events_maintain_count
  after insert on public.post_view_events
  for each row execute function public.maintain_post_view_count();

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Table + policies exist (tablename = 'post_view_events', two policies).
--   2. record_post_view('<post-uuid>', 't1') returns null and
--      posts.view_count for that post increases by exactly 1.
--   3. record_post_view('<post-uuid>', 't1') again is a no-op (same session):
--      no new event row, no count increase.
--   4. record_post_view('<post-uuid>', 't2') adds one more row and count
--      (new session = repeat view counts).
--   5. select count(*) from public.post_view_events where post_id = '<post-uuid>'
--      equals the delta in posts.view_count for that post (reconciliation).
--   6. Anon (no session) can call record_post_view with session_id set; the
--      event row is written with viewer_id NULL and the count still bumps.
--   7. Direct INSERT into post_view_events without the RPC is denied (no
--      INSERT policy).
-- ============================================================================


-- =============================================================================
-- SECTION 5/7 : 20260813_feed_persistence.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind feed persistence: read receipts + per-user prefs
--
-- WHY THIS EXISTS
-- ---------------
-- The feed is fully recomputed client-side on every load (Feed.jsx loadFeed:
-- 50 newest posts, ranked by likes/comments/verified/recency), and nothing
-- about "what you have already seen" or "how you like your feed" is stored.
-- Two consequences:
--   1. Freshness has no memory. Every refresh re-ranks the same 50 posts and
--      a post you saw a second ago can outrank a genuinely new one; there is
--      no read-receipt concept anywhere in the schema.
--   2. Preferences are session-only. The active tab (For you / Following /
--      Questions / …) resets to "For you" every visit.
--
-- DESIGN
-- ------
-- * `feed_config` is a generic per-user key/value store (one row per
--   user+key) so feed preferences don't need a schema migration each time.
--   RLS: self-scoped, and only the owner can see their own row.
-- * `seen_posts` is a read receipt: (user_id, post_id) with a unique index,
--   so a user marks a post seen at most once. RLS: self-scoped.
-- * `read_posts_all(p_post_ids)` is a plain (invoker) RPC: it inserts one
--   seen_posts row per given post for auth.uid(), relying on the table's RLS
--   INSERT policy rather than a SECURITY DEFINER bypass. If any id in the
--   array is already seen, the ON CONFLICT DO NOTHING keeps it at its first
--   seen_at. PostgREST serializes a uuid[] argument as a Postgres array, so
--   the client calls it with an array of ids.
--
-- SCOPE
-- -----
-- Two tables, three indexes, three policies, one RPC, one grant. Idempotent;
-- run once via the Supabase SQL editor.
-- ============================================================================

-- 1. Per-user feed preferences.
create table if not exists public.feed_config (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  value text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.feed_config enable row level security;

drop policy if exists "feed_config visible to their own user" on public.feed_config;
create policy "feed_config visible to their own user"
  on public.feed_config for select using (user_id = auth.uid());

drop policy if exists "feed_config writable by their own user" on public.feed_config;
create policy "feed_config writable by their own user"
  on public.feed_config for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. Read receipts.
create table if not exists public.seen_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.seen_posts enable row level security;

drop policy if exists "seen_posts visible to their own user" on public.seen_posts;
create policy "seen_posts visible to their own user"
  on public.seen_posts for select using (user_id = auth.uid());

drop policy if exists "seen_posts insertable by their own user" on public.seen_posts;
create policy "seen_posts insertable by their own user"
  on public.seen_posts for insert with check (user_id = auth.uid());

-- 3. Mark a batch of posts as seen in one round-trip. Plain invoker: the
--    INSERT policy above is what authorises each row.
create or replace function public.read_posts_all(p_post_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.seen_posts (user_id, post_id)
  select auth.uid(), unnest(p_post_ids)
  on conflict (user_id, post_id) do nothing;
$$;

revoke execute on function public.read_posts_all(uuid[]) from public, anon;
grant execute on function public.read_posts_all(uuid[]) to authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Tables + policies exist:
--        select table_name from information_schema.tables
--        where table_name in ('feed_config','seen_posts');
--        select policyname, tablename from pg_policies
--        where tablename in ('feed_config','seen_posts');
--   2. read_posts_all('{"<uuid>","<uuid>"}'::uuid[]) run as a signed-in
--      session creates one seen_posts row per id and a second identical call
--      changes nothing (conflict ignored); anon is denied (42501).
--   3. A user cannot read or write another user's feed_config / seen_posts.
-- ============================================================================


-- =============================================================================
-- SECTION 6/7 : 20260813_follows_created_at.sql (source file, verbatim)
-- =============================================================================
-- 2026-08-13 — CareFind follows: add created_at for newest-first ordering.
--
-- The `follows` social-graph table never had a created_at column (the schema
-- reference lists only follower_id/following_id). FollowersSheet.jsx ordered
-- its list by created_at, so every list render failed with PostgREST 400
-- ("Could not load this list. Please try again."). This migration gives the
-- table a real created_at (backfilled to now(), which is the honest value for
-- rows created before tracking existed) so the ordering can work.
--
-- The app is defensive: FollowersSheet falls back to an unordered query when
-- this migration hasn't been applied, so this file and the app change ship
-- independently.

-- 1. Add the column (no-op when already present).
alter table public.follows
  add column if not exists created_at timestamptz;

-- 2. Backfill existing rows before the NOT NULL constraint lands.
update public.follows
   set created_at = now()
 where created_at is null;

-- 3. Make it defaulted and mandatory going forward.
alter table public.follows
  alter column created_at set default now(),
  alter column created_at set not null;

-- 4. Index for newest-first list reads (followers/following sheets).
create index if not exists follows_created_at_idx
  on public.follows (created_at desc);

-- ---------------------------------------------------------------------------
-- VERIFY AFTER APPLYING:
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'follows'
--      and column_name = 'created_at';
--   -- expect: is_nullable NO, column_default now()
--   select count(*) from public.follows where created_at is null; -- expect 0
--   -- and, via REST: GET /rest/v1/follows?select=following_id&order=created_at.desc
--   --   must return 200 (not PGRST204).
-- ---------------------------------------------------------------------------


-- =============================================================================
-- SECTION 7/7 : 20260813_follows_profiles_fks.sql (source file, verbatim)
-- =============================================================================
-- ============================================================================
-- 2026-08-13 — CareFind follows: real foreign keys from follows to profiles
--
-- WHY THIS EXISTS
-- ---------------
-- FollowersSheet.jsx lists a profile's followers/following with PostgREST
-- *embedded* joins:
--
--     follower_id, follower:follower_id(id, full_name, ...)
--     following_id, following:following_id(id, full_name, ...)
--
-- PostgREST can only resolve an embedded resource when the two tables are
-- linked by a real FOREIGN KEY. Schema-Reference-CareFind.md documents both
-- follows.follower_id and follows.following_id as "no FK constraint found …
-- referential integrity here is app-enforced only". Without a constraint,
-- every embedding fails, the request errors, and both profile sheets render
-- "Could not load this list. Please try again." on every profile. The reader
-- can see the counts (plain count queries still work) but never the list.
--
-- DESIGN
-- ------
-- * Orphan rows are deleted FIRST: the follower/following ids were never
--   enforced, so deleted auth users can leave dangling rows that would make
--   the FK's validation fail. Deleting them is safe — a follow whose subject
--   profile is gone is meaningless.
-- * Constraints are then added immediately (not NOT VALID): the cleanup ran
--   in the same migration, so there is nothing left to defer. A loud failure
--   at apply time is better than a silently skipped validate later.
-- * Indexes back the two embedding/where lookups the sheet and the profile
--   stat rows actually run (eq on following_id, eq on follower_id).
--
-- SCOPE
-- -----
-- Two foreign keys + two indexes. RLS is untouched (follows is already
-- correctly row-level-scoped, like the other social tables). Idempotent;
-- run once via the Supabase SQL editor.
-- ============================================================================

-- 1. Drop rows pointing at profiles that no longer exist (both directions).
--    Also self-follows are dropped: a follow of yourself is a UI mistake the
--    app already guards against, and it is the only shape that can survive
--    the FK while still being logically wrong.
delete from public.follows
 where follower_id not in (select id from public.profiles)
    or following_id not in (select id from public.profiles)
    or follower_id = following_id;

-- 2. The two foreign keys, guarded so re-running the migration is safe.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_follows_follower_profile') then
    alter table public.follows
      add constraint fk_follows_follower_profile
      foreign key (follower_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_follows_following_profile') then
    alter table public.follows
      add constraint fk_follows_following_profile
      foreign key (following_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- 3. Indexes so the sheet's lookups and the stat-row counts stay cheap.
create index if not exists follows_following_id_idx on public.follows (following_id);
create index if not exists follows_follower_id_idx on public.follows (follower_id);

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Constraints exist and ARE validated:
--        select conname, convalidated from pg_constraint
--        where conname like 'fk_follows_%';
--      Both rows: convalidated = true.
--   2. Embeddings resolve — GET on a profile with any followers:
--        /rest/v1/follows?select=follower_id,follower:id(id,full_name)&following_id=eq.<uuid>
--      returns rows with a nested `follower` object (no 400 "Could not find
--      relationship").
--   3. Profile → Followers / Following sheets in the app list people instead
--      of showing the error state.
-- ============================================================================

commit;

-- =============================================================================
-- VERIFY AFTER APPLYING (compact checklist — run these in the SQL editor)
-- =============================================================================
-- 1. Unique indexes present and no duplicates remain:
--      select indexname from pg_indexes
--       where indexname in ('post_reactions_user_post_uniq','saved_posts_user_post_uniq',
--                           'post_reposts_user_post_uniq','post_shares_user_post_platform_uniq',
--                           'post_view_events_session_uniq');
--      select post_id, user_id, count(*) from public.post_reactions group by 1,2 having count(*)>1; -- empty
--      select post_id, user_id, count(*) from public.saved_posts    group by 1,2 having count(*)>1; -- empty
-- 2. New tables + columns exist:
--      select table_name from information_schema.tables
--       where table_name in ('post_reposts','post_shares','post_view_events','feed_config','seen_posts');
--      select column_name from information_schema.columns
--       where table_name='posts' and column_name in ('repost_count','repost_of');
--      select column_name, is_nullable, column_default from information_schema.columns
--       where table_name='follows' and column_name='created_at'; -- NOT NULL, default now()
-- 3. FKs validated + embeddings resolve:
--      select conname, convalidated from pg_constraint where conname like 'fk_follows_%'; -- both true
--      GET /rest/v1/follows?select=follower_id,follower:id(id,full_name)&following_id=eq.<uuid> -- nested follower
-- 4. RLS policies:
--      select policyname, tablename from pg_policies
--       where tablename in ('post_reposts','post_shares','post_view_events','feed_config','seen_posts');
-- 5. Behavioural probes (best in a rolled-back block):
--      record_post_view('<post>','t1') -> posts.view_count +1; repeat same session -> no-op;
--      new session -> +1 again; count(*) of events equals the view_count delta.
--      insert a post_reposts row -> posts.repost_count = 1; second insert same pair -> unique violation;
--      delete -> count back to 0. Delete a source post -> its reposts cascade away.
--      read_posts_all('{...}'::uuid[]) twice -> one seen_posts row per id (conflict ignored).
--      Anon: SELECT post_reposts/post_shares/post_view_events works; INSERT without auth.uid() is rejected;
--      call post_gift_stats -> 42501; read/write another user's feed_config/seen_posts -> denied.
-- 6. REST smoke: GET /rest/v1/follows?select=following_id&order=created_at.desc -> 200 (not PGRST204).
-- =============================================================================
