-- carehub_20261026_orders_authorisation  (DRAFT, not applied)
--
-- Found 2026-10-23 while designing the field team reorganisation: public.orders has one permissive policy, FOR ALL to
-- every member of the company. So any member can approve their own order, delete anyone's order, raise an order in a
-- colleague's name, or create one that is already approved. "Only the tagged approver or the owner may approve" was
-- enforced only in the browser. Each is proven on a replica of the live policy (scripts/db-tests/orders.pglite.mjs).
--
-- What this enforces, in the database, for signed-in callers:
--   * a new order starts as 'submitted', and is raised in the caller's own name (a staff member: their staff id;
--     the owner: no staff id);
--   * status follows the pipeline: submitted -> approved | rejected; approved -> processing -> dispatched ->
--     delivered. Anything else is refused (22023);
--   * approve or reject: only the tagged approver, the owner or a platform admin; never the person who raised it
--     (unless they are the owner);
--   * later stages (processing, dispatched, delivered): anyone in the company EXCEPT the person who raised it, so a
--     rep cannot mark their own order delivered (unless owner or platform admin);
--   * who raised it and which company it belongs to never change; the approver is re-tagged only by the owner, a
--     field manager (caller_sees_all_activity) or a platform admin;
--   * no signed-in caller deletes an order or any of its lines, files, events or watchers: a mistake is rejected,
--     not erased (order_events already records every change).
-- Reading is NOT changed here: see carehub_20261026_orders_read_scope.sql (held for an owner decision).
--
-- Server-side work (service role, migrations) is not a signed-in caller and is not blocked.
--
-- Rollback: DROP TRIGGER orders_guard ON public.orders; DROP FUNCTION public.orders_guard(), public.orders_caller_is_owner(uuid);
--           drop the five "... no delete" policies.

-- Is the caller the owner of this business (signs in with the business email)? SECURITY DEFINER so the guard can
-- ask without reading businesses under the caller's own policies.
CREATE OR REPLACE FUNCTION public.orders_caller_is_owner(bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bid AND lower(b.email) = lower(auth.email()))
$$;
REVOKE ALL ON FUNCTION public.orders_caller_is_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orders_caller_is_owner(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.orders_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_staff uuid;
  v_owner boolean;
  v_admin boolean;
BEGIN
  -- Only signed-in callers are checked; the service role and migrations are not.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;

  v_staff := public.caller_staff_id(NEW.business_id);
  v_owner := public.orders_caller_is_owner(NEW.business_id);
  v_admin := public.is_platform_admin();

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'A new order starts as submitted' USING ERRCODE = '42501';
    END IF;
    IF NOT v_admin AND NEW.created_by_staff_id IS DISTINCT FROM v_staff THEN
      RAISE EXCEPTION 'An order is raised in your own name' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.created_by_staff_id IS DISTINCT FROM OLD.created_by_staff_id
     OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name THEN
    RAISE EXCEPTION 'Who raised an order, and for which company, cannot change' USING ERRCODE = '42501';
  END IF;

  IF NEW.approver_staff_id IS DISTINCT FROM OLD.approver_staff_id
     AND NOT (v_owner OR v_admin OR public.caller_sees_all_activity(NEW.business_id)) THEN
    RAISE EXCEPTION 'Only the owner or a field manager can change who approves an order' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'submitted'  AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved'   AND NEW.status = 'processing')
      OR (OLD.status = 'processing' AND NEW.status = 'dispatched')
      OR (OLD.status = 'dispatched' AND NEW.status = 'delivered')
    ) THEN
      RAISE EXCEPTION 'An order cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '22023';
    END IF;

    IF NEW.status IN ('approved', 'rejected') THEN
      IF NOT (v_owner OR v_admin OR (v_staff IS NOT NULL AND v_staff = OLD.approver_staff_id)) THEN
        RAISE EXCEPTION 'Only the tagged approver or the owner can approve or reject this order' USING ERRCODE = '42501';
      END IF;
      IF NOT (v_owner OR v_admin) AND v_staff IS NOT DISTINCT FROM OLD.created_by_staff_id THEN
        RAISE EXCEPTION 'You cannot approve or reject an order you raised' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT (v_owner OR v_admin) AND v_staff IS NOT DISTINCT FROM OLD.created_by_staff_id THEN
        RAISE EXCEPTION 'You cannot move an order you raised through the warehouse stages' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Trigger functions are not meant to be called: remove the default EXECUTE grants Supabase adds.
REVOKE ALL ON FUNCTION public.orders_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_guard ON public.orders;
CREATE TRIGGER orders_guard
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_guard();

-- No signed-in caller deletes an order or its children. RESTRICTIVE, so it holds whatever else is permitted.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_files', 'order_events', 'order_watchers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' no delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t || ' no delete', t);
  END LOOP;
END $$;

-- Verify, do not assume.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_guard' AND tgrelid = 'public.orders'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'orders_guard trigger is missing';
  END IF;
  IF has_function_privilege('anon', 'public.orders_guard()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.orders_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'orders_guard must not be callable directly';
  END IF;
  IF has_function_privilege('anon', 'public.orders_caller_is_owner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'orders_caller_is_owner must not be executable by anon';
  END IF;
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_files', 'order_events', 'order_watchers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' no delete' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'the no-delete policy on % is missing', t;
    END IF;
  END LOOP;
END $$;
