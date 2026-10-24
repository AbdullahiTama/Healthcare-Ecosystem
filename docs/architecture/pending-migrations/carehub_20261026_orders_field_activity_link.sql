-- carehub_20261026_orders_field_activity_link  (DRAFT, not applied)
--
-- An order can remember the field visit it came from (field team reorganisation: "start an order from the
-- visit", the owner's choice). The rep raises it from their report; the report shows the orders it produced.
--
--   * adds public.orders.field_activity_id uuid NULL, referencing field_activities(id) ON DELETE SET NULL, with a
--     partial index. Existing orders keep NULL; an order without a visit stays allowed.
--   * a BEFORE INSERT / UPDATE OF field_activity_id trigger refuses (42501) a link to a report that is not of the
--     order's own company OR that the caller cannot see. It runs as the caller (SECURITY INVOKER), so the lookup
--     goes through the caller's own row level security on field_activities: nobody links an order to a report
--     they are not allowed to read.
--
-- Order against the app does not matter: the app sends field_activity_id only when it is raising an order from a
-- visit, and drops it when the server reports the column is unknown.
--
-- Rollback: DROP TRIGGER orders_check_field_activity ON public.orders; DROP FUNCTION public.orders_check_field_activity();
--           ALTER TABLE public.orders DROP COLUMN field_activity_id;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS field_activity_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_field_activity_id_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_field_activity_id_fkey
      FOREIGN KEY (field_activity_id) REFERENCES public.field_activities(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_field_activity_id_idx ON public.orders (field_activity_id) WHERE field_activity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.orders_check_field_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.field_activity_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.field_activity_id IS NOT DISTINCT FROM OLD.field_activity_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.field_activities a
     WHERE a.id = NEW.field_activity_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'An order can only be linked to a field report of the same company that you can see'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_check_field_activity ON public.orders;
CREATE TRIGGER orders_check_field_activity
  BEFORE INSERT OR UPDATE OF field_activity_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_check_field_activity();

-- Trigger functions are not meant to be called: remove the default EXECUTE grants Supabase adds.
REVOKE ALL ON FUNCTION public.orders_check_field_activity() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'field_activity_id'
  ) THEN
    RAISE EXCEPTION 'orders.field_activity_id is missing';
  END IF;
  IF has_function_privilege('anon', 'public.orders_check_field_activity()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.orders_check_field_activity()', 'EXECUTE') THEN
    RAISE EXCEPTION 'orders_check_field_activity must not be callable directly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_check_field_activity' AND tgrelid = 'public.orders'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'orders_check_field_activity trigger is missing';
  END IF;
END $$;
