-- Stories engagement: Like/Comment/Share/Gift for stories
-- Mirrors post_reactions/post_comments pattern, with expiry guard

-- story_reactions: one like per user per story
create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'like' check (type in ('like')),
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_reactions_story_idx on public.story_reactions(story_id);
create index if not exists story_reactions_user_idx on public.story_reactions(user_id);

-- story_comments: threaded comments on stories
create table if not exists public.story_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.story_comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists story_comments_story_idx on public.story_comments(story_id, created_at);
create index if not exists story_comments_parent_idx on public.story_comments(parent_id);

-- RLS
alter table public.story_reactions enable row level security;
alter table public.story_comments enable row level security;

-- story_reactions policies
drop policy if exists "story_reactions public read" on public.story_reactions;
create policy "story_reactions public read" on public.story_reactions for select using (true);
drop policy if exists "story_reactions self insert" on public.story_reactions;
create policy "story_reactions self insert" on public.story_reactions for insert with check (
  user_id = auth.uid() and exists (select 1 from public.stories where id = story_id and expires_at > now())
);
drop policy if exists "story_reactions self delete" on public.story_reactions;
create policy "story_reactions self delete" on public.story_reactions for delete using (user_id = auth.uid());

-- story_comments policies
drop policy if exists "story_comments public read" on public.story_comments;
create policy "story_comments public read" on public.story_comments for select using (true);
drop policy if exists "story_comments self insert" on public.story_comments;
create policy "story_comments self insert" on public.story_comments for insert with check (
  user_id = auth.uid() and exists (select 1 from public.stories where id = story_id and expires_at > now())
);
drop policy if exists "story_comments self delete" on public.story_comments;
create policy "story_comments self delete" on public.story_comments for delete using (user_id = auth.uid());
drop policy if exists "story_comments owner delete" on public.story_comments;
create policy "story_comments owner delete" on public.story_comments for delete using (
  exists (select 1 from public.stories where stories.id = story_id and stories.user_id = auth.uid())
);

-- get_story_viewers RPC: owner-only
create or replace function public.get_story_viewers(p_story_id uuid)
returns table (user_id uuid, full_name text, display_name text, avatar_url text, viewed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only owner can see who viewed
  if not exists (select 1 from public.stories where id = p_story_id and user_id = auth.uid()) then
    raise exception 'Only the owner can see viewers' using errcode = '42501';
  end if;
  return query
    select sv.user_id, p.full_name, p.display_name, p.avatar_url, sv.viewed_at
    from public.story_views sv
    join public.profiles p on p.id = sv.user_id
    where sv.story_id = p_story_id
    order by sv.viewed_at desc
    limit 100;
end;
$$;
revoke all on function public.get_story_viewers(uuid) from public;
grant execute on function public.get_story_viewers(uuid) to authenticated;
