-- ─────────────────────────────────────────────────────────────────────────────
-- Stock count history: written only by save_stock_validation_session.
-- 2026-10-30. Docs: docs/architecture/Stock-Ledger.md
-- PENDING, NOT APPLIED. Tested (scripts/db-tests/stockCount.pglite.mjs); waiting for the
-- rolled-back production probe. Move to supabase/migrations/ when applied.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- stock_validation_sessions and stock_validation_items granted INSERT, UPDATE and
-- DELETE (and TRUNCATE, REFERENCES, TRIGGER) to anon and authenticated, behind
-- "ALL" RLS policies. Any member of a business could therefore edit or delete
-- its count history directly through the API, and the session's user_id /
-- user_name were whatever the screen sent. The app only ever reads these tables
-- (stock-management/repositories); the writers are save_stock_validation_session
-- and merge_duplicate_products (SECURITY DEFINER).
--
-- WHAT
-- * save_stock_validation_session becomes SECURITY DEFINER and checks the same
--   boundary RLS gave it: p_business_id in current_business_ids() (an owner's
--   branches included) or a platform admin, else COUNT_FORBIDDEN. Products are
--   still matched on business_id, so nothing outside that business is reached.
--   Body otherwise identical to carehub_20261226_stock_count_ledger.
-- * The session records who counted from the login: user_id = auth.uid(),
--   user_name = the staff member's name in this business, 'Owner' for the
--   business login; the screen's values only when neither applies (service role).
-- * anon loses every privilege on both tables; authenticated keeps SELECT only.
--   The RLS policies become SELECT only, so a later blanket GRANT cannot reopen
--   writes. service_role is unchanged.
--
-- NOT CHANGED
-- Deleting a product still deletes its count lines (stock_validation_items
-- product_id ON DELETE CASCADE runs as the table owner). The ledger rows for
-- those counts remain.
--
-- SECURITY
-- Who can save a count is unchanged (members of the business and platform
-- admins). What changes: nobody can alter or erase count history through the
-- API, and attribution can no longer be set by the client. The function is
-- SECURITY DEFINER with a pinned search_path and an explicit membership check,
-- the same model as merge_duplicate_products; the advisor lists it as a definer
-- function executable by authenticated, which is intended.
--
-- ROLLBACK
-- Re-run carehub_20261226_stock_count_ledger.sql's function (SECURITY INVOKER),
-- GRANT INSERT, UPDATE, DELETE ON both tables TO authenticated, and recreate the
-- two policies FOR ALL (definitions below, with FOR SELECT replaced).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_stock_validation_session(
  p_business_id       uuid,
  p_user_id           uuid,
  p_user_name         text,
  p_products_checked  integer,
  p_products_adjusted integer,
  p_items             jsonb,
  p_request_key       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_session  uuid;
  v_item     jsonb;
  v_item_id  uuid;
  v_product  uuid;
  v_label    text;
  v_qty      integer;
  v_dir      text;
  v_delta    integer;
  v_stock    integer;
  v_mode     text;
  v_category text;
  v_name     text;
  v_seen     integer;
  v_reason   text;
  v_by       text;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'COUNT_INVALID: The business is missing. Reload the page and try again.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COUNT_INVALID: The count has no lines.' USING ERRCODE = 'check_violation';
  END IF;
  -- The boundary RLS used to give: the caller's own business (an owner's branches
  -- included) or a platform admin. Checked here because this function now writes
  -- as its owner, so the history tables need no client write access.
  IF NOT (p_business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'COUNT_FORBIDDEN: You can only save stock counts for your own business.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Who counted comes from the login, not from the screen: the staff member's
  -- name in this business, 'Owner' for the business login, else what was sent.
  SELECT s.full_name INTO v_by FROM public.staff s
   WHERE s.business_id = p_business_id AND s.status = 'active' AND lower(s.email) = lower(auth.email())
   LIMIT 1;
  IF v_by IS NULL AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND lower(b.email) = lower(auth.email())) THEN
    v_by := 'Owner';
  END IF;

  IF p_request_key IS NOT NULL THEN
    SELECT id INTO v_session FROM public.stock_validation_sessions
     WHERE business_id = p_business_id AND request_key = p_request_key;
    IF FOUND THEN RETURN v_session; END IF;
  END IF;

  BEGIN
    INSERT INTO public.stock_validation_sessions (business_id, user_id, user_name, products_checked, products_adjusted, request_key)
    VALUES (p_business_id, coalesce(auth.uid(), p_user_id), coalesce(nullif(v_by, ''), p_user_name), p_products_checked, p_products_adjusted, p_request_key)
    RETURNING id INTO v_session;
  EXCEPTION WHEN unique_violation THEN
    -- The same count saved twice at once: the first save stands.
    SELECT id INTO v_session FROM public.stock_validation_sessions
     WHERE business_id = p_business_id AND request_key = p_request_key;
    RETURN v_session;
  END;

  -- Product order, so two counts touching the same products lock them in the same order.
  FOR v_item IN
    SELECT e FROM jsonb_array_elements(p_items) e ORDER BY e ->> 'product_id'
  LOOP
    v_label := coalesce(nullif(v_item ->> 'product_name', ''), 'A product');
    IF coalesce(v_item ->> 'product_id', '') !~* c_uuid THEN
      RAISE EXCEPTION 'COUNT_INVALID: % has no product attached. Remove it from the count and save again.', v_label USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(v_item ->> 'adjustment_qty', '0') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'COUNT_INVALID: Enter a whole number of units for %.', v_label USING ERRCODE = 'check_violation';
    END IF;
    v_product := (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'adjustment_qty')::integer, 0);
    v_dir := CASE WHEN v_item ->> 'adjustment_direction' = '-' THEN '-' ELSE '+' END;
    v_delta := CASE WHEN v_dir = '-' THEN -v_qty ELSE v_qty END;

    SELECT coalesce(stock, 0), tracking_mode, category, name INTO v_stock, v_mode, v_category, v_name
      FROM public.products
     WHERE id = v_product AND business_id = p_business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: % is no longer in this inventory. Remove it from the count and save again.', v_label USING ERRCODE = 'no_data_found';
    END IF;
    IF coalesce(v_category, '') = 'Services' THEN v_delta := 0; END IF;
    IF v_delta <> 0 AND v_mode <> 'none' THEN
      RAISE EXCEPTION 'BATCH_REQUIRED: % is tracked by batch, so it cannot be adjusted from a stock count yet.', v_name USING ERRCODE = 'check_violation';
    END IF;
    IF v_delta < 0 AND v_stock + v_delta < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % has % in stock now, so % cannot be removed. Reload the count and check it again.', v_name, v_stock, v_qty
        USING ERRCODE = 'check_violation';
    END IF;

    v_seen := CASE WHEN coalesce(v_item ->> 'previous_stock', '') ~ '^-?[0-9]{1,9}$' THEN (v_item ->> 'previous_stock')::integer END;
    INSERT INTO public.stock_validation_items (
      session_id, product_id, product_name, shelf_label, previous_stock,
      adjustment_qty, adjustment_direction, new_stock, reason, unit_price
    ) VALUES (
      v_session, v_product, v_name, nullif(v_item ->> 'shelf_label', ''), v_stock,
      v_qty, v_dir, v_stock + v_delta, nullif(v_item ->> 'reason', ''),
      CASE WHEN coalesce(v_item ->> 'unit_price', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_item ->> 'unit_price')::numeric ELSE 0 END
    )
    RETURNING id INTO v_item_id;

    IF v_delta <> 0 THEN
      v_reason := 'Stock count' || coalesce(': ' || nullif(v_item ->> 'reason', ''), '')
        || CASE WHEN v_seen IS NOT NULL AND v_seen <> v_stock THEN ' (screen showed ' || v_seen || ', stock was ' || v_stock || ')' ELSE '' END;
      PERFORM public.apply_stock_change(
        p_business_id, v_product, v_delta, 'adjustment', NULL, 'stock_count', v_session::text, v_item_id::text,
        v_reason, 'stock_count:' || v_session || ':' || v_item_id, NULL);
    END IF;
  END LOOP;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text) IS
  'Saves a stock count: each line''s adjustment is applied to the stock as it is now through apply_stock_change (adjustment, source stock_count), in one transaction. Idempotent on p_request_key. SECURITY DEFINER with an explicit own business / platform admin check: the only writer of the stock count history.';

REVOKE ALL ON TABLE public.stock_validation_sessions, public.stock_validation_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.stock_validation_sessions, public.stock_validation_items FROM authenticated;
GRANT SELECT ON TABLE public.stock_validation_sessions, public.stock_validation_items TO authenticated;

DROP POLICY IF EXISTS "stock_validation_sessions of own business" ON public.stock_validation_sessions;
CREATE POLICY "stock_validation_sessions of own business" ON public.stock_validation_sessions
  FOR SELECT
  USING ((business_id IN (SELECT current_business_ids() AS current_business_ids)) OR is_platform_admin());

DROP POLICY IF EXISTS "stock_validation_items via parent session" ON public.stock_validation_items;
CREATE POLICY "stock_validation_items via parent session" ON public.stock_validation_items
  FOR SELECT
  USING (is_platform_admin() OR (session_id IN (SELECT stock_validation_sessions.id FROM stock_validation_sessions
    WHERE (stock_validation_sessions.business_id IN (SELECT current_business_ids() AS current_business_ids)))));
