-- ─────────────────────────────────────────────────────────────────────────────
-- Stock counts (Stock Management ▸ Stock Validation) can correct expiry dates.
-- 2026-11-19. Docs: docs/architecture/Stock-Ledger.md ("Expiry dates in a stock count")
-- Status: APPLIED to the live carehub project 2026-11-19 with owner approval (version 20261119081658). The live body
-- matches this file (md5 of prosrc 1b199ee63e81a4b3fb8274fe03d020bd). Probed live as a business owner inside a
-- rolled-back block: expiry-only correction set and recorded before/after, quantity + expiry saved together with one
-- ledger row, 2027-02-30 refused (COUNT_INVALID), another business refused (COUNT_FORBIDDEN), history not writable;
-- session and line counts unchanged afterwards (14 / 42). Tested first on PGlite
-- (apps/carefind/src/test/stock-count/stockCountExpiry.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- A count is when staff hold every pack in their hands, so it is when a wrong or
-- missing expiry date is found. Stock Validation could only adjust quantities;
-- the expiry had to be corrected separately in Inventory ▸ Edit, product by
-- product, and that correction left no trace in the count history.
--
-- WHAT
-- * Each count line may carry `new_expiry_date` ('YYYY-MM-DD'). When it differs
--   from the product's expiry_date, products.expiry_date is set to it in the same
--   transaction as the quantity adjustment: the count saves whole or not at all.
--   A line without it (or null) leaves the expiry as it is, so older screens keep
--   working unchanged. Clearing an expiry is not done here (Inventory ▸ Edit).
-- * The line records previous_expiry_date (as found, under the row lock) and
--   new_expiry_date (as saved) in two new nullable columns of
--   stock_validation_items, so the count history shows what was corrected.
-- * A line whose only change is the expiry is a valid line (quantity 0).
-- * Refusals, same style and codes as before:
--   COUNT_INVALID   the date is not a real YYYY-MM-DD date between 2000-01-01
--                   and 2100-12-31;
--   BATCH_REQUIRED  the product is batch-tracked (expiry belongs to its batches;
--                   none is tracked live, 2026-11-19);
--   Services have no expiry: a date sent for a service is ignored.
-- * Everything else is identical to carehub_20261227_lock_stock_count_history
--   (whose body matches the live function, md5 of prosrc c1b22e22…, 2026-11-19).
--
-- SECURITY
-- No new access. The membership check (own business or branches, or a platform
-- admin) is unchanged, products are still matched on business_id, and members of
-- a business can already change products.expiry_date through the "products of
-- own business" policy (Inventory ▸ Edit). The change is now also recorded in the
-- append-only count history, with the counting user taken from the login.
-- The two new columns are covered by the existing SELECT-only policies and grants.
--
-- ROLLBACK
-- Re-run the function from carehub_20261227_lock_stock_count_history.sql (same
-- signature; grants and comment are kept). The two columns can stay (nullable,
-- unused by the old body) or be dropped:
--   ALTER TABLE public.stock_validation_items DROP COLUMN previous_expiry_date, DROP COLUMN new_expiry_date;
-- Expiry dates already corrected by counts stay corrected.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.stock_validation_items ADD COLUMN IF NOT EXISTS previous_expiry_date date;
ALTER TABLE public.stock_validation_items ADD COLUMN IF NOT EXISTS new_expiry_date date;

COMMENT ON COLUMN public.stock_validation_items.previous_expiry_date IS 'The product''s expiry date when the count was saved (null: none set, or a count saved before 2026-11-19).';
COMMENT ON COLUMN public.stock_validation_items.new_expiry_date IS 'The product''s expiry date after the count; differs from previous_expiry_date when the count corrected it.';

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
  v_exp_raw  text;
  v_exp_new  date;
  v_exp_old  date;
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
    -- The expiry as counted: absent or null leaves the product's expiry as it is.
    v_exp_raw := nullif(v_item ->> 'new_expiry_date', '');
    v_exp_new := NULL;
    IF v_exp_raw IS NOT NULL THEN
      IF v_exp_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'COUNT_INVALID: The expiry date for % is not a valid date.', v_label USING ERRCODE = 'check_violation';
      END IF;
      BEGIN
        v_exp_new := v_exp_raw::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'COUNT_INVALID: The expiry date for % is not a valid date.', v_label USING ERRCODE = 'check_violation';
      END;
      -- to_char round trip: a date the cast silently adjusted is refused too.
      IF to_char(v_exp_new, 'YYYY-MM-DD') <> v_exp_raw OR v_exp_new < date '2000-01-01' OR v_exp_new > date '2100-12-31' THEN
        RAISE EXCEPTION 'COUNT_INVALID: The expiry date for % is not a valid date.', v_label USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    v_product := (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'adjustment_qty')::integer, 0);
    v_dir := CASE WHEN v_item ->> 'adjustment_direction' = '-' THEN '-' ELSE '+' END;
    v_delta := CASE WHEN v_dir = '-' THEN -v_qty ELSE v_qty END;

    SELECT coalesce(stock, 0), tracking_mode, category, name, expiry_date INTO v_stock, v_mode, v_category, v_name, v_exp_old
      FROM public.products
     WHERE id = v_product AND business_id = p_business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: % is no longer in this inventory. Remove it from the count and save again.', v_label USING ERRCODE = 'no_data_found';
    END IF;
    IF coalesce(v_category, '') = 'Services' THEN v_delta := 0; v_exp_new := NULL; END IF;
    IF v_delta <> 0 AND v_mode <> 'none' THEN
      RAISE EXCEPTION 'BATCH_REQUIRED: % is tracked by batch, so it cannot be adjusted from a stock count yet.', v_name USING ERRCODE = 'check_violation';
    END IF;
    IF v_exp_new IS NOT NULL AND v_exp_new IS DISTINCT FROM v_exp_old AND v_mode <> 'none' THEN
      RAISE EXCEPTION 'BATCH_REQUIRED: % is tracked by batch, so its expiry dates are set on its batches, not from a stock count.', v_name USING ERRCODE = 'check_violation';
    END IF;
    IF v_delta < 0 AND v_stock + v_delta < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % has % in stock now, so % cannot be removed. Reload the count and check it again.', v_name, v_stock, v_qty
        USING ERRCODE = 'check_violation';
    END IF;

    v_seen := CASE WHEN coalesce(v_item ->> 'previous_stock', '') ~ '^-?[0-9]{1,9}$' THEN (v_item ->> 'previous_stock')::integer END;
    INSERT INTO public.stock_validation_items (
      session_id, product_id, product_name, shelf_label, previous_stock,
      adjustment_qty, adjustment_direction, new_stock, reason, unit_price,
      previous_expiry_date, new_expiry_date
    ) VALUES (
      v_session, v_product, v_name, nullif(v_item ->> 'shelf_label', ''), v_stock,
      v_qty, v_dir, v_stock + v_delta, nullif(v_item ->> 'reason', ''),
      CASE WHEN coalesce(v_item ->> 'unit_price', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_item ->> 'unit_price')::numeric ELSE 0 END,
      v_exp_old, coalesce(v_exp_new, v_exp_old)
    )
    RETURNING id INTO v_item_id;

    IF v_exp_new IS NOT NULL AND v_exp_new IS DISTINCT FROM v_exp_old THEN
      UPDATE public.products SET expiry_date = v_exp_new WHERE id = v_product AND business_id = p_business_id;
    END IF;

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
  'Saves a stock count: each line''s adjustment is applied to the stock as it is now through apply_stock_change (adjustment, source stock_count), and a line''s new_expiry_date (if any) corrects products.expiry_date, in one transaction. Idempotent on p_request_key. SECURITY DEFINER with an explicit own business / platform admin check: the only writer of the stock count history.';
