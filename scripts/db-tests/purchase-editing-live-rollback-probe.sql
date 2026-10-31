-- Rolled-back live probe for carehub_20261229_purchase_editing_and_analytics.
-- Paste into the Supabase SQL Editor (carehub project). It applies the migration, edits two real purchases as
-- the business owner, and ENDS WITH AN ERROR ('PROBE_RESULT ...') ON PURPOSE: the error undoes everything.
-- Read the results from that error message. Nothing persists. See docs/architecture/Purchases-Editing-and-Analytics.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- Purchases: authorised editing, centralised purchase history and analytics.
-- 2026-10-31. Docs: docs/architecture/Purchases-Editing-and-Analytics.md
-- Tests: scripts/db-tests/purchaseEditing.pglite.mjs (real Postgres, live
-- ledger snapshot).
-- STATUS: drafted, NOT applied. Apply as a tracked migration, then deploy the
-- app (the app degrades to "available once the database update is applied"
-- until then).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Written against the LIVE schema read on 2026-10-31:
--   * purchases(id, business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid,
--     balance, supply_date text, due_date text, status, notes, created_at timestamp, selling_price, expiry date,
--     batch, items jsonb). 13 rows: 8 recorded before the stock ledger (no stock_movements), 5 after (one
--     purchase_receipt movement per line, keyed by the form's line id, which items did not store).
--   * ONE policy on purchases, "purchases of own business", FOR ALL to public: any member of the business could
--     PATCH or DELETE any purchase directly. The only server-side writer is record_purchase_payment (definer).
--   * purchase_payments: amount > 0, kind in (payment, at_purchase, before_history).
--   * roles(business_id, name, permissions jsonb); is_business_owner(uuid) from carehub_20261216.
--   * Live data shows users typing product barcodes into "Batch no." (EAN-13 codes on 3 of 5 ledger purchases),
--     which is why lines now carry a barcode of their own.
--
-- WHAT THIS ADDS
--   1. purchases.edited_at, purchases.edit_count.
--   2. can_edit_purchases(business): the Owner (is_business_owner), or an active staff member whose custom role
--      has permissions.canEditPurchases = true. The same shape as can_manage_directory. Managers are not
--      authorised unless the Owner grants it.
--   3. purchase_items_normalized(purchase): the purchase's lines, each with a stable id, the product it stocked,
--      its batch and `ledger_base` (units it added outside the ledger, i.e. before it existed). Lines recorded
--      since the ledger are paired with their receipt movements; older lines are matched to a product by exact
--      name and assumed to have added their quantity (the same rule sales use for pre-ledger edits).
--   4. edit_purchase(): one transaction, reason required, audited (audit_log 'purchase.edited'). Changes the
--      supplier, dates, notes, lines (product, quantity, unit cost, selling price, batch, expiry, barcode) and the
--      amount paid. The server recomputes every total. Stock moves through apply_stock_change by the difference
--      per line (increases first, then decreases); taking back units that were already sold is refused with a
--      sentence naming the line. The supplier's "we owe" debt, the payment history and the products' cost (when
--      it still came from this purchase) follow.
--   5. get_purchase_for_edit(): the normalised lines with what each added to stock and the lowest quantity it
--      can be set to, so the screen can explain limits before saving.
--   6. A guard: signed-in clients can no longer UPDATE or DELETE purchases directly. Definer functions
--      (record_purchase_payment, edit_purchase) and the service role are unaffected; INSERT is unchanged.
--   7. purchase_payments: a 'correction' kind (signed amount) records a change to the amount paid made by an
--      edit, so the history still adds up to amount_paid.
--   8. Analytics, SECURITY INVOKER (purchases' RLS decides what the caller sees): purchase_line_rows /
--      purchase_lines_filtered (every line of every purchase, dated by its supply date), get_purchase_history,
--      get_purchase_summary, get_purchase_supplier_stats, get_purchase_product_stats.
--   9. get_purchases_page gains p_from / p_to (inclusive supply-date range) and p_supplier_key and returns the
--      edit columns. Same ownership check; p_month / p_year keep their old meaning for older clients.
--  10. Backfill: itemised purchases get line ids, products and ledger_base written into items (13 rows live).
--
-- SECURITY
--   * edit_purchase and get_purchase_for_edit are SECURITY DEFINER with a pinned search_path. They check
--     membership (current_business_ids) and then can_edit_purchases; anyone else gets "Purchase not found" /
--     "not allowed". Every statement is scoped to the purchase's business_id. auth.uid() is recorded as the actor;
--     the staff name is display only.
--   * Helpers that must not be called directly (can_edit_purchases, purchase_items_normalized, the guard) are
--     revoked from PUBLIC, anon and authenticated. Analytics functions are invoker and granted to authenticated
--     only; anon has no EXECUTE on anything here.
--   * The guard closes the hole that made "who may edit" a screen-only rule.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS purchases_guard_direct_write ON public.purchases;
--   DROP FUNCTION IF EXISTS public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text, integer, numeric),
--     public.get_purchase_for_edit(uuid), public.purchases_guard_direct_write(), public.can_edit_purchases(uuid),
--     public.purchase_items_normalized(public.purchases), public.purchase_line_received(uuid, uuid, text, uuid),
--     public.get_purchase_history(uuid, date, date, text, text, text, uuid, integer, integer),
--     public.get_purchase_summary(uuid, date, date, text, text, text, uuid),
--     public.get_purchase_supplier_stats(uuid, date, date, text, text, uuid),
--     public.get_purchase_product_stats(uuid, date, date, text, text, text, uuid, text, integer, integer),
--     public.purchase_lines_filtered(uuid, date, date, text, text, text, uuid),
--     public.purchase_line_rows(uuid, date, date), public.purchase_effective_date(text, timestamp),
--     public.purchase_product_key(text), public.purchase_num(text);
--   DROP FUNCTION public.get_purchases_page(uuid, text, text, text, integer, integer, date, date, text);
--   then re-run carehub_20261210_purchases_page_column_types.sql.
--   Correction rows must be removed before the purchase_payments checks can be restored.
--   items keep the extra keys (id, product_id, batch_id, ledger_base, barcode); readers ignore them.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Columns ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

-- ── 7. Payment corrections ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.purchase_payments DROP CONSTRAINT IF EXISTS purchase_payments_kind_check;
ALTER TABLE public.purchase_payments ADD CONSTRAINT purchase_payments_kind_check
  CHECK (kind IN ('payment', 'at_purchase', 'before_history', 'correction'));
ALTER TABLE public.purchase_payments DROP CONSTRAINT IF EXISTS purchase_payments_amount_check;
ALTER TABLE public.purchase_payments ADD CONSTRAINT purchase_payments_amount_check
  CHECK (amount > 0 OR (kind = 'correction' AND amount <> 0));

-- ── Small pure helpers ──────────────────────────────────────────────────────────────────────────────────────
-- A number typed into items (JSON number or string); anything else is 0.
CREATE OR REPLACE FUNCTION public.purchase_num(p text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p)::numeric ELSE 0 END
$$;

-- How a product is grouped across history: case, surrounding and repeated spaces ignored.
CREATE OR REPLACE FUNCTION public.purchase_product_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- The date a purchase belongs to: its supply date (what the user entered), else the day it was recorded.
-- supply_date is text; only a well-formed ISO date is trusted.
CREATE OR REPLACE FUNCTION public.purchase_effective_date(p_supply_date text, p_created_at timestamp)
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT CASE WHEN p_supply_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN p_supply_date::date
              ELSE p_created_at::date END
$$;

-- ── 2. Who may edit a purchase ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_edit_purchases(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_business_id IN (SELECT public.current_business_ids())
     AND (
       public.is_business_owner(p_business_id)
       OR EXISTS (
         SELECT 1 FROM public.staff s
           JOIN public.roles r ON r.business_id = s.business_id AND r.name = s.role
          WHERE s.business_id = p_business_id AND s.status = 'active'
            AND lower(s.email) = lower(btrim(auth.email()))
            AND (r.permissions ->> 'canEditPurchases') = 'true')
     )
$$;

-- ── 3. A purchase's lines, normalised ───────────────────────────────────────────────────────────────────────
-- Each line: { id, name, qty, cost, sell, batch, expiry, barcode, cat, product_id, batch_id, ledger_base }, plus
-- summary: true on the one line of a purchase recorded before line items were kept (several products averaged).
-- Units a line has added to stock = ledger_base + its movements for its product (purchase_line_received).
-- A line with ledger_base > 0 and no product is "locked": it added stock to a product we cannot identify.
CREATE OR REPLACE FUNCTION public.purchase_items_normalized(p public.purchases)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_items   jsonb;
  v_ledger  boolean;
  v_claimed text[] := '{}';
  v_out     jsonb := '[]'::jsonb;
  e         jsonb;
  n         integer := 0;
  v_line    text;
  v_mpid    uuid;
  v_mbatch  uuid;
  v_pid     uuid;
BEGIN
  IF jsonb_typeof(p.items) = 'array' AND jsonb_array_length(p.items) > 0 THEN
    v_items := p.items;
  ELSE
    -- Recorded before line items were kept: one summary line.
    v_items := jsonb_build_array(jsonb_build_object(
      'name', coalesce(nullif(btrim(p.product_name), ''), 'Items not recorded'),
      'qty', coalesce(p.quantity, 0), 'cost', coalesce(p.cost_price, 0),
      'batch', p.batch, 'expiry', p.expiry::text, 'summary', true));
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.stock_movements
                  WHERE business_id = p.business_id AND source_type = 'purchase' AND source_id = p.id::text)
    INTO v_ledger;

  FOR e IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    n := n + 1;
    IF jsonb_typeof(e) <> 'object' THEN CONTINUE; END IF;
    IF nullif(e ->> 'id', '') IS NOT NULL AND e ? 'ledger_base' THEN
      v_out := v_out || jsonb_build_array(e);
      v_claimed := v_claimed || (e ->> 'id');
      CONTINUE;
    END IF;

    v_line := NULL; v_mpid := NULL; v_mbatch := NULL;
    IF nullif(e ->> 'id', '') IS NOT NULL THEN
      -- Saved by a client that keeps line ids: the id is the receipt's source_line_id.
      SELECT sm.source_line_id, sm.product_id, sm.batch_id INTO v_line, v_mpid, v_mbatch
        FROM public.stock_movements sm
       WHERE sm.business_id = p.business_id AND sm.source_type = 'purchase' AND sm.source_id = p.id::text
         AND sm.source_line_id = e ->> 'id'
       ORDER BY sm.created_at, sm.id LIMIT 1;
    ELSE
      -- Pair with the first unclaimed receipt of the same product name and quantity.
      SELECT sm.source_line_id, sm.product_id, sm.batch_id INTO v_line, v_mpid, v_mbatch
        FROM public.stock_movements sm JOIN public.products pr ON pr.id = sm.product_id
       WHERE sm.business_id = p.business_id AND sm.source_type = 'purchase' AND sm.source_id = p.id::text
         AND sm.movement_type = 'purchase_receipt'
         AND NOT (sm.source_line_id = ANY (v_claimed))
         AND public.purchase_product_key(pr.name) = public.purchase_product_key(e ->> 'name')
         AND sm.quantity = public.purchase_num(e ->> 'qty')
       ORDER BY sm.created_at, sm.id LIMIT 1;
    END IF;

    IF v_line IS NOT NULL THEN
      e := e || jsonb_build_object('id', v_line, 'product_id', v_mpid, 'batch_id', v_mbatch, 'ledger_base', 0);
    ELSE
      v_pid := NULL;
      IF (e ->> 'product_id') ~ '^[0-9a-fA-F-]{36}$' THEN
        SELECT id INTO v_pid FROM public.products WHERE id = (e ->> 'product_id')::uuid AND business_id = p.business_id;
      END IF;
      IF v_pid IS NULL AND NOT coalesce((e ->> 'summary')::boolean, false) THEN
        SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO v_pid
          FROM public.products
         WHERE business_id = p.business_id AND public.purchase_product_key(name) = public.purchase_product_key(e ->> 'name');
      END IF;
      e := e || jsonb_build_object(
        'id', coalesce(nullif(e ->> 'id', ''), 'legacy-' || n),
        'product_id', v_pid,
        'batch_id', NULL,
        -- Before the ledger, the line's quantity went straight onto the product. Since the ledger, a line with
        -- no receipt added nothing (its receipt failed and the user was told).
        'ledger_base', CASE WHEN v_ledger OR nullif(e ->> 'id', '') IS NOT NULL THEN 0
                            ELSE greatest(trunc(public.purchase_num(e ->> 'qty')), 0)::int END);
    END IF;
    v_claimed := v_claimed || (e ->> 'id');
    v_out := v_out || jsonb_build_array(e);
  END LOOP;
  RETURN v_out;
END $$;

-- Units a line has added through the ledger for one product (receipts and edit corrections).
CREATE OR REPLACE FUNCTION public.purchase_line_received(p_business_id uuid, p_purchase_id uuid, p_line_id text, p_product_id uuid)
RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce(sum(quantity), 0)::int FROM public.stock_movements
   WHERE business_id = p_business_id AND source_id = p_purchase_id::text AND source_line_id = p_line_id
     AND product_id = p_product_id AND source_type IN ('purchase', 'purchase_edit')
$$;

-- ── 5. What the edit screen needs ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_purchase_for_edit(p_purchase_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_p   public.purchases%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
  e     jsonb;
  v_pid uuid;
  v_recv integer;
  v_stock integer;
  v_pname text;
  v_pbarcode text;
  v_mode text;
BEGIN
  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id;
  IF NOT FOUND OR v_p.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Purchase not found.' USING ERRCODE = 'P0002';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(public.purchase_items_normalized(v_p)) LOOP
    v_pid := nullif(e ->> 'product_id', '')::uuid;
    v_recv := 0; v_stock := NULL; v_pname := NULL; v_pbarcode := NULL; v_mode := NULL;
    IF v_pid IS NOT NULL THEN
      SELECT stock, name, nullif(btrim(barcode), ''), tracking_mode INTO v_stock, v_pname, v_pbarcode, v_mode
        FROM public.products WHERE id = v_pid;
      v_recv := coalesce((e ->> 'ledger_base')::int, 0) + public.purchase_line_received(v_p.business_id, v_p.id, e ->> 'id', v_pid);
    END IF;
    v_out := v_out || jsonb_build_array(e || jsonb_build_object(
      'received', v_recv,
      'product_name', v_pname,
      'product_stock', v_stock,
      'product_barcode', v_pbarcode,
      'tracking_mode', v_mode,
      'locked', v_pid IS NULL AND coalesce((e ->> 'ledger_base')::int, 0) > 0,
      -- The lowest quantity the line can keep on the same product: units already sold cannot be taken back.
      'min_qty', CASE WHEN v_pid IS NULL THEN NULL ELSE greatest(v_recv - greatest(coalesce(v_stock, 0), 0), 1) END));
  END LOOP;
  RETURN jsonb_build_object(
    'purchase_id', v_p.id,
    'items', v_out,
    'itemised', jsonb_typeof(v_p.items) = 'array' AND jsonb_array_length(v_p.items) > 0,
    'can_edit', public.can_edit_purchases(v_p.business_id));
END $$;

-- ── 4. edit_purchase ────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text);
CREATE OR REPLACE FUNCTION public.edit_purchase(
  p_purchase_id uuid,
  p_supplier_name text,
  p_supply_date date,
  p_due_date date,
  p_notes text,
  p_items jsonb,
  p_amount_paid numeric,
  p_reason text,
  p_staff_name text DEFAULT NULL,
  -- What the screen loaded: when either has moved since (another edit, or a payment recorded meanwhile), the
  -- edit is refused rather than overwriting it. NULL skips the check (older callers).
  p_expected_edit_count integer DEFAULT NULL,
  p_expected_amount_paid numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_p        public.purchases%ROWTYPE;
  v_biz      uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_supplier text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_staff    text := nullif(btrim(coalesce(p_staff_name, '')), '');
  v_old      jsonb;
  v_old_map  jsonb := '{}'::jsonb;
  v_new      jsonb := '[]'::jsonb;
  v_ops      jsonb := '[]'::jsonb;
  v_seen     text[] := '{}';
  v_touched  uuid[] := '{}';
  v_edit_no  integer;
  v_created  integer := 0;
  e          jsonb;
  o          jsonb;
  op         jsonb;
  i          integer := 0;
  v_id       text;
  v_name     text;
  v_qty      numeric;
  v_cost     numeric;
  v_sell     numeric;
  v_batch    text;
  v_expiry   date;
  v_barcode  text;
  v_cat      text;
  v_pid      uuid;
  v_old_pid  uuid;
  v_old_recv integer;
  v_old_base integer;
  v_batch_id uuid;
  v_mode     text;
  v_pname    text;
  v_pbarcode text;
  v_pcost    numeric;
  v_other    text;
  v_stock    integer;
  v_base     integer;
  v_total    numeric := 0;
  v_units    integer := 0;
  v_paid     numeric;
  v_old_paid numeric;
  v_balance  numeric;
  v_status   text;
  v_debt     public.debts%ROWTYPE;
  v_label    text;
  v_canon_old jsonb;
  v_canon_new jsonb;
  v_result   public.purchases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to edit purchases.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Say why the purchase is being changed (3 to 300 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_p FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND OR v_p.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Purchase not found.' USING ERRCODE = 'P0002';
  END IF;
  v_biz := v_p.business_id;
  IF NOT public.can_edit_purchases(v_biz) THEN
    RAISE EXCEPTION 'You are not allowed to edit purchases. Ask the Owner for the "Edit purchases" permission.' USING ERRCODE = '42501';
  END IF;
  IF (p_expected_edit_count IS NOT NULL AND p_expected_edit_count <> coalesce(v_p.edit_count, 0))
     OR (p_expected_amount_paid IS NOT NULL AND round(p_expected_amount_paid, 2) <> round(coalesce(v_p.amount_paid, 0), 2)) THEN
    RAISE EXCEPTION 'This purchase was changed while you were editing it (another edit or a payment). Close it, open it again and redo your change.'
      USING ERRCODE = '22023';
  END IF;

  -- Header
  IF v_supplier IS NULL OR length(v_supplier) > 200 THEN
    RAISE EXCEPTION 'Enter the supplier name (up to 200 characters).' USING ERRCODE = '22023';
  END IF;
  IF p_supply_date IS NULL OR p_supply_date > current_date + 1 THEN
    RAISE EXCEPTION 'Enter a supply date that is not in the future.' USING ERRCODE = '22023';
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'Notes can be up to 1000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A purchase needs at least one item.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'A purchase can have up to 500 items.' USING ERRCODE = '22023';
  END IF;

  v_old := public.purchase_items_normalized(v_p);
  FOR o IN SELECT value FROM jsonb_array_elements(v_old) LOOP
    v_old_map := v_old_map || jsonb_build_object(o ->> 'id', o);
  END LOOP;
  v_edit_no := coalesce(v_p.edit_count, 0) + 1;
  v_label := 'Purchase from ' || v_supplier || ' edited: ' || v_reason;

  -- ── Lines: validate, resolve the product, plan the stock change ──
  FOR e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    i := i + 1;
    IF jsonb_typeof(e) <> 'object' THEN
      RAISE EXCEPTION 'Line %: not a valid item.', i USING ERRCODE = '22023';
    END IF;
    v_id := nullif(btrim(coalesce(e ->> 'id', '')), '');
    v_name := nullif(btrim(coalesce(e ->> 'name', '')), '');
    v_qty := public.purchase_num(e ->> 'qty');
    v_cost := round(public.purchase_num(e ->> 'cost'), 2);
    v_sell := CASE WHEN public.purchase_num(e ->> 'sell') > 0 THEN round(public.purchase_num(e ->> 'sell'), 2) END;
    v_batch := nullif(btrim(coalesce(e ->> 'batch', '')), '');
    v_barcode := nullif(btrim(coalesce(e ->> 'barcode', '')), '');
    v_cat := coalesce(nullif(btrim(coalesce(e ->> 'cat', '')), ''), 'Medicines');
    BEGIN
      v_expiry := nullif(btrim(coalesce(e ->> 'expiry', '')), '')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Line %: the expiry date is not a valid date.', i USING ERRCODE = '22023';
    END;

    IF v_id IS NULL OR length(v_id) > 64 OR v_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Line %: the line is missing its id. Reload the purchase and try again.', i USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_id;
    IF v_name IS NULL OR length(v_name) > 200 THEN
      RAISE EXCEPTION 'Line %: enter the product name.', i USING ERRCODE = '22023';
    END IF;
    IF v_qty <= 0 OR v_qty <> trunc(v_qty) OR v_qty > 1000000 THEN
      RAISE EXCEPTION 'Line % (%): the quantity must be a whole number above zero.', i, v_name USING ERRCODE = '22023';
    END IF;
    IF v_cost <= 0 OR v_cost > 1000000000 THEN
      RAISE EXCEPTION 'Line % (%): enter the unit cost.', i, v_name USING ERRCODE = '22023';
    END IF;
    IF (v_batch IS NOT NULL AND length(v_batch) > 100) OR (v_barcode IS NOT NULL AND length(v_barcode) > 64) THEN
      RAISE EXCEPTION 'Line % (%): the batch number or barcode is too long.', i, v_name USING ERRCODE = '22023';
    END IF;

    o := v_old_map -> v_id;
    v_old_pid := nullif(o ->> 'product_id', '')::uuid;
    v_old_base := coalesce((o ->> 'ledger_base')::int, 0);
    v_old_recv := CASE WHEN v_old_pid IS NULL THEN 0
                       ELSE v_old_base + public.purchase_line_received(v_biz, v_p.id, v_id, v_old_pid) END;
    v_batch_id := nullif(o ->> 'batch_id', '')::uuid;
    IF v_old_pid IS NOT NULL AND v_batch_id IS NULL THEN
      SELECT batch_id INTO v_batch_id FROM public.stock_movements
       WHERE business_id = v_biz AND source_id = v_p.id::text AND source_line_id = v_id AND product_id = v_old_pid
         AND batch_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1;
    END IF;

    -- A line that added stock to a product nobody can identify (recorded before the ledger under a name that
    -- matches no product) keeps its product and quantity; its prices, batch text and dates can still change.
    IF o IS NOT NULL AND v_old_pid IS NULL AND v_old_base > 0 THEN
      IF public.purchase_product_key(v_name) <> public.purchase_product_key(o ->> 'name')
         OR v_qty <> public.purchase_num(o ->> 'qty') THEN
        RAISE EXCEPTION 'Line % (%) is not linked to a product in Inventory, so its product and quantity cannot be changed here. Correct the stock in Inventory instead.', i, o ->> 'name'
          USING ERRCODE = '22023';
      END IF;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'name', v_name, 'qty', v_qty::int, 'cost', v_cost, 'sell', v_sell, 'batch', v_batch,
        'expiry', v_expiry::text, 'barcode', v_barcode, 'cat', v_cat,
        'product_id', NULL, 'batch_id', NULL, 'ledger_base', v_old_base)
        || CASE WHEN coalesce((o ->> 'summary')::boolean, false) THEN '{"summary": true}'::jsonb ELSE '{}'::jsonb END);
      v_total := v_total + round(v_qty * v_cost, 2);
      v_units := v_units + v_qty::int;
      CONTINUE;
    END IF;

    -- Which product does the line stock now? An explicit product, else the barcode, else the exact name,
    -- else a new product (as recording a purchase does).
    v_pid := NULL;
    IF (e ->> 'product_id') ~ '^[0-9a-fA-F-]{36}$' THEN
      SELECT id INTO v_pid FROM public.products WHERE id = (e ->> 'product_id')::uuid AND business_id = v_biz;
      IF v_pid IS NULL THEN
        RAISE EXCEPTION 'Line % (%): that product is no longer in Inventory. Pick it again.', i, v_name USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_pid IS NULL AND v_barcode IS NOT NULL THEN
      SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO v_pid
        FROM public.products WHERE business_id = v_biz AND btrim(barcode) = v_barcode;
    END IF;
    IF v_pid IS NULL THEN
      SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO v_pid
        FROM public.products WHERE business_id = v_biz AND public.purchase_product_key(name) = public.purchase_product_key(v_name);
    END IF;
    IF v_pid IS NULL THEN
      INSERT INTO public.products (business_id, name, category, price, cost_price, stock, reorder_level, list_on_carefind, barcode)
      VALUES (v_biz, v_name, v_cat, coalesce(v_sell, ceil(v_cost * 1.5)), v_cost, 0, 5, true, NULL)
      RETURNING id INTO v_pid;
      v_created := v_created + 1;
    END IF;

    SELECT name, nullif(btrim(barcode), ''), tracking_mode, cost_price, stock
      INTO v_pname, v_pbarcode, v_mode, v_pcost, v_stock
      FROM public.products WHERE id = v_pid FOR UPDATE;
    v_name := v_pname;

    -- Barcode: kept on the product when it has none and no other product uses it.
    IF v_barcode IS NOT NULL THEN
      IF v_pbarcode IS NOT NULL AND v_pbarcode <> v_barcode THEN
        RAISE EXCEPTION 'Line % (%): this product already has barcode %. Change barcodes in Inventory.', i, v_name, v_pbarcode USING ERRCODE = '22023';
      END IF;
      SELECT name INTO v_other FROM public.products
       WHERE business_id = v_biz AND id <> v_pid AND btrim(barcode) = v_barcode LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Line % (%): barcode % belongs to %.', i, v_name, v_barcode, v_other USING ERRCODE = '22023';
      END IF;
      IF v_pbarcode IS NULL THEN
        UPDATE public.products SET barcode = v_barcode WHERE id = v_pid;
      END IF;
    END IF;

    IF v_mode <> 'none' AND v_batch IS NULL THEN
      RAISE EXCEPTION 'Line % (%): this product is tracked by batch; enter its batch number.', i, v_name USING ERRCODE = '22023';
    END IF;
    IF v_mode = 'batch_expiry' AND v_expiry IS NULL THEN
      RAISE EXCEPTION 'Line % (%): this product is tracked by batch and expiry; enter the expiry date.', i, v_name USING ERRCODE = '22023';
    END IF;

    v_base := 0;
    IF v_old_pid IS NOT NULL AND v_old_pid = v_pid THEN
      -- Same product: move the difference, into or out of the batch this line created.
      v_base := v_old_base;
      IF v_batch_id IS NOT NULL THEN
        UPDATE public.stock_batches SET batch_number = v_batch, expiry_date = v_expiry
         WHERE id = v_batch_id AND business_id = v_biz
           AND (batch_number IS DISTINCT FROM v_batch OR expiry_date IS DISTINCT FROM v_expiry);
      END IF;
      IF v_qty::int <> v_old_recv THEN
        v_ops := v_ops || jsonb_build_array(jsonb_build_object(
          'line', i, 'line_id', v_id, 'name', v_name, 'product_id', v_pid, 'delta', v_qty::int - v_old_recv,
          'batch_id', v_batch_id, 'new_batch', v_batch, 'new_expiry', v_expiry, 'kind', 'adjust',
          'received', v_old_recv, 'type', 'correction'));
      END IF;
      -- The product's cost is corrected when it still came from this line.
      IF o IS NOT NULL AND v_cost <> round(public.purchase_num(o ->> 'cost'), 2)
         AND round(coalesce(v_pcost, 0), 2) = round(public.purchase_num(o ->> 'cost'), 2) THEN
        UPDATE public.products SET cost_price = v_cost WHERE id = v_pid;
      END IF;
    ELSE
      -- New line, or the line now stocks another product: take back what it added, receive into the new one.
      IF v_old_pid IS NOT NULL AND v_old_recv <> 0 THEN
        v_ops := v_ops || jsonb_build_array(jsonb_build_object(
          'line', i, 'line_id', v_id, 'name', o ->> 'name', 'product_id', v_old_pid, 'delta', -v_old_recv,
          'batch_id', v_batch_id, 'kind', 'reverse', 'received', v_old_recv, 'type', 'correction'));
      END IF;
      v_batch_id := NULL;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object(
        'line', i, 'line_id', v_id, 'name', v_name, 'product_id', v_pid, 'delta', v_qty::int,
        'batch_id', NULL, 'new_batch', v_batch, 'new_expiry', v_expiry, 'kind', 'receive', 'received', 0,
        'type', 'purchase_receipt'));
    END IF;

    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'name', v_name, 'qty', v_qty::int, 'cost', v_cost, 'sell', v_sell, 'batch', v_batch,
      'expiry', v_expiry::text, 'barcode', v_barcode, 'cat', v_cat,
      'product_id', v_pid, 'batch_id', v_batch_id, 'ledger_base', v_base));
    v_total := v_total + round(v_qty * v_cost, 2);
    v_units := v_units + v_qty::int;
  END LOOP;

  -- Lines removed by the edit give back what they added.
  FOR o IN SELECT value FROM jsonb_array_elements(v_old) LOOP
    CONTINUE WHEN (o ->> 'id') = ANY (v_seen);
    v_old_pid := nullif(o ->> 'product_id', '')::uuid;
    v_old_base := coalesce((o ->> 'ledger_base')::int, 0);
    IF v_old_pid IS NULL THEN
      IF v_old_base > 0 THEN
        RAISE EXCEPTION '% is not linked to a product in Inventory, so it cannot be removed here. Correct the stock in Inventory instead.', o ->> 'name'
          USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    v_old_recv := v_old_base + public.purchase_line_received(v_biz, v_p.id, o ->> 'id', v_old_pid);
    CONTINUE WHEN v_old_recv = 0;
    v_batch_id := nullif(o ->> 'batch_id', '')::uuid;
    IF v_batch_id IS NULL THEN
      SELECT batch_id INTO v_batch_id FROM public.stock_movements
       WHERE business_id = v_biz AND source_id = v_p.id::text AND source_line_id = o ->> 'id' AND product_id = v_old_pid
         AND batch_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1;
    END IF;
    v_ops := v_ops || jsonb_build_array(jsonb_build_object(
      'line', NULL, 'line_id', o ->> 'id', 'name', o ->> 'name', 'product_id', v_old_pid, 'delta', -v_old_recv,
      'batch_id', v_batch_id, 'kind', 'remove', 'received', v_old_recv, 'type', 'correction'));
  END LOOP;

  -- Money
  v_total := round(v_total, 2);
  v_old_paid := round(coalesce(v_p.amount_paid, 0), 2);
  v_paid := CASE WHEN p_amount_paid IS NULL THEN v_old_paid ELSE round(p_amount_paid, 2) END;
  IF v_paid < 0 THEN
    RAISE EXCEPTION 'The amount paid cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF v_paid > v_total THEN
    RAISE EXCEPTION 'The amount paid (%) is more than the new total (%). Lower the amount paid, or record the refund from the supplier first.',
      to_char(v_paid, 'FM999,999,999,990.00'), to_char(v_total, 'FM999,999,999,990.00') USING ERRCODE = '22023';
  END IF;
  v_balance := greatest(v_total - v_paid, 0);
  v_status := CASE WHEN v_balance <= 0 THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'pending' END;

  -- Nothing changed: say so and write nothing.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', public.purchase_product_key(x ->> 'name'),
           'qty', public.purchase_num(x ->> 'qty'), 'cost', round(public.purchase_num(x ->> 'cost'), 2),
           'sell', CASE WHEN public.purchase_num(x ->> 'sell') > 0 THEN round(public.purchase_num(x ->> 'sell'), 2) END,
           'batch', nullif(btrim(coalesce(x ->> 'batch', '')), ''), 'expiry', nullif(x ->> 'expiry', ''),
           'barcode', nullif(btrim(coalesce(x ->> 'barcode', '')), ''), 'product_id', x ->> 'product_id') ORDER BY n), '[]')
    INTO v_canon_old FROM jsonb_array_elements(v_old) WITH ORDINALITY t(x, n);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', public.purchase_product_key(x ->> 'name'),
           'qty', public.purchase_num(x ->> 'qty'), 'cost', round(public.purchase_num(x ->> 'cost'), 2),
           'sell', CASE WHEN public.purchase_num(x ->> 'sell') > 0 THEN round(public.purchase_num(x ->> 'sell'), 2) END,
           'batch', nullif(btrim(coalesce(x ->> 'batch', '')), ''), 'expiry', nullif(x ->> 'expiry', ''),
           'barcode', nullif(btrim(coalesce(x ->> 'barcode', '')), ''), 'product_id', x ->> 'product_id') ORDER BY n), '[]')
    INTO v_canon_new FROM jsonb_array_elements(v_new) WITH ORDINALITY t(x, n);
  IF jsonb_array_length(v_ops) = 0 AND v_created = 0 AND v_canon_old = v_canon_new
     AND btrim(v_p.supplier_name) = v_supplier
     AND public.purchase_effective_date(v_p.supply_date, v_p.created_at) = p_supply_date
     AND coalesce(nullif(v_p.due_date, ''), '') = coalesce(p_due_date::text, '')
     AND coalesce(nullif(btrim(v_p.notes), ''), '') = coalesce(v_notes, '')
     AND v_paid = v_old_paid THEN
    RETURN jsonb_build_object('purchase', to_jsonb(v_p), 'unchanged', true, 'products', '[]'::jsonb, 'stock_changes', '[]'::jsonb);
  END IF;

  -- ── Stock: increases first, so moving units between lines of one product never dips below zero ──
  FOR op IN SELECT x FROM jsonb_array_elements(v_ops) x ORDER BY ((x ->> 'delta')::int < 0), (x ->> 'line')::int NULLS LAST LOOP
    v_pid := (op ->> 'product_id')::uuid;
    v_batch_id := nullif(op ->> 'batch_id', '')::uuid;
    SELECT tracking_mode INTO v_mode FROM public.products WHERE id = v_pid;
    -- A received line gets a batch of its own when it names one, as receive_stock does. An increase on a line
    -- that has no batch gets one only when the product is tracked (a batch holding just the extra units of an
    -- untracked product would mislead).
    IF (op ->> 'delta')::int > 0 AND v_batch_id IS NULL
       AND (op ->> 'kind' = 'receive' OR v_mode <> 'none')
       AND (nullif(op ->> 'new_batch', '') IS NOT NULL OR nullif(op ->> 'new_expiry', '') IS NOT NULL) THEN
      INSERT INTO public.stock_batches (business_id, product_id, product_name, batch_number, quantity, expiry_date,
                                        date_received, supplier_source, status, received_by, location_id)
      SELECT v_biz, v_pid, pr.name, nullif(op ->> 'new_batch', ''), 0, nullif(op ->> 'new_expiry', '')::date,
             p_supply_date, v_supplier, 'available', auth.email(), NULL
        FROM public.products pr WHERE pr.id = v_pid
      RETURNING id INTO v_batch_id;
      -- Remember the batch on the line so later edits move the same batch.
      v_new := (SELECT jsonb_agg(CASE WHEN x ->> 'id' = op ->> 'line_id' AND x ->> 'product_id' = op ->> 'product_id'
                                      THEN x || jsonb_build_object('batch_id', v_batch_id) ELSE x END ORDER BY n)
                  FROM jsonb_array_elements(v_new) WITH ORDINALITY t(x, n));
    END IF;
    BEGIN
      PERFORM public.apply_stock_change(
        v_biz, v_pid, (op ->> 'delta')::int, op ->> 'type', v_batch_id,
        'purchase_edit', v_p.id::text, op ->> 'line_id', v_label,
        'purchase_edit:' || v_p.id || ':' || v_edit_no || ':' || (op ->> 'line_id') || ':' || (op ->> 'kind') || ':' || v_pid,
        NULL);
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM LIKE 'INSUFFICIENT_STOCK%' THEN
        SELECT stock INTO v_stock FROM public.products WHERE id = v_pid;
        IF op ->> 'kind' = 'adjust' THEN
          RAISE EXCEPTION 'Line % (%): only % in stock now, so this purchase cannot take back % units. The lowest quantity you can set is %.',
            op ->> 'line', op ->> 'name', greatest(coalesce(v_stock, 0), 0), -(op ->> 'delta')::int,
            greatest((op ->> 'received')::int - greatest(coalesce(v_stock, 0), 0), 1) USING ERRCODE = '22023';
        ELSE
          RAISE EXCEPTION '%: only % of the % units this purchase added are still in stock, so the line cannot be removed or moved to another product.',
            op ->> 'name', greatest(coalesce(v_stock, 0), 0), (op ->> 'received')::int USING ERRCODE = '22023';
        END IF;
      ELSIF SQLERRM LIKE 'BATCH_REQUIRED%' THEN
        RAISE EXCEPTION '%: this product is tracked by batch, and the units this purchase added have no batch to take them from. Correct the stock in Stock & Batches.', op ->> 'name'
          USING ERRCODE = '22023';
      END IF;
      RAISE;
    END;
    v_touched := v_touched || v_pid;
  END LOOP;

  -- ── The purchase ──
  UPDATE public.purchases SET
    supplier_name = v_supplier,
    supply_date = p_supply_date::text,
    due_date = coalesce(p_due_date::text, ''),
    notes = coalesce(v_notes, ''),
    items = v_new,
    product_name = (SELECT string_agg(x ->> 'name', ', ' ORDER BY n) FROM jsonb_array_elements(v_new) WITH ORDINALITY t(x, n)),
    quantity = v_units,
    cost_price = CASE WHEN v_units > 0 THEN round(v_total / v_units, 2) ELSE 0 END,
    total_cost = v_total,
    amount_paid = v_paid,
    balance = v_balance,
    status = v_status,
    expiry = (SELECT min(nullif(x ->> 'expiry', '')::date) FROM jsonb_array_elements(v_new) x),
    batch = (SELECT string_agg(DISTINCT x ->> 'batch', ', ') FROM jsonb_array_elements(v_new) x WHERE nullif(x ->> 'batch', '') IS NOT NULL),
    edited_at = now(),
    edit_count = v_edit_no
  WHERE id = v_p.id
  RETURNING * INTO v_result;

  -- ── Payments: a changed amount paid is recorded as a correction, so history adds up to amount_paid ──
  IF btrim(v_p.supplier_name) <> v_supplier THEN
    UPDATE public.purchase_payments SET supplier_name = v_supplier WHERE purchase_id = v_p.id AND business_id = v_biz;
  END IF;
  IF v_paid <> v_old_paid THEN
    INSERT INTO public.purchase_payments (business_id, purchase_id, supplier_name, amount, method, kind, paid_on, note,
                                          balance_after, recorded_by, staff_name)
    VALUES (v_biz, v_p.id, v_supplier, v_paid - v_old_paid, 'Other', 'correction', current_date,
            left('Corrected in an edit: ' || v_reason, 300), v_balance, auth.uid(), left(v_staff, 120));
  END IF;

  -- ── The "we owe" debt follows the purchase ──
  SELECT * INTO v_debt FROM public.debts
   WHERE business_id = v_biz AND source = 'purchase' AND source_ref = v_p.id::text
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.debts
       SET amount = v_total, amount_paid = v_paid, balance = v_balance,
           status = CASE WHEN v_balance <= 0 THEN 'paid' ELSE 'pending' END,
           party_name = v_supplier, due_date = coalesce(p_due_date::text, '')
     WHERE id = v_debt.id;
  ELSIF v_balance > 0 THEN
    INSERT INTO public.debts (business_id, direction, party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref)
    VALUES (v_biz, 'we_owe', v_supplier, v_total, v_paid, v_balance, coalesce(p_due_date::text, ''), 'pending',
            'Purchase: ' || (v_new -> 0 ->> 'name') || CASE WHEN jsonb_array_length(v_new) > 1 THEN ' +' || (jsonb_array_length(v_new) - 1) || ' more' ELSE '' END
              || ': Due: ' || coalesce(p_due_date::text, 'Not set'),
            'purchase', v_p.id::text);
  END IF;

  -- ── Audit ──
  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), CASE WHEN public.is_business_owner(v_biz) THEN 'owner' ELSE 'staff' END, v_biz, 'purchase.edited', 'purchase', v_p.id,
    jsonb_build_object(
      'reason', v_reason, 'staff_name', v_staff, 'edit_no', v_edit_no,
      'before', jsonb_build_object('supplier_name', v_p.supplier_name, 'supply_date', v_p.supply_date, 'due_date', v_p.due_date,
                                   'notes', v_p.notes, 'items', v_old, 'total_cost', v_p.total_cost, 'amount_paid', v_p.amount_paid,
                                   'balance', v_p.balance),
      'after', jsonb_build_object('supplier_name', v_supplier, 'supply_date', p_supply_date, 'due_date', p_due_date,
                                  'notes', v_notes, 'items', v_new, 'total_cost', v_total, 'amount_paid', v_paid, 'balance', v_balance),
      'stock', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', x ->> 'product_id', 'name', x ->> 'name', 'change', (x ->> 'delta')::int)), '[]')
                  FROM jsonb_array_elements(v_ops) x),
      'products_created', v_created));

  RETURN jsonb_build_object(
    'purchase', to_jsonb(v_result),
    'unchanged', false,
    'created_products', v_created,
    'stock_changes', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', x ->> 'product_id', 'name', x ->> 'name', 'change', (x ->> 'delta')::int)), '[]')
                        FROM jsonb_array_elements(v_ops) x),
    -- Every product the edit touched, as stored now, so the screen updates Inventory and POS without a reload.
    'products', (SELECT coalesce(jsonb_agg(to_jsonb(pr)), '[]') FROM public.products pr
                  WHERE pr.business_id = v_biz
                    AND pr.id IN (SELECT (x ->> 'product_id')::uuid FROM jsonb_array_elements(v_new) x WHERE x ->> 'product_id' IS NOT NULL
                                  UNION SELECT unnest(v_touched))));
