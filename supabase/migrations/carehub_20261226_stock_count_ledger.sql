-- ─────────────────────────────────────────────────────────────────────────────
-- Stock counts (Stock Management ▸ Stock Validation) onto the stock ledger.
-- 2026-10-30. Docs: docs/architecture/Stock-Ledger.md
-- APPLIED to the live carehub project 2026-10-30 as carehub_20261226_stock_count_ledger
-- (version 20261030143915). The live body matches this file (md5).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- save_stock_validation_session (no migration in this repository defined it;
-- the previous live body is in docs/architecture/stock-count-pre-ledger-snapshot.sql)
-- wrote products.stock = new_stock with no stock_movements row, where new_stock
-- was worked out in the browser from the stock on screen:
--   * A sale rung up while the count was open was overwritten: the screen said
--     10, a sale took it to 9, "Remove 3" saved 7 instead of 6.
--   * The screen showed a negative stock but worked out "New Stock" from 0, so
--     what was saved was not what the screen displayed as current.
--   * It could be called by anon (refused only by RLS further in).
--
-- WHAT
-- * Each line's adjustment (Add / Remove N, as typed) is applied to the
--   product's stock as it is NOW, through apply_stock_change ('adjustment',
--   source 'stock_count', source_id the session, source_line_id the line,
--   key stock_count:<session>:<line>), so concurrent sales are kept and every
--   change has a ledger row naming who counted.
-- * The line records the real before and after stock. When the stock moved
--   since the screen loaded, the ledger reason says what the screen showed.
-- * Refusals are whole-count and written for the person counting, each starting
--   with a code the app recognises: INSUFFICIENT_STOCK (removing more than is in
--   stock now), BATCH_REQUIRED (a batch-tracked product: counts have no batch
--   field; none is tracked live), PRODUCT_NOT_FOUND, COUNT_INVALID.
-- * p_request_key (new, optional): the same count saved twice (a retry after a
--   lost reply, a second tap) returns the first session instead of adjusting
--   twice. Backed by a unique index on (business_id, request_key). Older
--   screens that do not send it keep working.
-- * Services are recorded but their stock is not changed (as the ledger does
--   everywhere).
--
-- SECURITY
-- SECURITY INVOKER, unchanged boundary: products, sessions and lines are
-- reached through their RLS (own business, or a platform admin), as before.
-- EXECUTE is now authenticated and service_role only (anon removed).
-- p_user_id / p_user_name are still the caller's display values for the history
-- screen; the ledger row records the real signed-in user (auth.uid(), auth.email()).
--
-- ROLLBACK
-- DROP FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text);
-- then run docs/architecture/stock-count-pre-ledger-snapshot.sql. The request_key
-- column and index can stay.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stock_validation_sessions ADD COLUMN IF NOT EXISTS request_key text;
CREATE UNIQUE INDEX IF NOT EXISTS stock_validation_sessions_request_key_uniq
  ON public.stock_validation_sessions (business_id, request_key) WHERE request_key IS NOT NULL;

-- A new optional parameter: replacing the 6 argument function (not overloading
-- it) keeps PostgREST from finding two candidates for a 6 argument call.
DROP FUNCTION IF EXISTS public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb);

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
SECURITY INVOKER
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
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'COUNT_INVALID: The business is missing. Reload the page and try again.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COUNT_INVALID: The count has no lines.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_request_key IS NOT NULL THEN
    SELECT id INTO v_session FROM public.stock_validation_sessions
     WHERE business_id = p_business_id AND request_key = p_request_key;
    IF FOUND THEN RETURN v_session; END IF;
  END IF;

  BEGIN
    INSERT INTO public.stock_validation_sessions (business_id, user_id, user_name, products_checked, products_adjusted, request_key)
    VALUES (p_business_id, p_user_id, p_user_name, p_products_checked, p_products_adjusted, p_request_key)
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
  'Saves a stock count: each line''s adjustment is applied to the stock as it is now through apply_stock_change (adjustment, source stock_count), in one transaction. Idempotent on p_request_key. SECURITY INVOKER: RLS is the tenant boundary.';
