-- ============================================================================
-- 2026-08-16 — CareFind news reposts: news_reposts reference table
--
-- WHY THIS EXISTS
-- ---------------
-- News articles already have real engagement — likes (news_reactions),
-- comments (news_comments), saves (saved_news) — but NO repost at all: there
-- is no news_reposts table, no repost_count column on `news`, and no repost
-- button in NewsArticle.jsx. The feed got the same treatment in
-- 20260813_post_reposts.sql (post_reposts + posts.repost_count). This brings
-- news to parity as a self-contained twin of that feature: one row per
-- (reposter, article) with a unique constraint so a double-tap is idempotent,
-- RLS in the same public-read / self-write shape, and a trigger-maintained
-- `news.repost_count` so the article page can show a count without joining
-- this table.
--
-- SCOPE
-- -----
-- News reposts are deliberately SIMPLER than the feed's classic repost: the
-- feed repost ALSO creates a real 🔁-prefixed posts row in the reposter's feed
-- (postDisplay.jsx convention). News lives in its own table and its own UI
-- (modules/news-publishing/NewsArticle.jsx), so a news repost is just the
-- reference row + the count — no cross-table feed write. The count and the
-- reference are the whole feature.
--
-- DESIGN
-- ------
-- * `news_reposts(news_id, user_id)` + a named unique constraint => at most
--   one repost per user per article.
-- * Cascading deletes: removing an article removes its reposts; removing a
--   profile removes their reposts. Unlike post_reposts (which points at
--   public.profiles), the news reference points at auth.users — matching the
--   rest of the news engagement tables' shape.
-- * RLS mirrors post_reposts: SELECT public (a repost is public social graph
--   data, exactly like a follow), INSERT/DELETE self-scoped.
-- * `repost_count` is maintained by a SECURITY INVOKER trigger function (per
--   this feature's spec — intentionally different from the feed's SECURITY
--   DEFINER, so the count write runs as the invoking user and is therefore
--   subject to `news` RLS; see VERIFY step 4).
--
-- APPLICATION
-- -----------
-- THIS FILE IS APPLIED TO THE LIVE DATABASE BY THE LEAD ENGINEER VIA MCP
-- AFTER THIS CODE LANDS. DO NOT APPLY IT BY HAND / FROM THE CLIENT.
-- ============================================================================

-- 1. The reference table.
create table if not exists public.news_reposts (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.news(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint news_reposts_news_user_uniq unique (news_id, user_id)
);

create index if not exists news_reposts_news_id_idx on public.news_reposts (news_id);
create index if not exists news_reposts_user_id_idx on public.news_reposts (user_id);

-- 2. Denormalized count on news, so the article page renders a count cheaply.
alter table public.news add column if not exists repost_count integer not null default 0;

-- 3. RLS in the post_reposts shape (public read, self write).
alter table public.news_reposts enable row level security;

drop policy if exists "news_reposts publicly readable" on public.news_reposts;
create policy "news_reposts publicly readable"
  on public.news_reposts for select using (true);

drop policy if exists "news_reposts insertable by their own user" on public.news_reposts;
create policy "news_reposts insertable by their own user"
  on public.news_reposts for insert with check (user_id = auth.uid());

drop policy if exists "news_reposts deletable by their own user" on public.news_reposts;
create policy "news_reposts deletable by their own user"
  on public.news_reposts for delete using (user_id = auth.uid());

-- 4. Trigger-maintained count. SECURITY DEFINER (the 20260813_post_reposts
--    feed pattern) — NOT SECURITY INVOKER as first drafted. Rationale: `news`
--    has no UPDATE RLS policy, so an INVOKER trigger's count update would run
--    as the reposting reader and be blocked by RLS (repost_count would never
--    move). The feed twin maintain_post_repost_count is prosecdef = true;
--    the client never updates repost_count directly. The guard on the delete
--    leg keeps a NULL news_id (defensive) from ever producing a bogus
--    decrement. Live-applied 2026-08-16 and verified behaviorally (0→1→0,
--    duplicate rejected, zero residue).
create or replace function public.maintain_news_repost_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if tg_op = 'INSERT' then
    update public.news set repost_count = repost_count + 1 where id = new.news_id;
    return new;
  elsif tg_op = 'DELETE' then
    if old.news_id is not null then
      update public.news set repost_count = greatest(repost_count - 1, 0) where id = old.news_id;
    end if;
    return old;
  end if;
  return null;
end;
$func$;

drop trigger if exists trg_maintain_news_repost_count on public.news_reposts;
create trigger trg_maintain_news_repost_count
  after insert or delete on public.news_reposts
  for each row execute function public.maintain_news_repost_count();

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Table + index + column exist:
--        select table_name from information_schema.tables
--        where table_name = 'news_reposts';
--        select column_name from information_schema.columns
--        where table_name = 'news' and column_name = 'repost_count';
--   2. RLS policies:
--        select policyname from pg_policies where tablename = 'news_reposts';
--      (publicly readable / insertable by their own user / deletable by
--      their own user).
--   3. Behavioural probe (owner session, rolled-back block): insert a
--      news_reposts row for user A on article N => news.repost_count for N
--      becomes 1; a second insert for the same pair => unique violation (or 0
--      rows with ON CONFLICT DO NOTHING); delete the row => count back to 0.
--   4. SECURITY DEFINER implication (RESOLVED 2026-08-16): the count update
--      runs as the function owner, bypassing `news` RLS — which is required
--      because `news` has no UPDATE policy. Confirmed the feed twin uses the
--      same pattern (prosecdef = true). The client never updates repost_count
--      directly.
--   5. Anon session: SELECT on news_reposts works; INSERT without auth.uid()
--      matching user_id is rejected.
-- ============================================================================