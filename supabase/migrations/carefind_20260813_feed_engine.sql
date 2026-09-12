-- ============================================================================
-- 2026-08-13 — CareFind personalized feed engine: ranking weights + pools
--
-- WHY THIS EXISTS
-- ---------------
-- Phase 6 (Feature Group I) turns the For You tab's fixed heuristic (likes·3,
-- comments·5, verified·25, recency) into a real multi-signal ranking with
-- configurable weights and candidate pools. The engine lives client-side in
-- social-feed/feedEngine.js (pure functions, unit-tested), and this migration
-- provides the two tables it reads:
--   * feed_ranking_config        — per-signal weights + diversity caps. "For
--     You" is a weighted sum of normalized (0..1) signals: engagement,
--     recency, affinity, provider authority, location, medical relevance and
--     user interests. Relative weights, not required to sum to 100 (the
--     baseline mirrors the spec's emphasis: engagement 40, recency 20,
--     affinity 20, plus authority/location/medical/interests boosts).
--   * candidate_generation_pools — which pools exist (trending, following,
--     interests, similar_providers, nearby, fresh), whether each is enabled,
--     and how many posts each may contribute to the assembled feed.
--
-- SECURITY
-- --------
-- * Both tables are read-only tuning data (not user data): RLS grants SELECT
--   to everyone, no INSERT/UPDATE/DELETE policies, so only the service role
--   can change them directly.
-- * set_feed_ranking_config is a SECURITY DEFINER RPC that lets an operator
--   update the weights from AdminPanel. The ONLY authorization check is
--   `profiles.is_admin = true` for the calling auth.uid() — a normal user
--   gets `not_authorized`. This is a new admin gate (the profile column
--   already existed but was unused) and is intentionally NOT the same as the
--   admin_users/admin-auth.js system, which cannot be extended from this
--   repo (its handler is deployed separately).
--
-- SCOPE
-- -----
-- Two tables, two RLS policies, one admin RPC, one seed. Idempotent.
-- ============================================================================

-- 1. Ranking weights + diversity caps (single jsonb per row).
create table if not exists public.feed_ranking_config (
  id uuid not null default gen_random_uuid() primary key,
  key text not null unique,
  label text,
  description text,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.feed_ranking_config enable row level security;

drop policy if exists "feed_ranking_config readable by everyone" on public.feed_ranking_config;
create policy "feed_ranking_config readable by everyone"
  on public.feed_ranking_config for select using (true);

-- 2. Candidate pools (enabled + per-pool contribution limit).
create table if not exists public.candidate_generation_pools (
  id uuid not null default gen_random_uuid() primary key,
  pool text not null unique,
  label text,
  enabled boolean not null default true,
  priority integer not null default 100,
  limit_count integer not null default 25,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.candidate_generation_pools enable row level security;

drop policy if exists "candidate_generation_pools readable by everyone" on public.candidate_generation_pools;
create policy "candidate_generation_pools readable by everyone"
  on public.candidate_generation_pools for select using (true);

-- 3. Baseline weights — the spec's 40/20/20/10/10 emphasis plus the extra
--    signals AC-13 demands (authority, medical, interests). Tune freely.
insert into public.feed_ranking_config (key, label, description, value)
values (
  'weights',
  'Ranking weights',
  'Relative per-signal weights for the For You ranking. Each signal is normalized 0..1 before weighting; values are relative, not required to sum to 100.',
  '{"engagement":40,"recency":20,"affinity":20,"authority":15,"location":10,"medical":10,"interests":10}'::jsonb
), (
  'diversity',
  'Diversity caps',
  'Re-ranking caps so one author or one content type cannot dominate the For You feed.',
  '{"maxPerAuthor":3,"maxPerType":5}'::jsonb
)
on conflict (key) do nothing;

insert into public.candidate_generation_pools (pool, label, priority, limit_count, description)
values
  ('trending', 'Trending', 10, 25, 'Highest-engagement posts, recency-weighted.'),
  ('following', 'Following', 20, 25, 'Posts from people and businesses you follow.'),
  ('interests', 'Your interests', 30, 25, 'Posts whose theme/type/author-specialty you engage with.'),
  ('similar_providers', 'Similar providers', 40, 20, 'Verified professionals in your engaged specialties and regions.'),
  ('nearby', 'Nearby', 50, 20, 'Posts from authors and businesses in your region.'),
  ('fresh', 'Fresh', 60, 15, 'Newest posts regardless of score.')
on conflict (pool) do nothing;

-- 4. Admin-only tuner used by AdminPanel's Feed ranking card. SECURITY
--    DEFINER bypasses table RLS, so the is_admin gate is the whole story:
--    only a profile flagged is_admin can call it.
create or replace function public.set_feed_ranking_config(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if v_is_admin is distinct from true then
    raise exception 'not_authorized';
  end if;
  update public.feed_ranking_config
     set value = p_value, updated_at = now()
   where key = p_key;
  if not found then
    insert into public.feed_ranking_config (key, value, updated_at)
    values (p_key, p_value, now());
  end if;
end;
$$;

revoke execute on function public.set_feed_ranking_config(text, jsonb) from public, anon;
grant execute on function public.set_feed_ranking_config(text, jsonb) to authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Tables + seed:
--        select key, value from public.feed_ranking_config;
--        select pool, enabled, priority, limit_count from public.candidate_generation_pools;
--   2. RLS: signed-in user can SELECT both tables, but an UPDATE is denied
--      (no policy) unless done via set_feed_ranking_config.
--   3. set_feed_ranking_config('weights', '{"engagement":1}'::jsonb) as a
--      NON-admin uid raises not_authorized; as an is_admin=true profile it
--      updates the row. Reset with the seeded baseline afterwards.
-- ============================================================================
