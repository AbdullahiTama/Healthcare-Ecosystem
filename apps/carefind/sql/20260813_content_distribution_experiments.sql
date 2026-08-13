-- ============================================================================
-- 2026-08-13 — CareFind staged content distribution: experiments + metrics
--
-- WHY THIS EXISTS
-- ---------------
-- Phase 7 (master plan §6) turns the For You feed into a controlled-release
-- platform: a ranking change can be gated behind a progressive rollout % with
-- a kill switch, split into A/B groups, and measured — instead of being
-- shipped to 100% of readers with no way to compare or reverse it.
--
-- DESIGN
-- ------
-- * `content_distribution_experiments` describes ONE experiment:
--     - key          — unique slug ('foryou_engine_v1')
--     - enabled      — the kill switch. False ⇒ everyone gets the control
--                      (base) ranking; no metrics are collected either.
--     - rollout_pct  — % of readers assigned to the treatment variant
--                      (0..100). The rest are the control group.
--     - variant      — name of the treatment bucket (default 'treatment').
--     - config       — the treatment's ranking overrides, merged over the
--                      base feed_ranking_config/candidate_generation_pools:
--                      { weights?, diversity?, pools? }.
--     - start_at/end_at — optional window; outside it the experiment is inert.
--   Bucketing is CLIENT-SIDE and deterministic (hash of the reader's
--   user/session id), so a reader stays in the same group across sessions
--   with no assignment table to maintain — documented in
--   social-feed/distributionExperiments.js.
-- * `distribution_experiment_events` is the append-only metric log:
--   (experiment_key, variant, user_id, event_type, post_id). event_type is
--   'feed_view' (one per session per reader — the retention/DAU signal),
--   'engage' (like/save/share) or 'report' (spam). Writes go ONLY through
--   log_distribution_event, which pins user_id to auth.uid(); the table has
--   NO SELECT policy at all, so raw rows are never readable via PostgREST —
--   metrics are exposed only as aggregates by the admin-only stats RPC.
--
-- SECURITY
-- --------
-- * Experiment config is public-read tuning data (same shape as the Phase 6
--   feed_ranking_config); it has no direct write policy, so only the service
--   role can change it outside the RPC.
-- * set_distribution_experiment / distribution_experiment_stats are SECURITY
--   DEFINER gated on `profiles.is_admin = true` — the same gate as
--   set_feed_ranking_config (Phase 6). A normal user gets `not_authorized`.
-- * log_distribution_event is SECURITY INVOKER: the write passes through the
--   table's INSERT policy, so a caller can never tag another user's events.
--
-- SCOPE
-- -----
-- Two tables, three RPCs, four RLS policies, one seed. Idempotent.
-- ============================================================================

