-- carehub_20261026_orders_read_scope  (DRAFT, HELD: needs an owner decision before it is applied)
--
-- Narrows who READS orders, as the field team design asks: a field manager or the owner reads every order of the
-- company; anyone else reads only orders they raised, are tagged to approve, or are copied on (order_watchers).
-- Order lines, files, events and watchers follow the visibility of their order.
--
-- WHY IT IS HELD. Warehouse staff move approved orders through processing, dispatch and delivery. Today they see
-- every order. After this, a warehouse operator who is neither tagged, copied, nor a field manager sees none, and
-- the database cannot recognise warehouse staff by role (preset roles exist only in the app). Before applying,
-- the owner decides one of:
--   (a) warehouse staff get "Manage field team" (or a manager role), so they keep seeing every order; or
--   (b) the read rule gains a warehouse path (needs a database-visible marker for warehouse staff); or
--   (c) reading stays as it is and only carehub_20261026_orders_authorisation is applied.
--
-- Rollback: drop the five "... read scope" policies and public.is_order_watcher(uuid).

-- True when the caller is copied on the order. SECURITY DEFINER so the orders policy can ask about order_watchers
-- without the two tables' policies recursing (order_watchers' own policy reads orders).
CREATE OR REPLACE FUNCTION public.is_order_watcher(oid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_watchers w
      JOIN public.orders o ON o.id = w.order_id
     WHERE w.order_id = oid AND w.staff_id = public.caller_staff_id(o.business_id)
  )
$$;
REVOKE ALL ON FUNCTION public.is_order_watcher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_order_watcher(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "orders read scope" ON public.orders;
CREATE POLICY "orders read scope" ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_sees_all_activity(business_id)
    OR (created_by_staff_id IS NOT NULL AND created_by_staff_id = public.caller_staff_id(business_id))
    OR (approver_staff_id IS NOT NULL AND approver_staff_id = public.caller_staff_id(business_id))
    OR public.is_order_watcher(id)
  );

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_items', 'order_files', 'order_events', 'order_watchers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' read scope', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (order_id IN (SELECT id FROM public.orders))', t || ' read scope', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  IF has_function_privilege('anon', 'public.is_order_watcher(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_order_watcher must not be executable by anon';
  END IF;
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_files', 'order_events', 'order_watchers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' read scope' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'the read scope policy on % is missing', t;
    END IF;
  END LOOP;
END $$;
