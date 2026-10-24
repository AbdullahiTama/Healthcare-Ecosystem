-- carehub_20261026_orders_authorisation
-- APPLIED 2026-10-24 to szdybxmgmhndoytqanfb as version 20261024110224.
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
--   * what was ordered (customer, lines, total, notes, every column not named below) changes only by the person who
--     raised it while it waits for approval; the approver approves what they saw, and nobody changes it underneath
--     them or afterwards. approved_at/approval_note change only with the approve/reject step, dispatched_at and
--     delivered_at only with their own step. The owner and a platform admin may still correct an order;
--   * order lines: added or changed only by the person who raised the order while it is submitted (or the owner);
--   * order history (order_events): an event names the order's CURRENT status, is written by someone who could have
--     made that step, only once per step, under the writer's real staff name; events are never edited;
--   * no signed-in caller deletes an order or any of its lines, files, events or watchers: a mistake is rejected,
--     not erased (order_events already records every change).
-- Reading is NOT changed here: see carehub_20261026_orders_read_scope.sql (held for an owner decision).
--
-- Server-side work (service role, migrations) is not a signed-in caller and is not blocked.
--
-- Rollback: DROP TRIGGER orders_guard ON public.orders; DROP TRIGGER order_items_guard ON public.order_items;
--           DROP TRIGGER order_events_guard ON public.order_events;
--           DROP FUNCTION public.orders_guard(), public.order_items_guard(), public.order_events_guard(),
--           public.orders_caller_is_owner(uuid), public.orders_caller_staff_name(uuid); drop the five "... no delete" policies and "order_events no update".

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

-- The caller's own staff name in this business (NULL for the owner or a non-member), so the order history records
-- who really took a step. SECURITY DEFINER so it does not depend on how the staff table may be read; it returns
-- nothing about anyone but the caller.
CREATE OR REPLACE FUNCTION public.orders_caller_staff_name(bid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.full_name FROM public.staff s WHERE s.id = public.caller_staff_id(bid)
$$;
REVOKE ALL ON FUNCTION public.orders_caller_staff_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orders_caller_staff_name(uuid) TO authenticated, service_role;

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
  -- The columns that move an order along; each has its own rule below. Every other column is "what was ordered".
  v_workflow text[] := ARRAY['status', 'approver_staff_id', 'approver_name', 'approved_at', 'approval_note', 'dispatched_at', 'delivered_at'];
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

  IF (NEW.approver_staff_id IS DISTINCT FROM OLD.approver_staff_id OR NEW.approver_name IS DISTINCT FROM OLD.approver_name)
     AND NOT (v_owner OR v_admin OR public.caller_sees_all_activity(NEW.business_id)) THEN
    RAISE EXCEPTION 'Only the owner or a field manager can change who approves an order' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_owner OR v_admin) THEN
    -- Listed by exclusion, so a column added later is protected by default.
    IF (to_jsonb(NEW) - v_workflow) IS DISTINCT FROM (to_jsonb(OLD) - v_workflow)
       AND NOT (OLD.status = 'submitted' AND NEW.status = 'submitted' AND v_staff IS NOT NULL AND v_staff = OLD.created_by_staff_id) THEN
      RAISE EXCEPTION 'Only the person who raised an order can change it, and only while it waits for approval' USING ERRCODE = '42501';
    END IF;
    IF (NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approval_note IS DISTINCT FROM OLD.approval_note)
       AND NOT (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected')) THEN
      RAISE EXCEPTION 'The approval details are recorded only when the order is approved or rejected' USING ERRCODE = '42501';
    END IF;
    IF NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at AND NOT (OLD.status = 'processing' AND NEW.status = 'dispatched') THEN
      RAISE EXCEPTION 'The dispatch time is recorded only when the order is dispatched' USING ERRCODE = '42501';
    END IF;
    IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at AND NOT (OLD.status = 'dispatched' AND NEW.status = 'delivered') THEN
      RAISE EXCEPTION 'The delivery time is recorded only when the order is delivered' USING ERRCODE = '42501';
    END IF;
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

-- Order lines: only the person who raised the order adds or changes them, while it waits for approval; the owner and a
-- platform admin may correct them. SECURITY INVOKER: the parent order is read under the caller's own policies, so an
-- order the caller cannot see cannot be written to either.
CREATE OR REPLACE FUNCTION public.order_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  o record;
  v_order uuid;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  -- On UPDATE both the order the line leaves and the order it joins must allow it.
  FOREACH v_order IN ARRAY CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[OLD.order_id, NEW.order_id] ELSE ARRAY[NEW.order_id] END LOOP
    SELECT business_id, status, created_by_staff_id INTO o FROM public.orders WHERE id = v_order;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_platform_admin() OR public.orders_caller_is_owner(o.business_id)
            OR (o.status = 'submitted' AND public.caller_staff_id(o.business_id) IS NOT DISTINCT FROM o.created_by_staff_id
                AND public.caller_staff_id(o.business_id) IS NOT NULL)) THEN
      RAISE EXCEPTION 'Only the person who raised an order can change its lines, and only while it waits for approval' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.order_items_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS order_items_guard ON public.order_items;
