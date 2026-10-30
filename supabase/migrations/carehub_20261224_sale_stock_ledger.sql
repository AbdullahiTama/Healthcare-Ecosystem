-- ─────────────────────────────────────────────────────────────────────────────
-- POS sales onto the stock ledger.
-- 2026-10-30. Docs: docs/architecture/Stock-Ledger.md
-- APPLIED to the live carehub project 2026-10-30 as carehub_20261224_sale_stock_ledger
-- (version 20261030135055; cutover 2026-10-30 13:50:55.58739 UTC). Live bodies of
-- apply_sale_ledger, sale_take_stock, sale_return_stock and sale_apply_stock_delta
-- match this file. The cutover function's pinned search_path was added afterwards
-- (carehub_20261224b_pin_cutover_search_path) after the advisor flagged it.
-- The comments on the superseded functions were later guarded with an existence
-- check so the file replays where they never existed (same effect live).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- Sales changed stock outside apply_stock_change, the single stock-writing
-- function, through two AFTER INSERT triggers and one correction function:
--   * apply_sale_stock_movement wrote products.stock = greatest(0, stock - qty)
--     with no stock_movements row. The clamp hid overselling (selling 5 with 2
--     on hand silently dropped 3) and RAISED a negative stock to 0 on a sale
--     (636 products live have stock < 0).
--   * apply_sale_batch_movement decremented batches separately and journalled
--     a 'sale' row with no product_id, so a batch line moved two rows in two
--     triggers that could disagree.
--   * sale_apply_stock_delta (edit_sale / delete_sale) adjusted products.stock
--     directly and journalled batch changes as 'sale_correction', a type
--     stock_movements_type_check does not allow: any edit or delete of a sale
--     with a batch line would have failed (none has happened; 0 such sales).
--
-- WHAT
-- * sale_take_stock / sale_return_stock: the one place a sale takes or puts
--   back units, both through apply_stock_change, so product and batch move
--   together with a ledger row (who, before, after, which sale).
--   - A named batch (line.batch_id) is used when it belongs to the product.
--   - Otherwise an untracked product takes from its stock; a batch-tracked
--     product takes from its available, unexpired batches, earliest expiry
--     first (none are tracked live today).
--   - Never more than is on hand: the ledger refuses negative stock, so the
--     units actually taken are journalled and a shortfall is written into the
--     row's reason ("short by 3"). A negative stock is left as it is, not
--     raised to 0.
--   - Edits and deletes give back what the ledger recorded for that sale,
--     never more (a sale that took 2 of 5 gives back 2), to the batches it
--     came from. Sales from before the ledger keep the old rule.
--   - "A sale is never lost": neither function raises. If the ledger refuses
--     for an unexpected reason (a tracked product whose batches disagree with
--     its stock), the change falls back to the previous direct write and a
--     WARNING is logged, so stock is never left overstated by a sale.
-- * apply_sale_ledger: ONE AFTER INSERT trigger replaces sale_stock_movement
--   and sale_batch_movement. Held sales are skipped (unchanged rule: the real
--   charge INSERTs a new row). Lines are taken in product order, so two
--   concurrent sales lock products in the same order.
-- * sale_apply_stock_delta: same signature and callers, now through the two
--   helpers ('sale_reversal' for units given back, 'sale' for extra units),
--   matching old and new lines on product AND batch.
--
-- SECURITY
-- apply_sale_ledger is SECURITY DEFINER with a pinned search_path so it can
-- call the internal parser (sale_stock_lines) and helpers, which stay revoked
-- from PUBLIC, anon and authenticated (as sale_stock_lines already was), so
-- nobody can journal a "sale" without a sale. Every statement is scoped to
-- NEW.business_id, which the sales RLS WITH CHECK (own business or platform
-- admin) already authorised for this insert; products and batches are matched
-- on business_id as well as id. auth.uid() / auth.email() still identify the
-- cashier, so ledger rows record who sold.
--
-- ROLLBACK
--   DROP TRIGGER sale_stock_ledger ON public.sales;
--   CREATE TRIGGER sale_stock_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_stock_movement();
--   CREATE TRIGGER sale_batch_movement AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION apply_sale_batch_movement();
-- (the old functions are left in place, unattached, for exactly this) and
-- restore sale_apply_stock_delta from carehub_20261216_sales_owner_corrections.
-- ─────────────────────────────────────────────────────────────────────────────

