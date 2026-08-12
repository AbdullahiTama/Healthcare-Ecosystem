-- #4 Stories: deterministic ordering via an explicit position field.
-- Stories currently rely on view_count for ordering, which is fragile.
-- Add a `position` column (lower = earlier in the row) and backfill
-- platform stories to lead. User stories keep null (sorts last), so the
-- existing "by views" behaviour is preserved for them.

alter table public.stories
  add column if not exists position integer;

update public.stories
  set position = 0
  where is_platform = true and position is null;

create index if not exists stories_position_idx
  on public.stories (position asc nulls last, view_count desc, created_at desc)
  where expires_at > now();
