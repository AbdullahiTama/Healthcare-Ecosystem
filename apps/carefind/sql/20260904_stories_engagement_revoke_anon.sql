-- Supabase default privileges re-grant EXECUTE to anon when a function is
-- created, after the migration's own `revoke ... from public` has run.
-- get_story_viewers is owner-only (it checks auth.uid()), so anon could never
-- read anything, but a signed-out caller should not be able to call it at all.
revoke execute on function public.get_story_viewers(uuid) from anon;
