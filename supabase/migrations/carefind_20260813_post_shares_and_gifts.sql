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