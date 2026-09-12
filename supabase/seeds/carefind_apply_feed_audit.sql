-- =============================================================================
-- CareFind feed audit — combined migration
-- Run this whole file in the Supabase SQL Editor (or `supabase db execute`).
-- Every statement is idempotent (IF NOT EXISTS / DO-block guards) so re-running
-- it is safe. Schema was validated against the live project before writing.
-- Order is not significant; all three changes are independent.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- #4 Stories: deterministic ordering via an explicit `position` field.
-- Platform stories lead (position 0); user stories keep NULL (sort last),
-- preserving the existing "by views" behaviour for them.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stories' and column_name = 'position'
  ) then
    alter table public.stories add column "position" integer;
  end if;
end $$;

update public.stories
  set "position" = 0
  where is_platform = true and "position" is null;

create index if not exists stories_position_idx
  on public.stories ("position" asc nulls last, view_count desc, created_at desc);

-- -----------------------------------------------------------------------------
-- #7 Feed search: generated tsvector over content + posted_as_name, with a
-- GIN index. Generated + STORED keeps it correct on every insert/update.
-- -----------------------------------------------------------------------------
alter table public.posts
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(content, '') || ' ' || coalesce(posted_as_name, ''))
  ) stored;

create index if not exists posts_search_vector_idx
  on public.posts using gin(search_vector);

-- -----------------------------------------------------------------------------
-- #10b Feed integrity: real FKs from the interaction tables to posts(id),
-- cascading delete so a removed post can't leave orphans.
-- NOTE: there is no post_reposts table — reposts are posts rows marked with
-- REPOST_MARK (postDisplay.jsx) — so no FK is added for it.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_post_comments_post') then
    alter table public.post_comments
      add constraint fk_post_comments_post
      foreign key (post_id) references public.posts(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_saved_posts_post') then
    alter table public.saved_posts
      add constraint fk_saved_posts_post
      foreign key (post_id) references public.posts(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_post_reactions_post') then
    alter table public.post_reactions
      add constraint fk_post_reactions_post
      foreign key (post_id) references public.posts(id) on delete cascade;
  end if;
end $$;

create index if not exists post_comments_post_id_idx on public.post_comments (post_id);
create index if not exists saved_posts_post_id_idx on public.saved_posts (post_id);
create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id);

commit;
