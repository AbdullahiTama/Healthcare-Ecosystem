-- Issue #1 follow-up (audit item 4, 2026-08-23): record WHY a logged location
-- is not verified.
--
-- A facility the rep typed themselves is stored with the rep's own GPS as its
-- coordinates, so the distance check is circular — it returns 0 m and would
-- stamp "GPS verified" on a name nobody has checked. facilityVerification()
-- (lib/geo.js) now returns 'pending' for that case instead of a boolean.
--
-- The feed renders from the stored row, so it needs the same three states.
-- Deriving them from facility_source alone is wrong: once a manager confirms a
-- rep-added facility it becomes a normal cached entry, and a later visit logged
-- 180 m away is genuinely unverified, not pending. Hence an explicit column.
--
-- Additive and defaulted, so existing rows (none of which are rep-added) and
-- older app builds are unaffected.

ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS facility_pending_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.field_activities.facility_pending_review IS
  'True when the captured facility was added by the rep and no manager has confirmed it yet. Such a row can never be facility_verified: its coordinates are the rep''s own GPS fix, so distance proves nothing.';
