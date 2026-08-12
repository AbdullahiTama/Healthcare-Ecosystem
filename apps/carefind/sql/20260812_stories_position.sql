-- #4 Stories: deterministic ordering via an explicit position field.
-- Stories currently rely on view_count for ordering, which is fragile.
-- Add a `position` column (lower = earlier in the row) and backfill
-- platform stories to lead. User stories keep null (sorts last), so the
-- existing "by views" behaviour is preserved for them.
--
-- Hardened: the column is quoted ("position") so no client parses it as a
-- keyword, and it's added inside a DO block so re-running never errors even
-- if the column already exists with a different definition.

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
  on public.stories ("position" asc nulls last, view_count desc, created_at desc)
  where expires_at > now();