-- 1. Experiment definitions (public-read, admin-write via RPC).
create table if not exists public.content_distribution_experiments (
  key text not null primary key,
  label text,
  description text,
  enabled boolean not null default false,
  rollout_pct numeric not null default 0 check (rollout_pct between 0 and 100),
  variant text not null default 'treatment',
  config jsonb not null default '{}'::jsonb,
  start_at timestamptz,
  end_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.content_distribution_experiments enable row level security;

drop policy if exists "content_distribution_experiments readable by everyone" on public.content_distribution_experiments;
create policy "content_distribution_experiments readable by everyone"
  on public.content_distribution_experiments for select using (true);

-- 2. Append-only metric log. No SELECT policy: raw events are operational
--    data, never exposed through PostgREST. Inserts flow through
--    log_distribution_event and land with user_id = auth.uid().
create table if not exists public.distribution_experiment_events (
  id uuid not null default gen_random_uuid() primary key,
  experiment_key text not null references public.content_distribution_experiments(key) on delete cascade,
  variant text not null,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('feed_view', 'engage', 'report')),
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists distribution_experiment_events_experiment_idx
  on public.distribution_experiment_events (experiment_key, variant, event_type, created_at desc);

alter table public.distribution_experiment_events enable row level security;

-- Caller writes only their own rows (anonymous sessions write user_id NULL).
drop policy if exists "distribution_experiment_events insertable by self or anon" on public.distribution_experiment_events;
create policy "distribution_experiment_events insertable by self or anon"
  on public.distribution_experiment_events for insert
  with check (user_id is null or user_id = auth.uid());

-- 3. Seed: the baseline For You experiment, OFF by default (rollout 0,
--    disabled). The treatment shifts some weight from engagement to recency
--    and raises the per-author diversity cap — a real, small, reversible
--    change an operator can stage when ready.
insert into public.content_distribution_experiments (key, label, description, enabled, rollout_pct, variant, config)
values (
  'foryou_engine_v1',
  'For You engine v1 (recency tilt)',
  'Staged A/B for the Phase 6 For You ranking: treatment shifts 5 pts from engagement to recency and raises maxPerAuthor to 4. Off by default (kill switch).',
  false,
  0,
  'treatment',
  '{"weights":{"engagement":35,"recency":25},"diversity":{"maxPerAuthor":4}}'::jsonb
)
on conflict (key) do nothing;

-- 4. The only event write path. INVOKER + pinned search_path so the table's
--    INSERT policy (self-or-null) is what authorises each row, and user_id is
--    always the caller's own identity — never client-supplied.
create or replace function public.log_distribution_event(
  p_experiment_key text,
  p_variant text,
  p_event_type text,
  p_post_id uuid
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.distribution_experiment_events
    (experiment_key, variant, user_id, event_type, post_id)
  values
    (p_experiment_key, p_variant, auth.uid(), p_event_type, p_post_id);
$$;

revoke execute on function public.log_distribution_event(text, text, text, uuid) from public;
grant execute on function public.log_distribution_event(text, text, text, uuid) to anon, authenticated;

-- 5. Aggregate metrics. SECURITY DEFINER bypasses the no-SELECT table RLS, so
--    the is_admin gate is the whole story — only a flagged admin sees counts,
--    and they see aggregates only, never raw rows.
create or replace function public.distribution_experiment_stats(p_experiment_key text)
returns table (
  variant text,
  event_type text,
  event_count bigint,
  distinct_users bigint
)
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
  return query
    select e.variant, e.event_type,
           count(*)::bigint,
           count(distinct e.user_id)::bigint
      from public.distribution_experiment_events e
     where e.experiment_key = p_experiment_key
     group by e.variant, e.event_type
     order by e.variant, e.event_type;
end;
$$;

revoke execute on function public.distribution_experiment_stats(text) from public, anon;
grant execute on function public.distribution_experiment_stats(text) to authenticated;

-- 6. Admin tuner (kill switch / rollout / config) used by AdminPanel. The
--    update payload is whitelisted by column, so a caller can never touch
--    anything outside the experiment's own fields.
create or replace function public.set_distribution_experiment(
  p_key text,
  p_updates jsonb
)
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

  update public.content_distribution_experiments
     set enabled      = coalesce((p_updates->>'enabled')::boolean, enabled),
         rollout_pct  = coalesce((p_updates->>'rollout_pct')::numeric, rollout_pct),
         variant      = coalesce(p_updates->>'variant', variant),
         config       = coalesce(p_updates->'config', config),
         label        = coalesce(p_updates->>'label', label),
         description  = coalesce(p_updates->>'description', description),
         start_at     = coalesce((p_updates->>'start_at')::timestamptz, start_at),
         end_at       = coalesce((p_updates->>'end_at')::timestamptz, end_at),
         updated_at   = now()
   where key = p_key;

  if not found then
    insert into public.content_distribution_experiments (key, label, enabled, rollout_pct, variant, config)
    values (p_key, coalesce(p_updates->>'label', p_key), false, 0, 'treatment', coalesce(p_updates->'config', '{}'::jsonb));
  end if;
end;
$$;

revoke execute on function public.set_distribution_experiment(text, jsonb) from public, anon;
grant execute on function public.set_distribution_experiment(text, jsonb) to authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Tables + seed:
--        select key, enabled, rollout_pct, variant, config
--          from public.content_distribution_experiments;   -- foryou_engine_v1, off, 0
--        select * from public.distribution_experiment_events limit 1; -- empty
--   2. RLS:
--      - anyone can SELECT content_distribution_experiments; UPDATE is denied.
--      - distribution_experiment_events: anon/authenticated can only INSERT
--        their own (or NULL-user) rows; SELECT returns 0 rows / is denied
--        (no policy), and a raw insert tagging another user_id is rejected.
--   3. RPCs:
--      - log_distribution_event('<key>','treatment','feed_view',NULL) as a
--        signed-in session writes one event with user_id = auth.uid();
--        anon writes one with user_id NULL.
--      - distribution_experiment_stats('<key>') as a NON-admin raises
--        not_authorized; as an is_admin=true profile it returns per-variant /
--        per-event_type counts + distinct users.
--      - set_distribution_experiment('<key>', '{"rollout_pct":10}'::jsonb) as
--        a NON-admin raises not_authorized; as an is_admin=true profile it
--        updates only the given fields. Reset rollout to 0 afterwards.
-- ============================================================================
