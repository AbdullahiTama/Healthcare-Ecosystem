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