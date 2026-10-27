-- Sales corrections: held sales stay held until completed; edit, refund and
-- delete of a completed sale are Owner-only, transactional and audited.
--
-- Docs: docs/architecture/Sales-Corrections.md
--
-- Why:
--   * Deleting (or resuming) a held sale used to flip is_on_hold to false and set
--     status 'deleted' / 'resumed'. Every screen that filtered on is_on_hold alone
--     (dashboard "Sales today", Recent sales, client history) then counted the row
--     as a completed sale. Live on 2026-10-27: 30 'deleted' and 5 'resumed' rows.
--   * Any signed-in member could PATCH or DELETE any sale row directly (the RLS
--     policy is business-scoped only), so "only the Owner may edit/delete/refund"
--     was a screen rule, not a data rule. refund_sale() also admitted managers.
--
-- What this adds:
--   1. sales.resumed_from, edited_at, deleted_at.
--   2. is_business_owner(): the Owner (or the owner of a parent business, or an
--      active staff row whose role is 'Owner'). Managers are NOT owners.
--   3. Guards: signed-in clients can no longer DELETE a sale, release or relabel a
--      held sale, or change the financial columns of a completed one by direct
--      PATCH. The SECURITY DEFINER functions below (and record_sale_payment) run as
--      the table owner and are unaffected, as are service-role writes.
--   4. Completing a resumed held sale: the till inserts a NEW completed sale with
--      resumed_from = the held row. An AFTER INSERT trigger marks the held row
--      'converted' in the same transaction (so it can never be completed twice).
--      The existing INSERT triggers then take stock and payments exactly once.
--   5. edit_sale(), delete_sale(), refund_sale() (replaced): Owner only. Each moves
--      the sale, its payments ledger, stock, batches, the customer's debt and the
--      audit trail together, in one transaction.
--
-- Rules the functions follow:
--   * The server recomputes subtotal/total/balance from the lines; the client's
--     totals are never trusted.
--   * sale_payments stays append-only. An edit never rewrites money that moved;
--     a delete adds reversing 'refund' rows (net of earlier refunds) so net
--     received and shift cash stay true; a refund adds a 'refund' row.
--   * Edit adjusts stock by the per-product / per-batch difference; delete returns
--     the whole sale to stock. Refund stays money-only, as before.
--   * sales.items keeps the app's double-encoded shape (a JSON string holding the
--     array) because screens JSON.parse it.
--
-- Depends on: carehub_20261210_pos_accounting.sql (sale_payments, pos_actor,
--   is_business_manager), carehub_20260810_audit_log.sql, stock_batches,
--   stock_movements, products, debts.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS sales_guard_direct_update ON public.sales;
--   DROP TRIGGER IF EXISTS sales_guard_direct_delete ON public.sales;
--   DROP TRIGGER IF EXISTS sales_close_resumed_hold ON public.sales;
--   DROP FUNCTION IF EXISTS public.edit_sale(uuid, jsonb, numeric, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.delete_sale(uuid, text);
--   DROP FUNCTION IF EXISTS public.sales_guard_direct_update(), public.sales_guard_direct_delete(),
--     public.sales_close_resumed_hold(), public.sale_apply_stock_delta(uuid, text, jsonb, jsonb),
--     public.sale_stock_lines(jsonb), public.sale_items_array(jsonb), public.is_business_owner(uuid);
--   then re-apply carehub_20261210_pos_accounting.sql to restore the old refund_sale().
--   ALTER TABLE public.sales DROP COLUMN IF EXISTS resumed_from, DROP COLUMN IF EXISTS edited_at,
--     DROP COLUMN IF EXISTS deleted_at;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS resumed_from uuid REFERENCES public.sales(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS sales_resumed_from ON public.sales (resumed_from) WHERE resumed_from IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Who is the Owner?
-- ---------------------------------------------------------------------------
-- Mirrors how the app resolves role 'Owner': the business (or a business above
-- it) whose login email is the caller's, else an active staff row with role
-- 'Owner'. Capped by current_business_ids(). Platform admins are deliberately
-- not owners of tenant sales.
CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH RECURSIVE ancestry AS (
    SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
    UNION ALL
    SELECT p.id, p.parent_business_id, p.email, a.depth + 1
      FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
  )
  SELECT auth.uid() IS NOT NULL
     AND bid IN (SELECT public.current_business_ids())
     AND (
       EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
       OR EXISTS (SELECT 1 FROM public.staff s
                   WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner'
                     AND lower(s.email) = lower(auth.email()))
     )
$$;

-- ---------------------------------------------------------------------------
-- 3. Guards on direct writes by signed-in clients
-- ---------------------------------------------------------------------------
-- current_user is 'authenticated' / 'anon' for a PostgREST request and the
-- function owner inside SECURITY DEFINER functions, so those (and the service
-- role) pass untouched.
CREATE OR REPLACE FUNCTION public.sales_guard_direct_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;

  IF COALESCE(OLD.is_on_hold, false) THEN
    -- A held sale's contents may change (add/remove products, customer, note);
    -- it cannot be released, deleted or relabelled. It ends by being completed.
    IF NEW.is_on_hold IS DISTINCT FROM OLD.is_on_hold OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.txn_no IS DISTINCT FROM OLD.txn_no OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.resumed_from IS DISTINCT FROM OLD.resumed_from THEN
      RAISE EXCEPTION 'A held sale can only be edited or completed at the till; it cannot be released, deleted or relabelled'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.items IS DISTINCT FROM OLD.items OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.discount IS DISTINCT FROM OLD.discount OR NEW.total IS DISTINCT FROM OLD.total
     OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.is_credit IS DISTINCT FROM OLD.is_credit OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_split IS DISTINCT FROM OLD.payment_split OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_on_hold IS DISTINCT FROM OLD.is_on_hold OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount
     OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.client_name IS DISTINCT FROM OLD.client_name
     OR NEW.txn_no IS DISTINCT FROM OLD.txn_no OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'A completed sale can only be changed by the Owner, from Financial Reports'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_guard_direct_update ON public.sales;
CREATE TRIGGER sales_guard_direct_update BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_guard_direct_update();

CREATE OR REPLACE FUNCTION public.sales_guard_direct_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Sales cannot be deleted directly. The Owner deletes a completed sale from Financial Reports; held sales cannot be deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS sales_guard_direct_delete ON public.sales;
CREATE TRIGGER sales_guard_direct_delete BEFORE DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_guard_direct_delete();

-- ---------------------------------------------------------------------------
-- 4. Completing a resumed held sale
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_close_resumed_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_rows integer;
BEGIN
  IF NEW.resumed_from IS NULL OR COALESCE(NEW.is_on_hold, false) THEN RETURN NEW; END IF;
  UPDATE public.sales
     SET status = 'converted'
   WHERE id = NEW.resumed_from AND business_id = NEW.business_id
     AND COALESCE(is_on_hold, false) AND status IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'This held sale was already completed or no longer exists' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_close_resumed_hold ON public.sales;
CREATE TRIGGER sales_close_resumed_hold AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_close_resumed_hold();

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
-- sales.items as an array, whatever shape it was stored in.
CREATE OR REPLACE FUNCTION public.sale_items_array(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v jsonb := p_items;
BEGIN
  IF v IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(v) = 'string' THEN
    BEGIN v := (v #>> '{}')::jsonb; EXCEPTION WHEN others THEN RETURN '[]'::jsonb; END;
  END IF;
  IF jsonb_typeof(v) = 'array' THEN RETURN v; END IF;
  RETURN '[]'::jsonb;
END $$;

-- The stock-bearing lines of a sale (same guards as apply_sale_stock_movement).
CREATE OR REPLACE FUNCTION public.sale_stock_lines(p_items jsonb)
RETURNS TABLE (product_id uuid, batch_id uuid, qty numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  e jsonb;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(public.sale_items_array(p_items)) LOOP
    IF coalesce(e ->> 'id', e ->> 'product_id', '') ~* c_uuid AND coalesce(e ->> 'qty', '') ~ '^[0-9]+$' THEN
      product_id := coalesce(e ->> 'id', e ->> 'product_id')::uuid;
      batch_id := CASE WHEN coalesce(e ->> 'batch_id', '') ~* c_uuid THEN (e ->> 'batch_id')::uuid END;
      qty := (e ->> 'qty')::numeric;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- Moves stock by the difference between two versions of a sale's lines:
-- old - new > 0 returns stock, < 0 takes more. Clamped at zero like the sale
-- triggers; batch changes are journaled in stock_movements.
CREATE OR REPLACE FUNCTION public.sale_apply_stock_delta(p_business uuid, p_txn text, p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  r record;
  v_before integer;
  v_after integer;
BEGIN
  UPDATE public.products p
     SET stock = greatest(0, coalesce(p.stock, 0) + d.delta::int)
    FROM (
      SELECT product_id, coalesce(o.q, 0) - coalesce(n.q, 0) AS delta
        FROM (SELECT l.product_id, sum(l.qty) q FROM public.sale_stock_lines(p_old) l GROUP BY 1) o
        FULL JOIN (SELECT l.product_id, sum(l.qty) q FROM public.sale_stock_lines(p_new) l GROUP BY 1) n USING (product_id)
    ) d
   WHERE p.id = d.product_id AND p.business_id = p_business
     AND coalesce(p.category, '') <> 'Services' AND d.delta <> 0;

  FOR r IN
    SELECT batch_id, coalesce(o.q, 0) - coalesce(n.q, 0) AS delta
      FROM (SELECT l.batch_id, sum(l.qty) q FROM public.sale_stock_lines(p_old) l WHERE l.batch_id IS NOT NULL GROUP BY 1) o
      FULL JOIN (SELECT l.batch_id, sum(l.qty) q FROM public.sale_stock_lines(p_new) l WHERE l.batch_id IS NOT NULL GROUP BY 1) n USING (batch_id)
  LOOP
    CONTINUE WHEN r.delta = 0;
    SELECT coalesce(b.quantity, 0) INTO v_before FROM public.stock_batches b
     WHERE b.id = r.batch_id AND b.business_id = p_business FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    v_after := greatest(0, v_before + r.delta::int);
    CONTINUE WHEN v_after = v_before;
    UPDATE public.stock_batches SET quantity = v_after WHERE id = r.batch_id AND business_id = p_business;
    INSERT INTO public.stock_movements (business_id, batch_id, from_location_id, to_location_id, movement_type, quantity, reason, moved_by)
    VALUES (p_business, r.batch_id, NULL, NULL, 'sale_correction', v_after - v_before, 'Sale ' || p_txn || ' corrected', auth.uid());
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. edit_sale
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_sale(
  p_sale_id uuid, p_items jsonb, p_discount numeric, p_client_id uuid, p_client_name text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_reason text := NULLIF(trim(p_reason), '');
  v_client text := COALESCE(NULLIF(trim(p_client_name), ''), 'Walk-in');
  v_items jsonb;
  v_subtotal numeric;
  v_discount numeric := round(COALESCE(p_discount, 0), 2);
  v_total numeric;
  v_paid numeric;
  v_balance numeric;
  v_old_items jsonb;
  v_debt public.debts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'An edit needs a reason (3 to 300 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_owner(v_sale.business_id) THEN
    RAISE EXCEPTION 'Only the Owner can edit a completed sale' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Only a completed sale can be edited' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A sale needs at least one product. To remove the sale, delete it instead' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT jsonb_agg(e || jsonb_build_object('qty', (e ->> 'qty')::numeric, 'price', (e ->> 'price')::numeric)),
           round(sum((e ->> 'qty')::numeric * (e ->> 'price')::numeric), 2)
      INTO v_items, v_subtotal
      FROM jsonb_array_elements(p_items) e;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                WHERE jsonb_typeof(e) <> 'object' OR (e ->> 'qty')::numeric <= 0 OR (e ->> 'qty')::numeric <> trunc((e ->> 'qty')::numeric)
                   OR (e ->> 'price')::numeric < 0 OR coalesce(trim(e ->> 'name'), '') = '') THEN
      RAISE EXCEPTION 'invalid line';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Every line needs a name, a whole-number quantity above zero and a price of zero or more' USING ERRCODE = '22023';
  END;
  IF v_discount < 0 OR v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount must be between zero and the subtotal (%)', v_subtotal USING ERRCODE = '22023';
  END IF;

  v_total := v_subtotal - v_discount;
  -- Money actually received is the paid amount up to the OLD total: the cash
  -- path stores cash tendered, so change handed back is not money received.
  v_paid := least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0));
  v_balance := greatest(v_total - v_paid, 0);
  v_old_items := public.sale_items_array(v_sale.items);

  UPDATE public.sales
     SET items = to_jsonb(v_items::text), subtotal = v_subtotal, discount = v_discount, total = v_total,
         amount_paid = v_paid, balance = v_balance, is_credit = v_balance > 0,
         client_id = p_client_id, client_name = v_client, edited_at = now()
   WHERE id = v_sale.id;

  PERFORM public.sale_apply_stock_delta(v_sale.business_id, v_sale.txn_no, v_old_items, v_items);

  -- The customer's debt follows the sale.
  SELECT * INTO v_debt FROM public.debts
   WHERE business_id = v_sale.business_id AND source = 'credit_sale' AND source_ref = v_sale.txn_no
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    UPDATE public.debts
       SET amount = v_total, amount_paid = v_paid, balance = v_balance,
           status = CASE WHEN v_balance <= 0 THEN 'paid' ELSE 'pending' END,
           party_name = CASE WHEN p_client_id IS NOT NULL OR v_client <> 'Walk-in' THEN v_client ELSE party_name END,
           client_id = p_client_id
     WHERE id = v_debt.id;
  ELSIF v_balance > 0 THEN
    INSERT INTO public.debts (business_id, client_id, direction, party_name, amount, amount_paid, balance, due_date, status, description, source, source_ref)
    VALUES (v_sale.business_id, p_client_id, 'owes_us',
            CASE WHEN v_client = 'Walk-in' THEN 'Walk-in · ' || v_sale.txn_no ELSE v_client END,
            v_total, v_paid, v_balance, '', 'pending', 'Balance after edit · TXN: ' || v_sale.txn_no, 'credit_sale', v_sale.txn_no);
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'owner', v_sale.business_id, 'sale.edited', 'sale', v_sale.id, jsonb_build_object(
    'txn_no', v_sale.txn_no, 'reason', v_reason,
    'before', jsonb_build_object('items', v_old_items, 'subtotal', v_sale.subtotal, 'discount', v_sale.discount, 'total', v_sale.total,
                                 'balance', v_sale.balance, 'amount_paid', v_sale.amount_paid, 'client_name', v_sale.client_name),
    'after', jsonb_build_object('items', v_items, 'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
                                'balance', v_balance, 'amount_paid', v_paid, 'client_name', v_client)));

  RETURN jsonb_build_object('sale_id', v_sale.id, 'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
    'amount_paid', v_paid, 'balance', v_balance, 'overpaid', greatest(v_paid - v_total, 0));
END $$;

-- ---------------------------------------------------------------------------
-- 7. delete_sale
-- ---------------------------------------------------------------------------
-- A soft delete: the row stays (status 'deleted') for the audit trail but is no
-- longer a sale. Money received is reversed on the ledger, stock returns, the
-- customer's debt is removed.
CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_reason text := NULLIF(trim(p_reason), '');
  v_old_items jsonb;
  v_debt jsonb;
  v_reversed numeric := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'A deletion needs a reason (3 to 300 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_owner(v_sale.business_id) THEN
    RAISE EXCEPTION 'Only the Owner can delete a completed sale' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Only a completed sale can be deleted' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;

  -- Reverse what is still held per method: money in less earlier refunds.
  FOR r IN
    SELECT method, round(sum(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 2) AS net
      FROM public.sale_payments WHERE sale_id = v_sale.id GROUP BY method
  LOOP
    CONTINUE WHEN r.net <= 0;
    INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id, note)
    VALUES (v_sale.business_id, v_sale.id, 'refund', r.method, r.net, auth.uid(), v_actor.staff_id, v_actor.staff_name,
            v_sale.shift_id, left('Sale deleted: ' || v_reason, 300));
    v_reversed := v_reversed + r.net;
  END LOOP;

  v_old_items := public.sale_items_array(v_sale.items);
  PERFORM public.sale_apply_stock_delta(v_sale.business_id, v_sale.txn_no, v_old_items, '[]'::jsonb);

  SELECT to_jsonb(d) INTO v_debt FROM public.debts d
   WHERE d.business_id = v_sale.business_id AND d.source = 'credit_sale' AND d.source_ref = v_sale.txn_no
   ORDER BY d.created_at DESC LIMIT 1;
  DELETE FROM public.debts WHERE business_id = v_sale.business_id AND source = 'credit_sale' AND source_ref = v_sale.txn_no;

  UPDATE public.sales
     SET status = 'deleted', balance = 0, is_credit = false, deleted_at = now()
   WHERE id = v_sale.id;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'owner', v_sale.business_id, 'sale.deleted', 'sale', v_sale.id, jsonb_build_object(
    'txn_no', v_sale.txn_no, 'reason', v_reason, 'reversed_payments', v_reversed, 'debt_removed', v_debt,
    'before', jsonb_build_object('items', v_old_items, 'subtotal', v_sale.subtotal, 'discount', v_sale.discount, 'total', v_sale.total,
                                 'balance', v_sale.balance, 'amount_paid', v_sale.amount_paid, 'client_name', v_sale.client_name,
                                 'payment_method', v_sale.payment_method, 'refunded_amount', v_sale.refunded_amount)));

  RETURN jsonb_build_object('sale_id', v_sale.id, 'reversed', v_reversed);
END $$;

-- ---------------------------------------------------------------------------
-- 8. refund_sale: Owner only, audited, capped by what the ledger holds
-- ---------------------------------------------------------------------------
-- Same signature as carehub_20261210_pos_accounting.sql, so this replaces it.
-- The cap is net money on the ledger (in less refunds): it equals the old
-- least(paid, total) - refunded for every unedited sale, and stays right for a
-- sale the Owner edited down below what was paid.
CREATE OR REPLACE FUNCTION public.refund_sale(p_sale_id uuid, p_amount numeric, p_method text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_shift uuid;
  v_refundable numeric;
  v_ledger numeric;
  v_rows integer;
  v_reason text := NULLIF(trim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Refund method must be Cash, Transfer or POS' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'A refund needs a reason (3 to 300 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_owner(v_sale.business_id) THEN
    RAISE EXCEPTION 'Only the Owner can record a refund' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Only a completed sale can be refunded' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), COALESCE(sum(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0)
    INTO v_rows, v_ledger FROM public.sale_payments WHERE sale_id = v_sale.id;
  v_refundable := CASE WHEN v_rows > 0 THEN v_ledger
                       ELSE least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0)) - COALESCE(v_sale.refunded_amount, 0) END;
  IF round(p_amount, 2) > v_refundable THEN
    RAISE EXCEPTION 'Refund exceeds what was paid on this sale (at most %)', v_refundable USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  SELECT sh.id INTO v_shift FROM public.pos_shifts sh
   WHERE sh.business_id = v_sale.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL LIMIT 1;

  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id, note)
  VALUES (v_sale.business_id, v_sale.id, 'refund', p_method, round(p_amount, 2),
          auth.uid(), v_actor.staff_id, v_actor.staff_name, v_shift, v_reason);

  UPDATE public.sales SET refunded_amount = COALESCE(refunded_amount, 0) + round(p_amount, 2) WHERE id = v_sale.id;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'owner', v_sale.business_id, 'sale.refunded', 'sale', v_sale.id, jsonb_build_object(
    'txn_no', v_sale.txn_no, 'reason', v_reason, 'amount', round(p_amount, 2), 'method', p_method,
    'refunded_before', COALESCE(v_sale.refunded_amount, 0), 'refunded_after', COALESCE(v_sale.refunded_amount, 0) + round(p_amount, 2)));

  RETURN jsonb_build_object('sale_id', v_sale.id, 'refunded', round(p_amount, 2),
    'refunded_total', COALESCE(v_sale.refunded_amount, 0) + round(p_amount, 2));
END $$;

-- ---------------------------------------------------------------------------
-- 9. Grants (re-verify proacl after apply: Supabase re-grants anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_guard_direct_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_guard_direct_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_close_resumed_hold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_items_array(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_stock_lines(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_apply_stock_delta(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_sale(uuid, jsonb, numeric, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sale(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_sale(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_sale(uuid, jsonb, numeric, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sale(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_sale(uuid, numeric, text, text) TO authenticated;