-- Take up to p_qty units of one product for a sale. Returns the units taken.
-- Never raises.
CREATE OR REPLACE FUNCTION public.sale_take_stock(
  p_business  uuid,
  p_product   uuid,
  p_batch     uuid,
  p_qty       integer,
  p_source    text,
  p_source_id text,
  p_txn       text,
  p_key       text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock    integer;
  v_mode     text;
  v_category text;
  v_left     integer := p_qty;
  v_take     integer;
  v_bqty     integer;
  v_avail    bigint;
  v_reason   text := 'Sale ' || coalesce(p_txn, '');
  b          record;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN 0; END IF;
  BEGIN
    SELECT coalesce(stock, 0), tracking_mode, category INTO v_stock, v_mode, v_category
      FROM public.products
     WHERE id = p_product AND business_id = p_business
     FOR UPDATE;
    IF NOT FOUND OR coalesce(v_category, '') = 'Services' THEN RETURN 0; END IF;

    -- A batch named on the line, when it belongs to this product.
    IF p_batch IS NOT NULL THEN
      SELECT quantity INTO v_bqty FROM public.stock_batches
       WHERE id = p_batch AND business_id = p_business AND product_id = p_product
       FOR UPDATE;
      IF FOUND THEN
        v_take := least(v_left, greatest(v_bqty, 0), greatest(v_stock, 0));
        IF v_take > 0 THEN
          PERFORM public.apply_stock_change(
            p_business, p_product, -v_take, 'sale', p_batch, p_source, p_source_id, p_product::text,
            v_reason, p_key || ':batch', NULL);
          v_left := v_left - v_take;
          v_stock := v_stock - v_take;
        END IF;
      END IF;
    END IF;

    IF v_left > 0 THEN
      IF v_mode = 'none' THEN
        v_take := least(v_left, greatest(v_stock, 0));
        IF v_take > 0 THEN
          PERFORM public.apply_stock_change(
            p_business, p_product, -v_take, 'sale', NULL, p_source, p_source_id, p_product::text,
            v_reason || CASE WHEN v_take < v_left THEN ' (short by ' || (v_left - v_take) || ')' ELSE '' END,
            p_key, NULL);
          v_left := v_left - v_take;
        ELSIF v_left > 0 THEN
          RAISE NOTICE 'sale %: product % had no stock to take for % unit(s)', p_txn, p_product, v_left;
        END IF;
      ELSE
        -- Tracked by batch and no batch named: earliest expiry first, from
        -- available, unexpired batches.
        SELECT coalesce(sum(quantity), 0) INTO v_avail FROM public.stock_batches
         WHERE product_id = p_product AND business_id = p_business AND quantity > 0
           AND status = 'available' AND (expiry_date IS NULL OR expiry_date >= current_date);
        FOR b IN
          SELECT id, quantity FROM public.stock_batches
           WHERE product_id = p_product AND business_id = p_business AND quantity > 0
             AND status = 'available' AND (expiry_date IS NULL OR expiry_date >= current_date)
           ORDER BY expiry_date NULLS LAST, created_at, id
           FOR UPDATE
        LOOP
          EXIT WHEN v_left <= 0;
          v_take := least(v_left, b.quantity);
          PERFORM public.apply_stock_change(
            p_business, p_product, -v_take, 'sale', b.id, p_source, p_source_id, p_product::text,
            v_reason || CASE WHEN v_avail < v_left THEN ' (short by ' || (v_left - v_avail) || ')' ELSE '' END,
            p_key || ':' || b.id, NULL);
          v_left := v_left - v_take;
          v_avail := v_avail - v_take;
        END LOOP;
      END IF;
    END IF;

    RETURN p_qty - v_left;
  EXCEPTION WHEN OTHERS THEN
    -- Never lose a sale: fall back to the previous behaviour for this line.
    RAISE WARNING 'sale %: ledger refused product % (%); stock reduced directly instead', p_txn, p_product, SQLERRM;
    BEGIN
      UPDATE public.products
         SET stock = greatest(0, coalesce(stock, 0) - p_qty)
       WHERE id = p_product AND business_id = p_business AND coalesce(category, '') <> 'Services'
         AND coalesce(stock, 0) > 0;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sale %: direct stock reduction for product % also failed (%)', p_txn, p_product, SQLERRM;
    END;
    RETURN 0;
  END;
END;
$$;

-- Put p_qty units of one product back after a sale is edited down or
-- deleted. Never raises.
CREATE OR REPLACE FUNCTION public.sale_return_stock(
  p_business  uuid,
  p_product   uuid,
  p_batch     uuid,
  p_qty       integer,
  p_txn       text,
  p_source_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode     text;
  v_category text;
  v_batch    uuid;
  v_reason   text := 'Sale ' || coalesce(p_txn, '') || ' corrected';
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RETURN; END IF;
  BEGIN
    SELECT tracking_mode, category INTO v_mode, v_category
      FROM public.products
     WHERE id = p_product AND business_id = p_business
     FOR UPDATE;
    IF NOT FOUND OR coalesce(v_category, '') = 'Services' THEN RETURN; END IF;

    IF p_batch IS NOT NULL THEN
      SELECT id INTO v_batch FROM public.stock_batches
       WHERE id = p_batch AND business_id = p_business AND product_id = p_product;
    END IF;
    IF v_batch IS NULL AND v_mode <> 'none' THEN
      -- Tracked, no usable batch on the line: back into the newest batch.
      SELECT id INTO v_batch FROM public.stock_batches
       WHERE business_id = p_business AND product_id = p_product
       ORDER BY created_at DESC, id DESC LIMIT 1;
      IF v_batch IS NULL THEN
        RAISE WARNING 'sale %: product % is tracked by batch but has no batch to return % unit(s) to', p_txn, p_product, p_qty;
        RETURN;
      END IF;
    END IF;

    PERFORM public.apply_stock_change(
      p_business, p_product, p_qty, 'sale_reversal', v_batch, 'sale_correction', coalesce(p_source_id, p_txn), p_product::text,
      v_reason, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sale %: ledger refused returning product % (%); stock raised directly instead', p_txn, p_product, SQLERRM;
    BEGIN
      UPDATE public.products
         SET stock = greatest(0, coalesce(stock, 0) + p_qty)
       WHERE id = p_product AND business_id = p_business AND coalesce(category, '') <> 'Services';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sale %: direct stock return for product % also failed (%)', p_txn, p_product, SQLERRM;
    END;
  END;
END;
$$;

-- The one sale trigger: takes each line's stock through the ledger.
CREATE OR REPLACE FUNCTION public.apply_sale_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  -- A held sale is not takings yet: resuming it UPDATEs the hold and the real
  -- charge INSERTs a new row, so stock moves exactly once per sale.
  IF coalesce(NEW.is_on_hold, false) OR NEW.business_id IS NULL OR NEW.items IS NULL THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT l.product_id, l.batch_id, sum(l.qty)::int AS qty
      FROM public.sale_stock_lines(NEW.items) l
     GROUP BY l.product_id, l.batch_id
    HAVING sum(l.qty) > 0
     ORDER BY l.product_id, l.batch_id NULLS LAST
  LOOP
    PERFORM public.sale_take_stock(
      NEW.business_id, r.product_id, r.batch_id, r.qty, 'sale', NEW.id::text, NEW.txn_no,
      'sale:' || NEW.id || ':' || r.product_id || ':' || coalesce(r.batch_id::text, '-'));
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Belt and braces: the helpers never raise, but a sale must never be lost
  -- to a stock problem.
  RAISE WARNING 'sale %: stock not recorded (%)', NEW.txn_no, SQLERRM;
  RETURN NEW;
END;
$$;

-- The instant this migration was applied. A sale created from now on has its
-- stock recorded by the ledger; a sale created before it has none to undo.
DO $cutover$
BEGIN
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.sale_ledger_cutover() RETURNS timestamp LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS %L',
    format('SELECT %L::timestamp', (now() AT TIME ZONE 'UTC')::timestamp));
END
$cutover$;

-- Edit / delete corrections: same signature and callers (edit_sale,
-- delete_sale), now through the ledger.
-- * Old and new lines are matched on product AND batch (a NULL batch is its
--   own key), so an edit from 5 to 4 units moves exactly 1.
-- * Units given back undo what the ledger RECORDED for this sale, never more,
--   and go back to the batches they came from (latest first). A sale that
--   recorded "took 2, short by 3" and is then deleted gives back 2, not 5.
--   The sale is found by business + txn_no (edit_sale / delete_sale hold its
--   row locked); its movements carry its id.
-- * A sale from before the ledger (no movements, created before the cutover)
--   has nothing recorded to undo, so it keeps the previous rule: the line
--   quantity goes back.
CREATE OR REPLACE FUNCTION public.sale_apply_stock_delta(p_business uuid, p_txn text, p_old jsonb, p_new jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r         record;
  g         record;
  v_sale    uuid;
  v_created timestamp;
  v_n       integer;
  v_ledger  boolean := false;
  v_source  text;
  v_left    integer;
  v_give    integer;
BEGIN
  SELECT (array_agg(id))[1], (array_agg(created_at))[1], count(*) INTO v_sale, v_created, v_n
    FROM public.sales WHERE business_id = p_business AND txn_no = p_txn;
  IF v_n <> 1 THEN v_sale := NULL; END IF;
  IF v_sale IS NOT NULL THEN
    v_ledger := v_created >= public.sale_ledger_cutover()
             OR EXISTS (SELECT 1 FROM public.stock_movements
                         WHERE business_id = p_business AND source_id = v_sale::text AND movement_type IN ('sale', 'sale_reversal'));
  END IF;
  v_source := coalesce(v_sale::text, p_txn);

  FOR r IN
    SELECT coalesce(o.product_id, n.product_id) AS product_id,
           coalesce(o.batch_id, n.batch_id)     AS batch_id,
           (coalesce(o.q, 0) - coalesce(n.q, 0))::int AS delta
      FROM (SELECT l.product_id, l.batch_id, coalesce(l.batch_id::text, '-') AS bkey, sum(l.qty) AS q
              FROM public.sale_stock_lines(p_old) l GROUP BY 1, 2, 3) o
      FULL JOIN (SELECT l.product_id, l.batch_id, coalesce(l.batch_id::text, '-') AS bkey, sum(l.qty) AS q
              FROM public.sale_stock_lines(p_new) l GROUP BY 1, 2, 3) n
        ON n.product_id = o.product_id AND n.bkey = o.bkey
     ORDER BY 1, 2 NULLS LAST
  LOOP
    CONTINUE WHEN r.delta = 0;
    IF r.delta < 0 THEN
      PERFORM public.sale_take_stock(p_business, r.product_id, r.batch_id, -r.delta, 'sale_correction', v_source, p_txn, NULL);
    ELSIF v_ledger THEN
      v_left := r.delta;
      FOR g IN
        SELECT m.batch_id, (-sum(m.quantity))::int AS taken
          FROM public.stock_movements m
         WHERE m.business_id = p_business AND m.product_id = r.product_id
           AND m.source_id = v_sale::text AND m.movement_type IN ('sale', 'sale_reversal')
           AND (r.batch_id IS NULL OR m.batch_id IS NOT DISTINCT FROM r.batch_id)
         GROUP BY m.batch_id
        HAVING -sum(m.quantity) > 0
         ORDER BY max(m.created_at) DESC, m.batch_id NULLS LAST
      LOOP
        EXIT WHEN v_left <= 0;
        v_give := least(v_left, g.taken);
        PERFORM public.sale_return_stock(p_business, r.product_id, g.batch_id, v_give, p_txn, v_source);
        v_left := v_left - v_give;
      END LOOP;
    ELSE
      PERFORM public.sale_return_stock(p_business, r.product_id, r.batch_id, r.delta, p_txn, v_source);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sale_take_stock(uuid, uuid, uuid, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_return_stock(uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_ledger_cutover() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sale_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_apply_stock_delta(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apply_sale_ledger() IS
  'AFTER INSERT on sales: takes each line''s stock through the stock ledger (sale_take_stock -> apply_stock_change). '
  'Skips held sales; never raises. Replaces apply_sale_stock_movement + apply_sale_batch_movement (carehub_20261224).';
COMMENT ON FUNCTION public.sale_take_stock(uuid, uuid, uuid, integer, text, text, text, text) IS
  'Takes up to p_qty units for a sale through apply_stock_change (named batch, else stock, else earliest-expiry batches '
  'for tracked products), journals the shortfall, never raises (falls back to a direct write with a WARNING).';
COMMENT ON FUNCTION public.sale_return_stock(uuid, uuid, uuid, integer, text, text) IS
  'Puts units back after a sale edit or delete through apply_stock_change (sale_reversal); never raises.';
-- The superseded functions are marked, not dropped (rollback). Guarded so the
-- file replays on a database that never had them.
DO $superseded$
BEGIN
  IF to_regprocedure('public.apply_sale_stock_movement()') IS NOT NULL THEN
    COMMENT ON FUNCTION public.apply_sale_stock_movement() IS
      'SUPERSEDED 2026-10-30 by apply_sale_ledger; no longer attached. Kept for rollback, then drop.';
  END IF;
  IF to_regprocedure('public.apply_sale_batch_movement()') IS NOT NULL THEN
    COMMENT ON FUNCTION public.apply_sale_batch_movement() IS
      'SUPERSEDED 2026-10-30 by apply_sale_ledger; no longer attached. Kept for rollback, then drop.';
  END IF;
END
$superseded$;

-- Swap the triggers last, in the same transaction.
DROP TRIGGER IF EXISTS sale_stock_movement ON public.sales;
DROP TRIGGER IF EXISTS sale_batch_movement ON public.sales;
DROP TRIGGER IF EXISTS sale_stock_ledger ON public.sales;
CREATE TRIGGER sale_stock_ledger AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_ledger();
