-- Issue #8 (field report, 2026-08-21): reps must record WHERE they visited,
-- not just that they logged something. Three nullable additions to
-- field_activities:
--
--   place_of_visit  text     — free-text place name ("Lagos University
--                              Teaching Hospital"), typed or picked from a
--                              geocoder suggestion
--   place_coords    jsonb    — { lat, lng } of the resolved place, for the
--                              distance check against the row's GPS lat/lng
--   place_verified  boolean  — did the resolved place sit within tolerance of
--                              the captured GPS? Computed at log time; kept on
--                              the row so the feed never re-derives it.
--
-- Nullable / defaulted throughout: existing rows keep their meaning and old
-- app versions keep writing fine.
ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS place_of_visit text,
  ADD COLUMN IF NOT EXISTS place_coords jsonb,
  ADD COLUMN IF NOT EXISTS place_verified boolean NOT NULL DEFAULT false;
