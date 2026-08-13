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
