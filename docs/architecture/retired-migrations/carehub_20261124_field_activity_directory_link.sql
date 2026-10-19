-- Optional, rep-confirmed link from a field activity to a directory business
-- (Phase 7). PREPARED, NOT APPLIED. Tested on PGlite (scripts/db-tests/activity.pglite.mjs).
-- Depends on carehub_20261120_business_directory.sql.
--
-- Rules
--  * Nothing links automatically. Searching, viewing, GPS proximity and opening a
--    profile never write here. The column is only ever set by a rep who picked a
--    suggestion while logging a report, and the app sends business_link_confirmed
--    = true with it. The database cannot prove a person clicked; it can make an
--    unconfirmed link impossible to store and keep a server-side snapshot.
--  * Additive and nullable. Existing rows and older app builds are unaffected.
--  * The business name is copied from the directory by a trigger, so the report
--    keeps what the rep saw even if the directory record is edited later, and the
--    client cannot invent a name for an id.
--  * The link is to a record the caller can read (RLS runs for the invoker), so a
--    rep cannot attach an inactive or hidden directory row.
--
-- Rollback: ALTER TABLE public.field_activities DROP CONSTRAINT field_activities_link_needs_confirmation,
--   DROP COLUMN directory_business_id, DROP COLUMN directory_business_name, DROP COLUMN business_link_confirmed;
--   DROP FUNCTION public.field_activities_directory_link();

ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS directory_business_id uuid REFERENCES public.directory_businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS directory_business_name text,
  ADD COLUMN IF NOT EXISTS business_link_confirmed boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_activities_link_needs_confirmation') THEN
    ALTER TABLE public.field_activities
      ADD CONSTRAINT field_activities_link_needs_confirmation
      CHECK (directory_business_id IS NULL OR business_link_confirmed);
  END IF;
END $$;

COMMENT ON COLUMN public.field_activities.directory_business_id IS
  'Directory business the rep explicitly selected for this report. Never set automatically from search results or GPS proximity.';

CREATE OR REPLACE FUNCTION public.field_activities_directory_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE v_name text;
BEGIN
  IF NEW.directory_business_id IS NULL THEN
    NEW.directory_business_name := NULL;
    NEW.business_link_confirmed := false;
    RETURN NEW;
  END IF;
  SELECT d.name INTO v_name FROM public.directory_businesses d
   WHERE d.id = NEW.directory_business_id AND d.is_active;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'That directory business is not available' USING ERRCODE = '22023';
  END IF;
  NEW.directory_business_name := v_name;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS field_activities_directory_link ON public.field_activities;
CREATE TRIGGER field_activities_directory_link BEFORE INSERT ON public.field_activities
  FOR EACH ROW EXECUTE FUNCTION public.field_activities_directory_link();