END $$;

-- ── 6. Guard on direct writes ───────────────────────────────────────────────────────────────────────────────
-- current_user is 'authenticated' / 'anon' for a PostgREST request and the function owner inside SECURITY
-- DEFINER functions, so record_purchase_payment, edit_purchase and the service role pass untouched.
CREATE OR REPLACE FUNCTION public.purchases_guard_direct_write()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Purchases are changed with Edit purchase, which keeps stock, payments and debts in step.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS purchases_guard_direct_write ON public.purchases;
CREATE TRIGGER purchases_guard_direct_write BEFORE UPDATE OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchases_guard_direct_write();

-- ── 8. Analytics ────────────────────────────────────────────────────────────────────────────────────────────
-- Every line of every purchase in [p_from, p_to] (inclusive, by supply date). A purchase recorded before line
-- items were kept is one summary line whose total is the purchase total.
CREATE OR REPLACE FUNCTION public.purchase_line_rows(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (purchase_id uuid, purchase_date date, recorded_at timestamptz, supplier_name text, supplier_key text,
               line_no integer, line_id text, product_id uuid, product_key text, item_name text, qty numeric,
               unit_cost numeric, line_total numeric, barcode text, batch text, expiry text, itemised boolean,
               purchase_total numeric, purchase_paid numeric, purchase_balance numeric, purchase_status text,
               edited_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  WITH f AS (
    SELECT pu.*, public.purchase_effective_date(pu.supply_date, pu.created_at) AS pdate,
           (jsonb_typeof(pu.items) = 'array' AND jsonb_array_length(pu.items) > 0) AS has_items
      FROM public.purchases pu
     WHERE pu.business_id = p_business_id
  )
  SELECT f.id, f.pdate, (f.created_at AT TIME ZONE 'UTC'), btrim(f.supplier_name), lower(btrim(f.supplier_name)),
         l.n::int,
         coalesce(nullif(l.e ->> 'id', ''), 'legacy-' || l.n),
         CASE WHEN (l.e ->> 'product_id') ~ '^[0-9a-fA-F-]{36}$' THEN (l.e ->> 'product_id')::uuid END,
         public.purchase_product_key(l.e ->> 'name'),
         coalesce(nullif(btrim(l.e ->> 'name'), ''), 'Item'),
         public.purchase_num(l.e ->> 'qty'),
         public.purchase_num(l.e ->> 'cost'),
         CASE WHEN f.has_items THEN round(public.purchase_num(l.e ->> 'qty') * public.purchase_num(l.e ->> 'cost'), 2)
              ELSE coalesce(f.total_cost, 0) END,
         nullif(btrim(coalesce(l.e ->> 'barcode', '')), ''),
         nullif(btrim(coalesce(l.e ->> 'batch', '')), ''),
         nullif(l.e ->> 'expiry', ''),
         f.has_items AND NOT coalesce((l.e ->> 'summary')::boolean, false),
         coalesce(f.total_cost, 0), coalesce(f.amount_paid, 0), greatest(coalesce(f.balance, 0), 0), f.status,
         f.edited_at
    FROM f
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN f.has_items THEN f.items
                ELSE jsonb_build_array(jsonb_build_object('name', coalesce(nullif(btrim(f.product_name), ''), 'Items not recorded'),
                       'qty', coalesce(f.quantity, 0), 'cost', coalesce(f.cost_price, 0), 'batch', f.batch, 'expiry', f.expiry::text)) END
         ) WITH ORDINALITY AS l(e, n)
   WHERE jsonb_typeof(l.e) = 'object'
     AND (p_from IS NULL OR f.pdate >= p_from)
     AND (p_to IS NULL OR f.pdate <= p_to)
$$;

-- The same lines, narrowed by search (product, supplier, barcode or batch), supplier and product.
-- A product is matched by id or by name, so lines saved before products were recorded on them still count.
CREATE OR REPLACE FUNCTION public.purchase_lines_filtered(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_search text DEFAULT NULL,
  p_supplier_key text DEFAULT NULL, p_product_key text DEFAULT NULL, p_product_id uuid DEFAULT NULL)
RETURNS TABLE (purchase_id uuid, purchase_date date, recorded_at timestamptz, supplier_name text, supplier_key text,
         line_no integer, line_id text, product_id uuid, product_key text, item_name text, qty numeric,
         unit_cost numeric, line_total numeric, barcode text, batch text, expiry text, itemised boolean,
         purchase_total numeric, purchase_paid numeric, purchase_balance numeric, purchase_status text,
         edited_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT r.* FROM public.purchase_line_rows(p_business_id, p_from, p_to) r
   WHERE (nullif(btrim(coalesce(p_supplier_key, '')), '') IS NULL OR r.supplier_key = lower(btrim(p_supplier_key)))
     AND ((p_product_id IS NULL AND nullif(btrim(coalesce(p_product_key, '')), '') IS NULL)
          OR (p_product_id IS NOT NULL AND r.product_id = p_product_id)
          OR (nullif(btrim(coalesce(p_product_key, '')), '') IS NOT NULL AND r.product_key = public.purchase_product_key(p_product_key)))
     AND (nullif(btrim(coalesce(p_search, '')), '') IS NULL
          OR r.item_name ILIKE '%' || btrim(p_search) || '%'
          OR r.supplier_name ILIKE '%' || btrim(p_search) || '%'
          OR r.barcode = btrim(p_search)
          OR r.batch ILIKE '%' || btrim(p_search) || '%')
$$;

-- Every purchase line, newest first: the central purchase history.
CREATE OR REPLACE FUNCTION public.get_purchase_history(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_search text DEFAULT NULL,
  p_supplier_key text DEFAULT NULL, p_product_key text DEFAULT NULL, p_product_id uuid DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
RETURNS TABLE (purchase_id uuid, purchase_date date, recorded_at timestamptz, supplier_name text, supplier_key text,
               line_no integer, line_id text, product_id uuid, product_key text, item_name text, qty numeric,
               unit_cost numeric, line_total numeric, barcode text, batch text, expiry text, itemised boolean,
               purchase_total numeric, purchase_paid numeric, purchase_balance numeric, purchase_status text,
               edited_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT * FROM public.purchase_lines_filtered(p_business_id, p_from, p_to, p_search, p_supplier_key, p_product_key, p_product_id) r
   ORDER BY r.purchase_date DESC, r.recorded_at DESC, r.purchase_id, r.line_no
  OFFSET greatest(coalesce(p_offset, 0), 0) LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Totals for the selection. Spend is the sum of the matching lines; paid and outstanding are those of the
-- purchases the lines belong to. payments_in_period is what was paid to suppliers in the period (by date paid,
-- supplier filter applied), whichever purchase it settled.
CREATE OR REPLACE FUNCTION public.get_purchase_summary(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_search text DEFAULT NULL,
  p_supplier_key text DEFAULT NULL, p_product_key text DEFAULT NULL, p_product_id uuid DEFAULT NULL)
RETURNS TABLE (purchase_count bigint, line_count bigint, units numeric, total_spent numeric, amount_paid numeric,
               balance numeric, supplier_count bigint, product_count bigint, first_date date, last_date date,
               last_purchase_id uuid, last_supplier text, last_total numeric, payments_in_period numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  WITH lines AS (
    SELECT r.* FROM public.purchase_lines_filtered(p_business_id, p_from, p_to, p_search, p_supplier_key, p_product_key, p_product_id) r
  ), pu AS (
    SELECT DISTINCT ON (purchase_id) purchase_id, purchase_date, recorded_at, supplier_name, supplier_key,
           purchase_total, purchase_paid, purchase_balance
      FROM lines ORDER BY purchase_id
  ), last AS (
    SELECT * FROM pu ORDER BY purchase_date DESC, recorded_at DESC LIMIT 1
  )
  SELECT (SELECT count(*) FROM pu),
         (SELECT count(*) FROM lines),
         (SELECT coalesce(sum(qty), 0) FROM lines),
         (SELECT coalesce(sum(line_total), 0) FROM lines),
         (SELECT coalesce(sum(purchase_paid), 0) FROM pu),
         (SELECT coalesce(sum(purchase_balance), 0) FROM pu),
         (SELECT count(DISTINCT supplier_key) FROM pu),
         (SELECT count(DISTINCT product_key) FROM lines),
         (SELECT min(purchase_date) FROM pu),
         (SELECT max(purchase_date) FROM pu),
         last.purchase_id, last.supplier_name, last.purchase_total,
         (SELECT coalesce(sum(pp.amount), 0) FROM public.purchase_payments pp
           WHERE pp.business_id = p_business_id
             AND (p_from IS NULL OR pp.paid_on >= p_from) AND (p_to IS NULL OR pp.paid_on <= p_to)
             AND (nullif(btrim(coalesce(p_supplier_key, '')), '') IS NULL OR pp.supplier_key = lower(btrim(p_supplier_key))))
    FROM (SELECT 1) one LEFT JOIN last ON true
$$;

-- Spending per supplier for the selection, biggest first.
CREATE OR REPLACE FUNCTION public.get_purchase_supplier_stats(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_search text DEFAULT NULL,
  p_product_key text DEFAULT NULL, p_product_id uuid DEFAULT NULL)
RETURNS TABLE (supplier_key text, supplier_name text, purchase_count bigint, line_count bigint, units numeric,
               total_spent numeric, amount_paid numeric, balance numeric, product_count bigint,
               first_date date, last_date date, last_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  WITH lines AS (
    SELECT r.* FROM public.purchase_lines_filtered(p_business_id, p_from, p_to, p_search, NULL, p_product_key, p_product_id) r
  ), pu AS (
    SELECT DISTINCT ON (purchase_id) purchase_id, purchase_date, recorded_at, supplier_key, purchase_total, purchase_paid, purchase_balance
      FROM lines ORDER BY purchase_id
  ), money AS (
    SELECT supplier_key, count(*) AS purchase_count, sum(purchase_paid) AS paid, sum(purchase_balance) AS bal,
           min(purchase_date) AS first_date, max(purchase_date) AS last_date,
           (array_agg(purchase_total ORDER BY purchase_date DESC, recorded_at DESC))[1] AS last_total
      FROM pu GROUP BY supplier_key
  )
  SELECT l.supplier_key, min(l.supplier_name), m.purchase_count, count(*), coalesce(sum(l.qty), 0),
         coalesce(sum(l.line_total), 0), coalesce(m.paid, 0), coalesce(m.bal, 0), count(DISTINCT l.product_key),
         m.first_date, m.last_date, m.last_total
    FROM lines l JOIN money m USING (supplier_key)
   GROUP BY l.supplier_key, m.purchase_count, m.paid, m.bal, m.first_date, m.last_date, m.last_total
   ORDER BY coalesce(sum(l.line_total), 0) DESC, min(l.supplier_name)
$$;

-- Per product for the selection: how often and how much was bought, average / lowest / highest unit cost,
-- the last purchase (date, supplier, quantity, unit cost) and the unit cost on the purchase before it.
CREATE OR REPLACE FUNCTION public.get_purchase_product_stats(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_search text DEFAULT NULL,
  p_supplier_key text DEFAULT NULL, p_product_key text DEFAULT NULL, p_product_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'spend', p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
RETURNS TABLE (product_key text, product_id uuid, product_name text, times_purchased bigint, units numeric,
               total_spent numeric, avg_cost numeric, min_cost numeric, max_cost numeric, supplier_count bigint,
               last_date date, last_supplier text, last_qty numeric, last_cost numeric,
               previous_date date, previous_cost numeric, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  WITH lines AS (
    SELECT r.* FROM public.purchase_lines_filtered(p_business_id, p_from, p_to, p_search, p_supplier_key, p_product_key, p_product_id) r
     WHERE r.itemised   -- a summary line (several products averaged) says nothing about one product's price
  ), per_purchase AS (
    SELECT product_key, purchase_id, max(purchase_date) AS pdate, max(recorded_at) AS rec, max(supplier_name) AS supplier,
           sum(qty) AS q, sum(line_total) AS t,
           row_number() OVER (PARTITION BY product_key ORDER BY max(purchase_date) DESC, max(recorded_at) DESC, purchase_id DESC) AS rk
      FROM lines GROUP BY product_key, purchase_id
  ), agg AS (
    SELECT product_key,
           (array_agg(product_id ORDER BY purchase_date DESC, recorded_at DESC) FILTER (WHERE product_id IS NOT NULL))[1] AS product_id,
           (array_agg(item_name ORDER BY purchase_date DESC, recorded_at DESC))[1] AS product_name,
           count(DISTINCT purchase_id) AS times_purchased, sum(qty) AS units, sum(line_total) AS total_spent,
           CASE WHEN sum(qty) > 0 THEN round(sum(line_total) / sum(qty), 2) END AS avg_cost,
           min(unit_cost) AS min_cost, max(unit_cost) AS max_cost, count(DISTINCT supplier_key) AS supplier_count
      FROM lines GROUP BY product_key
  )
  SELECT a.product_key, a.product_id, a.product_name, a.times_purchased, a.units, a.total_spent, a.avg_cost,
         a.min_cost, a.max_cost, a.supplier_count,
         lp.pdate, lp.supplier, lp.q, CASE WHEN lp.q > 0 THEN round(lp.t / lp.q, 2) END,
         pp.pdate, CASE WHEN pp.q > 0 THEN round(pp.t / pp.q, 2) END,
         count(*) OVER ()
    FROM agg a
    LEFT JOIN per_purchase lp ON lp.product_key = a.product_key AND lp.rk = 1
    LEFT JOIN per_purchase pp ON pp.product_key = a.product_key AND pp.rk = 2
   ORDER BY CASE WHEN p_sort = 'units' THEN a.units END DESC NULLS LAST,
            CASE WHEN p_sort = 'times' THEN a.times_purchased END DESC NULLS LAST,
            CASE WHEN p_sort = 'recent' THEN lp.pdate END DESC NULLS LAST,
            CASE WHEN p_sort = 'name' THEN a.product_name END ASC,
            a.total_spent DESC, a.product_key
  OFFSET greatest(coalesce(p_offset, 0), 0) LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

-- ── 9. The purchase list: date range and supplier ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_purchases_page(uuid, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_purchases_page(uuid, text, text, text, integer, integer, date, date, text);
CREATE FUNCTION public.get_purchases_page(
  p_business_id uuid, p_search text DEFAULT NULL, p_month text DEFAULT NULL, p_year text DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 50,
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_supplier_key text DEFAULT NULL)
RETURNS TABLE (id uuid, supplier_name text, product_name text, quantity integer, cost_price numeric, total_cost numeric,
               amount_paid numeric, balance numeric, supply_date text, due_date text, expiry text, batch text, status text,
               notes text, created_at timestamptz, edited_at timestamptz, edit_count integer, item_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_platform_admin() OR p_business_id IN (SELECT public.current_business_ids())) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.supplier_name, p.product_name, p.quantity, p.cost_price, p.total_cost, p.amount_paid, p.balance,
         p.supply_date, p.due_date, p.expiry::text, p.batch, p.status, p.notes, (p.created_at AT TIME ZONE 'UTC')::timestamptz,
         p.edited_at, coalesce(p.edit_count, 0),
         CASE WHEN jsonb_typeof(p.items) = 'array' THEN jsonb_array_length(p.items) ELSE 0 END
    FROM public.purchases p
   WHERE p.business_id = p_business_id
     AND (p_search IS NULL OR p_search = '' OR p.supplier_name ILIKE '%' || p_search || '%' OR p.product_name ILIKE '%' || p_search || '%')
     AND (p_month IS NULL OR p_month = '' OR p.created_at >= (p_month || '-01')::date)
     AND (p_month IS NULL OR p_month = '' OR p.created_at < ((p_month || '-01')::date + interval '1 month'))
     AND (p_year IS NULL OR p_year = '' OR p.created_at >= (p_year || '-01-01')::date)
     AND (p_year IS NULL OR p_year = '' OR p.created_at < ((p_year || '-01-01')::date + interval '1 year'))
     AND (p_from IS NULL OR public.purchase_effective_date(p.supply_date, p.created_at) >= p_from)
     AND (p_to IS NULL OR public.purchase_effective_date(p.supply_date, p.created_at) <= p_to)
     AND (nullif(btrim(coalesce(p_supplier_key, '')), '') IS NULL OR lower(btrim(p.supplier_name)) = lower(btrim(p_supplier_key)))
   ORDER BY public.purchase_effective_date(p.supply_date, p.created_at) DESC, p.created_at DESC, p.id
  OFFSET p_offset LIMIT p_limit;
END $$;

-- ── 10. Backfill line ids and products on itemised purchases ────────────────────────────────────────────────
-- Runs as the migration owner, so the guard above does not apply. Idempotent: a normalised line is left alone.
UPDATE public.purchases p
   SET items = public.purchase_items_normalized(p)
 WHERE jsonb_typeof(p.items) = 'array' AND jsonb_array_length(p.items) > 0
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) e WHERE NOT (e ? 'ledger_base'));

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.can_edit_purchases(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_items_normalized(public.purchases) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_line_received(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchases_guard_direct_write() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchase_for_edit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchases_page(uuid, text, text, text, integer, integer, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_num(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_product_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_effective_date(text, timestamp) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_line_rows(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_lines_filtered(uuid, date, date, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchase_history(uuid, date, date, text, text, text, uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchase_summary(uuid, date, date, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchase_supplier_stats(uuid, date, date, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_purchase_product_stats(uuid, date, date, text, text, text, uuid, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text, integer, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_for_edit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchases_page(uuid, text, text, text, integer, integer, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_num(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_product_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_effective_date(text, timestamp) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_line_rows(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purchase_lines_filtered(uuid, date, date, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_history(uuid, date, date, text, text, text, uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_summary(uuid, date, date, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_supplier_stats(uuid, date, date, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_product_stats(uuid, date, date, text, text, text, uuid, text, integer, integer) TO authenticated, service_role;


-- ===== probes (everything below is undone by the final RAISE) =====
do $p$ declare a int; b int; c int; d int; e int; f int; begin
  select count(*), count(*) filter (where x->>'product_id' is not null and x->>'ledger_base' = '0') into a, b
    from purchases p cross join lateral jsonb_array_elements(p.items) x
   where exists (select 1 from stock_movements m where m.source_type='purchase' and m.source_id=p.id::text);
  select count(*), count(*) filter (where x->>'product_id' is not null), count(*) filter (where (x->>'ledger_base')::int > 0) into c, d, e
    from purchases p cross join lateral jsonb_array_elements(p.items) x
   where p.items is not null and not exists (select 1 from stock_movements m where m.source_type='purchase' and m.source_id=p.id::text);
  select count(*) into f from purchases p where jsonb_typeof(p.items)='array' and exists (select 1 from jsonb_array_elements(p.items) x where not (x ? 'ledger_base'));
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('backfill: ledger-era lines %s paired %s; pre-ledger lines %s linked %s with_base %s; un-normalised purchases %s', a, b, c, d, e, f) || ' || ', true);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('erythromycin stock before %s', (select stock from products where id='18355a6b-0c85-4947-8fa7-43d22b39b0b7')) || ' || ', true);
end $p$;

select set_config('request.jwt.claims', '{"sub":"d9f4e96f-1cf2-496b-9e33-3aa520222282","email":"foursisterspharmacy@gmail.com","role":"authenticated"}', true);
set local role authenticated;

do $p$ begin
  begin update purchases set notes = notes where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625'; perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'guard: FAIL direct update allowed' || ' || ', true);
  exception when insufficient_privilege then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'guard: direct update refused (' || sqlerrm || ')' || ' || ', true); end;
  begin delete from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625'; perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'guard: FAIL direct delete allowed' || ' || ', true);
  exception when insufficient_privilege then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'guard: direct delete refused' || ' || ', true); end;
  begin perform can_edit_purchases('f7d9a912-921d-43eb-b3c6-f075a56f4819'); perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'helper: FAIL can_edit_purchases callable' || ' || ', true);
  exception when insufficient_privilege then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'helper: can_edit_purchases not callable by clients' || ' || ', true); end;
end $p$;

do $p$ declare j jsonb; begin
  j := get_purchase_for_edit('1e0bb19f-e124-4b3d-800a-722f9c8c9625');
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('for-edit E: can_edit=%s line=%s received=%s stock=%s min_qty=%s locked=%s', j->>'can_edit', j->'items'->0->>'id', j->'items'->0->>'received', j->'items'->0->>'product_stock', j->'items'->0->>'min_qty', j->'items'->0->>'locked') || ' || ', true);
  j := get_purchase_for_edit('c6d9c752-89a9-44bb-854f-67c5870945fb');
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('for-edit Biopentin: received=%s stock=%s min_qty=%s batch_id_set=%s', j->'items'->0->>'received', j->'items'->0->>'product_stock', j->'items'->0->>'min_qty', (j->'items'->0->>'batch_id') is not null) || ' || ', true);
end $p$;

do $p$ declare p purchases%rowtype; it jsonb; r jsonb; begin
  select * into p from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625';
  it := jsonb_set(p.items, '{0,qty}', '6');
  r := edit_purchase(p.id, p.supplier_name, p.supply_date::date, nullif(p.due_date,'')::date, p.notes, it, null, 'Rolled-back probe', 'Probe', 0, 0);
  select * into p from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625';
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('edit 5->6: unchanged=%s stock=%s total=%s qty=%s balance=%s status=%s edit_count=%s debt_balance=%s edit_movements=%s', r->>'unchanged', (select stock from products where id='18355a6b-0c85-4947-8fa7-43d22b39b0b7'), p.total_cost, p.quantity, p.balance, p.status, p.edit_count, (select balance from debts where source='purchase' and source_ref=p.id::text), (select count(*) from stock_movements where source_type='purchase_edit' and source_id=p.id::text)) || ' || ', true);
exception when others then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'edit 5->6: ERROR ' || sqlerrm || ' || ', true);
end $p$;

do $p$ declare p purchases%rowtype; begin
  select * into p from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625';
  perform edit_purchase(p.id, p.supplier_name, p.supply_date::date, null, p.notes, jsonb_set(p.items, '{0,qty}', '5'), null, 'Stale probe', 'Probe', 0, 0);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'stale edit: FAIL accepted' || ' || ', true);
exception when others then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'stale edit refused: ' || sqlerrm || ' || ', true);
end $p$;

do $p$ declare p purchases%rowtype; r jsonb; begin
  select * into p from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625';
  r := edit_purchase(p.id, p.supplier_name, p.supply_date::date, nullif(p.due_date,'')::date, p.notes, jsonb_set(p.items, '{0,qty}', '5'), 1000, 'Rolled-back probe', 'Probe', 1, 0);
  select * into p from purchases where id = '1e0bb19f-e124-4b3d-800a-722f9c8c9625';
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('edit 6->5 paid 1000: stock=%s total=%s paid=%s balance=%s status=%s payments_sum=%s correction_rows=%s debt=%s/%s', (select stock from products where id='18355a6b-0c85-4947-8fa7-43d22b39b0b7'), p.total_cost, p.amount_paid, p.balance, p.status, (select sum(amount) from purchase_payments where purchase_id=p.id), (select count(*) from purchase_payments where purchase_id=p.id and kind='correction'), (select amount_paid from debts where source='purchase' and source_ref=p.id::text), (select balance from debts where source='purchase' and source_ref=p.id::text)) || ' || ', true);
  r := edit_purchase(p.id, p.supplier_name, p.supply_date::date, nullif(p.due_date,'')::date, p.notes, p.items, null, 'Repeat probe', 'Probe', 2, 1000);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('repeat edit: unchanged=%s edit_count=%s', r->>'unchanged', (select edit_count from purchases where id=p.id)) || ' || ', true);
exception when others then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'edit 6->5: ERROR ' || sqlerrm || ' || ', true);
end $p$;

do $p$ declare p purchases%rowtype; begin
  select * into p from purchases where id = 'c6d9c752-89a9-44bb-854f-67c5870945fb';
  perform edit_purchase(p.id, p.supplier_name, p.supply_date::date, nullif(p.due_date,'')::date, p.notes, jsonb_set(p.items, '{0,qty}', '2'), null, 'Sold probe', 'Probe', 0, 0);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'sold units: FAIL accepted' || ' || ', true);
exception when others then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'sold units refused: ' || sqlerrm || ' || ', true);
end $p$;

do $p$ declare s record; n_page int; n_range int; n_hist int; n_lines int; n_sup int; n_prod int; dsum numeric; dpaid numeric; dbal numeric; dcount int; begin
  select * into s from get_purchase_summary('f7d9a912-921d-43eb-b3c6-f075a56f4819');
  select count(*), sum(total_cost), sum(amount_paid), sum(balance) into dcount, dsum, dpaid, dbal from purchases where business_id = 'f7d9a912-921d-43eb-b3c6-f075a56f4819';
  select count(*) into n_page from get_purchases_page('f7d9a912-921d-43eb-b3c6-f075a56f4819', null, null, null, 0, 100);
  select count(*) into n_range from get_purchases_page('f7d9a912-921d-43eb-b3c6-f075a56f4819', null, null, null, 0, 100, '2026-10-01', '2026-10-31', null);
  select count(*) into n_hist from get_purchase_history('f7d9a912-921d-43eb-b3c6-f075a56f4819', null, null, null, null, null, null, 0, 200);
  select count(*) into n_lines from purchase_line_rows('f7d9a912-921d-43eb-b3c6-f075a56f4819');
  select count(*) into n_sup from get_purchase_supplier_stats('f7d9a912-921d-43eb-b3c6-f075a56f4819');
  select count(*) into n_prod from get_purchase_product_stats('f7d9a912-921d-43eb-b3c6-f075a56f4819', null, null, null, null, null, null, 'spend', 0, 500);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('analytics: summary purchases=%s spent=%s paid=%s bal=%s | direct purchases=%s spent=%s paid=%s bal=%s | page(6-arg)=%s range-oct=%s history=%s/%s lines suppliers=%s products=%s payments_in_period=%s', s.purchase_count, round(s.total_spent,2), s.amount_paid, round(s.balance,2), dcount, round(dsum,2), dpaid, round(dbal,2), n_page, n_range, n_hist, n_lines, n_sup, n_prod, s.payments_in_period) || ' || ', true);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('audit rows for E: %s', (select count(*) from audit_log where target_id='1e0bb19f-e124-4b3d-800a-722f9c8c9625' and action='purchase.edited')) || ' || ', true);
exception when others then perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || 'analytics: ERROR ' || sqlerrm || ' || ', true);
end $p$;

reset role;
do $p$ begin
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('ledger check E product: stock=%s sum(movements)=%s', (select stock from products where id='18355a6b-0c85-4947-8fa7-43d22b39b0b7'), (select sum(quantity) from stock_movements where product_id='18355a6b-0c85-4947-8fa7-43d22b39b0b7')) || ' || ', true);
  perform set_config('probe.out', coalesce(current_setting('probe.out', true), '') || format('acl edit_purchase=%s guard_trigger=%s', (select proacl::text from pg_proc where proname='edit_purchase'), (select count(*) from pg_trigger where tgname='purchases_guard_direct_write')) || ' || ', true);
  raise exception 'PROBE_RESULT %', current_setting('probe.out', true);
end $p$;
