-- #7 Feed search: a generated tsvector so post content (and the author/business
-- name a post was posted as) is indexed for full-text search, plus a GIN index.
-- Generated + STORED keeps it correct on every insert/update with no trigger.

alter table public.posts
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(content, '') || ' ' || coalesce(posted_as_name, ''))
  ) stored;

create index if not exists posts_search_vector_idx
  on public.posts using gin(search_vector);
