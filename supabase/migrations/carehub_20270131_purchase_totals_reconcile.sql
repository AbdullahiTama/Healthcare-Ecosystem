-- ─────────────────────────────────────────────────────────────────────────────
-- Purchases: the Purchases totals and the Purchase Summary always reconcile; uploaded lines without a quantity
-- are recorded and counted.
-- 2026-11-19. Docs: docs/architecture/Purchases-Totals-Reconciliation.md
-- Status: APPLIED to the live carehub project 2026-11-19 with owner approval, in three parts (versions
-- 20261119110201 analytics, 20261119110347 edit_purchase, 20261119110416 get_purchase_totals + grants). Every live
-- body matches this file (md5 of prosrc: purchase_line_rows ebc00807…, get_purchase_summary eb43c0ad…,
-- get_purchase_supplier_stats cf578bfa…, get_purchase_product_stats 4bfca5c4…, edit_purchase 8ee24db2…,
-- get_purchase_totals 6e0cba4c…); grants unchanged; only the five-argument get_purchase_totals exists.
-- Live probe as the owner of the business with most purchases, in a rolled-back block: for all time, the latest
-- month, the main supplier and both, get_purchase_totals = get_purchase_summary = the page's sums (count, total, paid,
-- owed). An amount-only line counted (3,500), its amount edited (4,000, no stock change), completed with a quantity
-- (one purchase_receipt of 5, stock +5), a new amount-only line refused. Afterwards purchases / movements / debts /
-- audit unchanged (67 / 9,709 / 2,179 / 46), no probe rows.
-- Note: stored totals carry sub-kobo fractions from long-decimal unit costs (e.g. 28000.00002), so for that
-- business paid + owed differs from the total by under 0.01 naira (all three sections show the same figures).
-- Tested first on PGlite (scripts/db-tests/purchaseTotalsReconcile.pglite.mjs).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY (verified against the code and the live database, 2026-11-19)
-- "The total under Purchases sometimes differs from the Purchase Summary; uploaded purchases, especially without
-- quantities, are not reflected consistently."
--   1. The Purchases tab's figures (get_purchase_totals) were always all-time and unfiltered, while the list under
--      them follows the period, supplier and search chosen; the Purchase Summary (History & analytics) follows its
--      own period, which opens on "This month". So the same purchases showed different figures.
--   2. The Purchase Summary's "Total spent" (and spending per supplier) re-added each line as quantity x unit cost,
--      not the purchase's own total: a line without a quantity counted 0, rounding per line drifted by kobo (live:
--      8,949,342.00 against 8,949,341.99), and a purchase whose items held no object fell out of the summary.
--   3. An uploaded row without a quantity was refused, and with it its whole purchase: it reached neither section.
--      Owner decision 2026-11-19: record the amount without stock, and let Edit Purchase complete the quantity.
--
-- WHAT
--   * Line items gain an amount-only shape: {"no_qty": true, "qty": null, "cost": null, "amount": <naira>}.
--     Written by the upload (recordPurchase.js); it adds no stock.
--   * purchase_line_rows: an amount-only line has no quantity or unit cost and counts its amount; a purchase is
--     itemised only when it has at least one object line (otherwise its own summary line, so it is never lost).
--   * get_purchase_summary and get_purchase_supplier_stats: with whole purchases selected (no product or search),
--     spend is the purchases' own totals, the figure the Purchases tab shows; narrowed to a product or a search it
--     stays the matching lines.
--   * get_purchase_product_stats: unit costs (average, last, previous) only from lines with a quantity.
--   * get_purchase_totals: the same filters as get_purchases_page (supply-date range, supplier, search) and a
--     total_amount, so the cards above the list describe the list; the old one-argument call still works.
--   * edit_purchase: an amount-only line can be kept (its amount edited) or completed (quantity and unit cost
--     entered: it is then received into stock as a new line); a new line or a line that added stock still needs a
--     quantity. The header's average unit cost counts only lines with a quantity. Everything else is unchanged.
--   Every other line of these bodies is identical to the live ones (carehub_20261229, md5-checked 2026-11-19).
--
-- SECURITY
--   No new access. get_purchase_totals keeps its ownership check (service role, platform admin or a member of
--   the business) and grants; the analytics stay SECURITY INVOKER under purchases' RLS; edit_purchase keeps its
--   membership and "Edit purchases" checks. An amount-only line cannot move stock.
--
-- ROLLBACK
--   Re-run the six function bodies from carehub_20261229_purchase_editing_and_analytics.sql, then:
--   DROP FUNCTION public.get_purchase_totals(uuid, date, date, text, text); and recreate the one-argument version
--   from carefind_20261019_red_team_fixes.sql with its grants. Amount-only lines already recorded keep their amount
--   in total_cost; the old summary would then count them as 0 again.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purchase_line_rows(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (purchase_id uuid, purchase_date date, recorded_at timestamptz, supplier_name text, supplier_key text,
               line_no integer, line_id text, product_id uuid, product_key text, item_name text, qty numeric,
               unit_cost numeric, line_total numeric, barcode text, batch text, expiry text, itemised boolean,
               purchase_total numeric, purchase_paid numeric, purchase_balance numeric, purchase_status text,
               edited_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $$
  WITH f AS (
    SELECT pu.*, public.purchase_effective_date(pu.supply_date, pu.created_at) AS pdate,
           -- Itemised when at least one line is an object (an array of anything else falls back to the
           -- purchase's own summary line, so the purchase is never left out).
           (jsonb_typeof(pu.items) = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(pu.items) x WHERE jsonb_typeof(x) = 'object')) AS has_items
      FROM public.purchases pu
     WHERE pu.business_id = p_business_id
  )
  SELECT f.id, f.pdate, (f.created_at AT TIME ZONE 'UTC'), btrim(f.supplier_name), lower(btrim(f.supplier_name)),
         l.n::int,
         coalesce(nullif(l.e ->> 'id', ''), 'legacy-' || l.n),
         CASE WHEN (l.e ->> 'product_id') ~ '^[0-9a-fA-F-]{36}$' THEN (l.e ->> 'product_id')::uuid END,
         public.purchase_product_key(l.e ->> 'name'),
         coalesce(nullif(btrim(l.e ->> 'name'), ''), 'Item'),
         -- A line recorded without a quantity (no_qty, from an upload) has no quantity or unit cost; its amount counts.
         CASE WHEN (l.e ->> 'no_qty') = 'true' THEN NULL ELSE public.purchase_num(l.e ->> 'qty') END,
         CASE WHEN (l.e ->> 'no_qty') = 'true' THEN NULL ELSE public.purchase_num(l.e ->> 'cost') END,
         CASE WHEN f.has_items AND (l.e ->> 'no_qty') = 'true' THEN round(public.purchase_num(l.e ->> 'amount'), 2)
              WHEN f.has_items THEN round(public.purchase_num(l.e ->> 'qty') * public.purchase_num(l.e ->> 'cost'), 2)
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
         -- Whole purchases selected (no product or search): spend is the purchases' own totals, exactly what the
         -- Purchases tab adds up. Narrowed to a product or a search: the matching lines.
         CASE WHEN (p_product_id IS NULL AND nullif(btrim(coalesce(p_product_key, '')), '') IS NULL AND nullif(btrim(coalesce(p_search, '')), '') IS NULL)
              THEN (SELECT coalesce(sum(purchase_total), 0) FROM pu)
              ELSE (SELECT coalesce(sum(line_total), 0) FROM lines) END,
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
    SELECT supplier_key, count(*) AS purchase_count, sum(purchase_total) AS spent, sum(purchase_paid) AS paid, sum(purchase_balance) AS bal,
           min(purchase_date) AS first_date, max(purchase_date) AS last_date,
           (array_agg(purchase_total ORDER BY purchase_date DESC, recorded_at DESC))[1] AS last_total
      FROM pu GROUP BY supplier_key
  )
  SELECT l.supplier_key, min(l.supplier_name), m.purchase_count, count(*), coalesce(sum(l.qty), 0),
         -- As the summary: whole purchases use their own totals, a product or search uses the matching lines.
         CASE WHEN (p_product_id IS NULL AND nullif(btrim(coalesce(p_product_key, '')), '') IS NULL AND nullif(btrim(coalesce(p_search, '')), '') IS NULL) THEN coalesce(m.spent, 0) ELSE coalesce(sum(l.line_total), 0) END,
         coalesce(m.paid, 0), coalesce(m.bal, 0), count(DISTINCT l.product_key),
         m.first_date, m.last_date, m.last_total
    FROM lines l JOIN money m USING (supplier_key)
   GROUP BY l.supplier_key, m.purchase_count, m.spent, m.paid, m.bal, m.first_date, m.last_date, m.last_total
   ORDER BY CASE WHEN (p_product_id IS NULL AND nullif(btrim(coalesce(p_product_key, '')), '') IS NULL AND nullif(btrim(coalesce(p_search, '')), '') IS NULL) THEN coalesce(m.spent, 0) ELSE coalesce(sum(l.line_total), 0) END DESC, min(l.supplier_name)
$$;

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
           sum(qty) AS q, sum(line_total) FILTER (WHERE qty > 0) AS t,   -- unit cost: lines with a quantity only
           row_number() OVER (PARTITION BY product_key ORDER BY max(purchase_date) DESC, max(recorded_at) DESC, purchase_id DESC) AS rk
      FROM lines GROUP BY product_key, purchase_id
  ), agg AS (
    SELECT product_key,
           (array_agg(product_id ORDER BY purchase_date DESC, recorded_at DESC) FILTER (WHERE product_id IS NOT NULL))[1] AS product_id,
           (array_agg(item_name ORDER BY purchase_date DESC, recorded_at DESC))[1] AS product_name,
           count(DISTINCT purchase_id) AS times_purchased, sum(qty) AS units, sum(line_total) AS total_spent,
           CASE WHEN sum(qty) > 0 THEN round(sum(line_total) FILTER (WHERE qty > 0) / sum(qty), 2) END AS avg_cost,
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
  v_qty_total numeric := 0;
  v_amount   numeric;
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

    -- A line recorded without a quantity (no_qty, from an upload: carehub_20270131) keeps its amount, and adds no
    -- stock, until its quantity and unit cost are entered; it is then received like a new line (below). Only a
    -- line that already had no quantity can stay that way: a new line, or one that added stock, needs a quantity.
    o := v_old_map -> v_id;
    IF coalesce(e ->> 'no_qty', '') = 'true' AND public.purchase_num(e ->> 'qty') = 0 THEN
      IF o IS NULL OR coalesce(o ->> 'no_qty', '') <> 'true' THEN
        RAISE EXCEPTION 'Line % (%): the quantity must be a whole number above zero.', i, v_name USING ERRCODE = '22023';
      END IF;
      v_amount := round(public.purchase_num(e ->> 'amount'), 2);
      IF v_amount <= 0 OR v_amount > 1000000000 THEN
        RAISE EXCEPTION 'Line % (%): enter the amount for this line, or its quantity and unit cost.', i, v_name USING ERRCODE = '22023';
      END IF;
      IF (v_batch IS NOT NULL AND length(v_batch) > 100) OR (v_barcode IS NOT NULL AND length(v_barcode) > 64) THEN
        RAISE EXCEPTION 'Line % (%): the batch number or barcode is too long.', i, v_name USING ERRCODE = '22023';
      END IF;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'name', v_name, 'qty', NULL, 'cost', NULL, 'amount', v_amount, 'no_qty', true, 'sell', NULL,
        'batch', v_batch, 'expiry', v_expiry::text, 'barcode', v_barcode, 'cat', v_cat,
        'product_id', o -> 'product_id', 'batch_id', NULL, 'ledger_base', 0));
      v_total := v_total + v_amount;
      CONTINUE;
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
    -- Completing a line that had no quantity: it has added nothing yet, so it is received like a new line.
    IF o IS NOT NULL AND coalesce(o ->> 'no_qty', '') = 'true' THEN
      v_old_pid := NULL; v_old_recv := 0; v_batch_id := NULL;
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
      v_qty_total := v_qty_total + round(v_qty * v_cost, 2);
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
    v_qty_total := v_qty_total + round(v_qty * v_cost, 2);
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
           'amount', round(public.purchase_num(x ->> 'amount'), 2),
           'sell', CASE WHEN public.purchase_num(x ->> 'sell') > 0 THEN round(public.purchase_num(x ->> 'sell'), 2) END,
           'batch', nullif(btrim(coalesce(x ->> 'batch', '')), ''), 'expiry', nullif(x ->> 'expiry', ''),
           'barcode', nullif(btrim(coalesce(x ->> 'barcode', '')), ''), 'product_id', x ->> 'product_id') ORDER BY n), '[]')
    INTO v_canon_old FROM jsonb_array_elements(v_old) WITH ORDINALITY t(x, n);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'name', public.purchase_product_key(x ->> 'name'),
           'qty', public.purchase_num(x ->> 'qty'), 'cost', round(public.purchase_num(x ->> 'cost'), 2),
           'amount', round(public.purchase_num(x ->> 'amount'), 2),
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
    -- The average unit cost of the lines with a quantity (an amount-only line has no units).
    cost_price = CASE WHEN v_units > 0 THEN round(v_qty_total / v_units, 2) ELSE 0 END,
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

