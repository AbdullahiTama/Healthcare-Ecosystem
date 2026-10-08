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