-- Live shows lifecycle: allow owner to delete their own scheduled shows
-- Implements spec-carefind-scheduled-live-manageable requirement:
-- owner Manage/Edit for own live_shows where status=scheduled: cancel/delete
-- Keep SELECT true (public), UPDATE host_id=auth.uid() existing policies.

-- Ensure RLS stays enabled (idempotent)
alter table public.live_shows enable row level security;

drop policy if exists "live_shows deletable by their host when scheduled" on public.live_shows;

create policy "live_shows deletable by their host when scheduled"
  on public.live_shows
  for delete
  using (host_id = auth.uid() and status = 'scheduled');