-- The Purchases tab's figures, for exactly the purchases its list shows.
DROP FUNCTION IF EXISTS public.get_purchase_totals(uuid);
CREATE OR REPLACE FUNCTION public.get_purchase_totals(
  p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_supplier_key text DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (purchase_count bigint, total_paid numeric, total_owed numeric, total_amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_platform_admin() OR p_business_id IN (SELECT public.current_business_ids())) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT count(*)::bigint,
         coalesce(sum(p.amount_paid), 0)::numeric,
         coalesce(sum(greatest(coalesce(p.balance, 0), 0)), 0)::numeric,
         coalesce(sum(p.total_cost), 0)::numeric
    FROM public.purchases p
   WHERE p.business_id = p_business_id
     -- The same selection as get_purchases_page.
     AND (p_search IS NULL OR p_search = '' OR p.supplier_name ILIKE '%' || p_search || '%' OR p.product_name ILIKE '%' || p_search || '%')
     AND (p_from IS NULL OR public.purchase_effective_date(p.supply_date, p.created_at) >= p_from)
     AND (p_to IS NULL OR public.purchase_effective_date(p.supply_date, p.created_at) <= p_to)
     AND (nullif(btrim(coalesce(p_supplier_key, '')), '') IS NULL OR lower(btrim(p.supplier_name)) = lower(btrim(p_supplier_key)));
END $$;

-- ── Grants (unchanged; restated so a re-run cannot widen them) ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_purchase_totals(uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_totals(uuid, date, date, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_purchase(uuid, text, date, date, text, jsonb, numeric, text, text, integer, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_line_rows(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_line_rows(uuid, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_purchase_summary(uuid, date, date, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_summary(uuid, date, date, text, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_purchase_supplier_stats(uuid, date, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_supplier_stats(uuid, date, date, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_purchase_product_stats(uuid, date, date, text, text, text, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_product_stats(uuid, date, date, text, text, text, uuid, text, integer, integer) TO authenticated, service_role;
