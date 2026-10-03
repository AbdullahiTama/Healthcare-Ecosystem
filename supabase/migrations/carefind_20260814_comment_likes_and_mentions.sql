-- ============================================================================
-- 2026-08-14 — Feature 9: comment likes + @mentions
--
-- WHY THIS EXISTS
-- ---------------
-- Feature 9 verification found replies fully implemented (parent_id nesting,
-- reply notifications) but no way to like a comment and no @mention support:
-- the `mention` notification type existed in notify.js but was never fired,
-- and the notifications UI had no icon for it.
--
-- DESIGN
-- ------
-- 1. post_comment_likes — mirrors the post_reactions table + RLS pattern
--    exactly: a row per (comment_id, user_id), unique so a fast double-tap
--    resolves via the unique index (same conflict-resolution approach the
--    feed uses for post likes), FK cascade on comment delete. RLS: anyone can
--    read; a logged-in user can insert a row with their own user_id; a user
--    can delete their own rows.
-- 2. post_comments.mentions — a jsonb array of { username, user_id } captured
--    at insert time so the UI can render @mentions as profile links without
--    re-resolving on every render. Defaults to '[]' so existing rows are fine.
-- ============================================================================

create table if not exists public.post_comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists post_comment_likes_comment_user_uniq
  on public.post_comment_likes (comment_id, user_id);

create index if not exists idx_post_comment_likes_comment
  on public.post_comment_likes (comment_id);

alter table public.post_comment_likes enable row level security;

drop policy if exists "Anyone can read comment likes" on public.post_comment_likes;
create policy "Anyone can read comment likes"
  on public.post_comment_likes for select
  using (true);

drop policy if exists "Logged in users can like comments" on public.post_comment_likes;
create policy "Logged in users can like comments"
  on public.post_comment_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own comment like" on public.post_comment_likes;
create policy "Users can remove their own comment like"
  on public.post_comment_likes for delete
  using (auth.uid() = user_id);

alter table public.post_comments
  add column if not exists mentions jsonb not null default '[]';

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. post_comment_likes exists with unique index on (comment_id, user_id)
--      and the three policies above; RLS enabled (relrowsecurity = true).
--   2. post_comments has a mentions jsonb column (default '[]').
--   3. An insert with someone else's user_id is rejected (42501); a self-row
--      insert succeeds; deleting another user's like is rejected.
-- ============================================================================