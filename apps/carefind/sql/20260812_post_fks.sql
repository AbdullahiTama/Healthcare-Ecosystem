-- #10b Feed integrity: every interaction table should point at posts(id) with
-- a real foreign key so deleting a post can't leave orphan rows. Authored from
-- the column names the app already queries (post_comments.post_id,
-- post_reposts.post_id, saved_posts.post_id, post_reactions.post_id). Wrapped
-- in DO blocks so re-running the migration is safe.

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
  if not exists (select 1 from pg_constraint where conname = 'fk_post_reposts_post') then
    alter table public.post_reposts
      add constraint fk_post_reposts_post
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

-- Indexes so the cascade + per-post lookups stay cheap.
create index if not exists post_comments_post_id_idx on public.post_comments (post_id);
create index if not exists post_reposts_post_id_idx on public.post_reposts (post_id);
create index if not exists saved_posts_post_id_idx on public.saved_posts (post_id);
create index if not exists post_reactions_post_id_idx on public.post_reactions (post_id);