CREATE TRIGGER order_items_guard
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_guard();

-- Order history: an event records the step the order is at NOW, written by someone who could have taken that step,
-- once, under the writer's real name (a staff member's name comes from their staff record; the owner's is kept).
CREATE OR REPLACE FUNCTION public.order_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  o record;
  v_staff uuid;
  v_privileged boolean;
  v_name text;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  SELECT business_id, status, created_by_staff_id, approver_staff_id INTO o FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;
  IF NEW.event_type IS DISTINCT FROM o.status THEN
    RAISE EXCEPTION 'An order event must name the step the order is at (%)', o.status USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_events e WHERE e.order_id = NEW.order_id AND e.event_type = NEW.event_type) THEN
    RAISE EXCEPTION 'This step is already recorded' USING ERRCODE = '42501';
  END IF;

  v_staff := public.caller_staff_id(o.business_id);
  v_privileged := public.is_platform_admin() OR public.orders_caller_is_owner(o.business_id);
  IF NOT v_privileged THEN
    IF v_staff IS NULL
       OR (o.status = 'submitted' AND v_staff IS DISTINCT FROM o.created_by_staff_id)
       OR (o.status IN ('approved', 'rejected') AND v_staff IS DISTINCT FROM o.approver_staff_id)
       OR (o.status IN ('processing', 'dispatched', 'delivered') AND v_staff IS NOT DISTINCT FROM o.created_by_staff_id) THEN
      RAISE EXCEPTION 'You did not take this step' USING ERRCODE = '42501';
    END IF;
    v_name := public.orders_caller_staff_name(o.business_id);
    NEW.actor_name := COALESCE(v_name, NEW.actor_name);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.order_events_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS order_events_guard ON public.order_events;
CREATE TRIGGER order_events_guard
  BEFORE INSERT ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.order_events_guard();

DROP POLICY IF EXISTS "order_events no update" ON public.order_events;
CREATE POLICY "order_events no update" ON public.order_events AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);

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
  FOREACH t IN ARRAY ARRAY['orders_guard', 'order_items_guard', 'order_events_guard'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'trigger % is missing', t;
    END IF;
    IF has_function_privilege('anon', 'public.' || t || '()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || t || '()', 'EXECUTE') THEN
      RAISE EXCEPTION '% must not be callable directly', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_events' AND policyname = 'order_events no update' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'the no-update policy on order_events is missing';
  END IF;
  -- These guards hold only for writes made as the caller. A SECURITY DEFINER function that writes the orders tables
  -- and is callable by signed-in users would go round them (none exists, 2026-10-24); refuse to apply if one appears.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO t
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?order(s|_items|_events|_files|_watchers)\M'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF t IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY DEFINER functions that write orders are callable by signed-in users: %', t;
  END IF;
  IF has_function_privilege('anon', 'public.orders_caller_is_owner(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.orders_caller_staff_name(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'orders_caller_is_owner and orders_caller_staff_name must not be executable by anon';
  END IF;
  FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'order_files', 'order_events', 'order_watchers'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' no delete' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'the no-delete policy on % is missing', t;
    END IF;
  END LOOP;
END $$;
