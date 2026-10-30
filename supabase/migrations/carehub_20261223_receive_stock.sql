-- ─────────────────────────────────────────────────────────────────────────────
-- receive_stock: Purchases and Inventory's + Stock, onto the stock ledger.
-- 2026-10-30. Additive: one new function; increment_product_stock is kept
-- (marked deprecated) because the client bundle already deployed calls it.
-- Docs: docs/architecture/Stock-Ledger.md
-- APPLIED to the live carehub project 2026-10-30 as carehub_20261223_receive_stock
-- (version 20261030131900); the live body matches this file (md5
-- 70dbb026d4c7d472f7163bb2dcc0f735). Security advisors unchanged (202 before and after).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- apply_stock_change (carehub_20261140_inventory_integrity_foundation) is the
-- single stock-writing function: it locks the product, refuses negative stock,
-- keeps a tracked product's stock equal to its batches and journals every
-- change in stock_movements. Purchases, + Stock and "Update Existing Product"
-- still went through increment_product_stock, which writes products.stock
-- directly: no ledger row, and on a batch-tracked product stock would stop
-- matching its batches. Purchases also created the batch row in a separate
-- request, so a failure could leave stock without its batch or a batch
-- without its stock.
--
-- WHAT
-- receive_stock adds received units to one product in ONE transaction:
--   1. lock the product (the tenant boundary is RLS: SECURITY INVOKER, the
--      same as apply_stock_change and the function it replaces);
--   2. replay: if this idempotency key was already journalled for the
--      business, return that result and change nothing. A retried request
--      (network failure after commit, a second tap) can never add twice. The
--      key is required; stock_movements_idem_uniq backs it;
--   3. a tracked product must name a batch (and an expiry for batch_expiry);
--   4. when a batch number or expiry is given, create the batch at quantity 0;
--   5. add the units through apply_stock_change, which raises the batch and
--      the product together and writes the ledger row (who, before, after,
--      source).
-- Services carry no stock: nothing changes and the result says so.
--
-- The batch's received_by and the ledger's moved_by come from auth.email(),
-- never from the client, so the label cannot be spoofed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.receive_stock(
  p_business_id     uuid,
  p_product_id      uuid,
  p_qty             integer,
  p_movement_type   text,
  p_idempotency_key text,
  p_source_type     text DEFAULT NULL,
  p_source_id       text DEFAULT NULL,
  p_source_line_id  text DEFAULT NULL,
  p_reason          text DEFAULT NULL,
  p_batch_number    text DEFAULT NULL,
  p_expiry_date     date DEFAULT NULL,
  p_date_received   date DEFAULT NULL,
  p_supplier        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode     text;
  v_category text;
  v_name     text;
  v_batch_no text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_prior    record;
  v_batch    uuid;
  v_mid      uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'RECEIVE_INVALID: the quantity must be a whole number above zero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN ('purchase_receipt', 'adjustment') THEN
    RAISE EXCEPTION 'RECEIVE_INVALID: unsupported movement type %', p_movement_type USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'RECEIVE_INVALID: an idempotency key is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT tracking_mode, category, name INTO v_mode, v_category, v_name
    FROM public.products
   WHERE id = p_product_id AND business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: product % does not exist in this business', p_product_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Replay of a request that already landed (the product lock above
  -- serialises two copies of the same request, so the second sees the first).
  SELECT id, batch_id INTO v_prior
    FROM public.stock_movements
   WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'movement_id', v_prior.id, 'batch_id', v_prior.batch_id, 'replayed', true,
      'stock', (SELECT stock FROM public.products WHERE id = p_product_id));
  END IF;

  IF coalesce(v_category, '') = 'Services' THEN
    RETURN jsonb_build_object('movement_id', NULL, 'batch_id', NULL, 'replayed', false, 'skipped', 'service',
      'stock', (SELECT stock FROM public.products WHERE id = p_product_id));
  END IF;

  IF v_mode <> 'none' AND v_batch_no IS NULL THEN
    RAISE EXCEPTION 'BATCH_REQUIRED: this product is tracked by batch; enter its batch number' USING ERRCODE = 'check_violation';
  END IF;
  IF v_mode = 'batch_expiry' AND p_expiry_date IS NULL THEN
    RAISE EXCEPTION 'EXPIRY_REQUIRED: this product is tracked by batch and expiry; enter the expiry date' USING ERRCODE = 'check_violation';
  END IF;

  IF v_batch_no IS NOT NULL OR p_expiry_date IS NOT NULL THEN
    INSERT INTO public.stock_batches (
      business_id, product_id, product_name, batch_number, quantity, expiry_date,
      date_received, supplier_source, status, received_by, location_id
    ) VALUES (
      p_business_id, p_product_id, v_name, v_batch_no, 0, p_expiry_date,
      coalesce(p_date_received, current_date), nullif(btrim(coalesce(p_supplier, '')), ''), 'available', auth.email(), NULL
    ) RETURNING id INTO v_batch;
  END IF;

  v_mid := public.apply_stock_change(
    p_business_id, p_product_id, p_qty, p_movement_type, v_batch,
    p_source_type, p_source_id, p_source_line_id, p_reason, p_idempotency_key, NULL);

  RETURN jsonb_build_object(
    'movement_id', v_mid, 'batch_id', v_batch, 'replayed', false,
    'stock', (SELECT stock FROM public.products WHERE id = p_product_id));
END;
$$;

COMMENT ON FUNCTION public.receive_stock(uuid, uuid, integer, text, text, text, text, text, text, text, date, date, text) IS
  'Adds received units to one product in one transaction: replays an already-journalled idempotency key, requires a batch '
  '(and expiry) for tracked products, creates the batch when given, and adds the units through apply_stock_change so the '
  'stock ledger records them. SECURITY INVOKER: RLS is the tenant boundary.';

REVOKE ALL ON FUNCTION public.receive_stock(uuid, uuid, integer, text, text, text, text, text, text, text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receive_stock(uuid, uuid, integer, text, text, text, text, text, text, text, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_stock(uuid, uuid, integer, text, text, text, text, text, text, text, date, date, text) TO authenticated;

COMMENT ON FUNCTION public.increment_product_stock(uuid, uuid, integer) IS
  'DEPRECATED 2026-10-30: bypasses the stock ledger. Superseded by receive_stock; kept only until every deployed client '
  'has moved off it, then drop it. SECURITY INVOKER - products RLS enforces the tenant boundary.';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY (read-only, after apply)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT p.prosecdef, p.proconfig, p.proacl::text
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'receive_stock';
-- Expect: prosecdef = false, proconfig = {search_path=public, pg_temp},
--         authenticated=X, no anon and no PUBLIC (=X) entry.
