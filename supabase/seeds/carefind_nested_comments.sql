-- Nested / threaded comments
-- Adds parent_id support to post_comments and news_comments

alter table post_comments
  add column if not exists parent_id uuid references post_comments(id) on delete cascade;

alter table news_comments
  add column if not exists parent_id uuid references news_comments(id) on delete cascade;

create index if not exists idx_post_comments_parent on post_comments(parent_id);
create index if not exists idx_news_comments_parent on news_comments(parent_id);
