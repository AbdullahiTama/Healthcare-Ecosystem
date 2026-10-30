-- ─────────────────────────────────────────────────────────────────────────────
-- SNAPSHOT, NOT A MIGRATION. Do not run this file.
-- ─────────────────────────────────────────────────────────────────────────────
-- The live stock ledger on the `carehub` project, captured 2026-10-30 with
-- pg_get_functiondef / pg_get_triggerdef / pg_get_constraintdef.
--
-- Why this file exists: production's schema_migrations lists
-- carehub_20261140_inventory_integrity_foundation (+ 20261140b) as applied on
-- 2026-10-21, but no file for it exists on any branch of this repository
-- (`git log --all -S apply_stock_change` finds nothing). Code was being
-- written against a stock model the repository could not show. This records
-- what is live so reviewers and future migrations can see it. The original
-- migration should be recovered from whoever applied it and committed in
-- place of this snapshot.
--
-- Facts at capture time: all 11,351 products have tracking_mode = 'none';
-- 636 have stock < 0 (oversold before the floor existed); no tracked product
-- disagrees with its batches.
--
-- Known gap: increment_product_stock (C12, used by Purchases and Inventory's
-- + Stock) predates this ledger and bypasses it. It writes products.stock
-- directly, so restocks leave no stock_movements row, and on a batch-tracked
-- product it would make stock disagree with its batches. Moving those callers
-- to apply_stock_change(..., 'purchase_receipt' | 'adjustment', ...) is the
-- follow-up. merge_duplicate_products (supabase/migrations/
-- carehub_20261220_merge_duplicate_products.sql) already uses the ledger.
-- See docs/architecture/Stock-Ledger.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- products.tracking_mode
--   CHECK ((tracking_mode = ANY (ARRAY['none'::text, 'batch_only'::text, 'batch_expiry'::text])))
--   tracking_mode text NOT NULL DEFAULT 'none'

-- stock_movements (columns): id, business_id, batch_id, from_location_id,
--   to_location_id, movement_type NOT NULL, quantity NOT NULL, reason,
--   moved_by, created_at, product_id, source_type, source_id, source_line_id,
--   idempotency_key, actor_id, qty_before, qty_after
-- stock_movements_type_check:
--   CHECK ((movement_type = ANY (ARRAY['opening'::text, 'purchase_receipt'::text, 'sale'::text, 'sale_reversal'::text,
--          'return_restock'::text, 'return_writeoff'::text, 'adjustment'::text, 'write_off'::text, 'transfer'::text,
--          'tracking_change'::text, 'correction'::text])))

-- Triggers
-- CREATE TRIGGER enforce_product_stock_floor BEFORE INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION enforce_product_stock_floor();
-- CREATE TRIGGER guard_product_tracking BEFORE INSERT OR UPDATE OF tracking_mode ON public.products FOR EACH ROW EXECUTE FUNCTION guard_product_tracking();
-- CREATE TRIGGER journal_opening_stock AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION journal_opening_stock();
-- CREATE TRIGGER enforce_batch_quantity_floor BEFORE INSERT OR UPDATE OF quantity ON public.stock_batches FOR EACH ROW EXECUTE FUNCTION enforce_batch_quantity_floor();
-- CREATE TRIGGER guard_stock_movement_append_only BEFORE DELETE OR UPDATE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION guard_stock_movement_append_only();

-- EXECUTE grants: apply_stock_change and set_product_tracking_mode to
-- postgres, authenticated, service_role (no anon). journal_opening_stock to
-- postgres, service_role only.

CREATE OR REPLACE FUNCTION public.in_stock_authority()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(current_setting('carehub.stock_authority', true), '') = 'on'
$function$;

CREATE OR REPLACE FUNCTION public.apply_stock_change(p_business_id uuid, p_product_id uuid, p_delta integer, p_movement_type text, p_batch_id uuid DEFAULT NULL::uuid, p_source_type text DEFAULT NULL::text, p_source_id text DEFAULT NULL::text, p_source_line_id text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev       text := coalesce(current_setting('carehub.stock_authority', true), '');
  v_stock      integer;
  v_mode       text;
  v_category   text;
  v_batch_qty  integer;
  v_new_stock  integer;
  v_sum        bigint;
  v_existing   uuid;
  v_mid        uuid;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'apply_stock_change: quantity change must be a non-zero integer'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT stock, tracking_mode, category INTO v_stock, v_mode, v_category
    FROM public.products
   WHERE id = p_product_id AND business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: product % does not exist in this business', p_product_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.stock_movements
     WHERE business_id = p_business_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  IF coalesce(v_category, '') = 'Services' THEN
    RETURN NULL;
  END IF;

  IF v_mode <> 'none' AND p_batch_id IS NULL THEN
    RAISE EXCEPTION 'BATCH_REQUIRED: this product is batch-tracked; a batch must be named'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_batch_id IS NOT NULL THEN
    SELECT quantity INTO v_batch_qty FROM public.stock_batches
     WHERE id = p_batch_id AND business_id = p_business_id AND product_id = p_product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BATCH_NOT_FOUND: batch % does not belong to this product', p_batch_id
        USING ERRCODE = 'no_data_found';
    END IF;
    IF v_batch_qty + p_delta < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: batch holds % but % was requested', v_batch_qty, -p_delta
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_new_stock := coalesce(v_stock, 0) + p_delta;
  IF p_delta < 0 AND v_new_stock < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: product holds % but % was requested', coalesce(v_stock, 0), -p_delta
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carehub.stock_authority', 'on', true);

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.stock_batches SET quantity = quantity + p_delta
     WHERE id = p_batch_id AND business_id = p_business_id;
  END IF;
  UPDATE public.products SET stock = v_new_stock
   WHERE id = p_product_id AND business_id = p_business_id;

  IF v_mode <> 'none' THEN
    SELECT coalesce(sum(quantity), 0) INTO v_sum FROM public.stock_batches
     WHERE product_id = p_product_id AND business_id = p_business_id;
    IF v_sum <> v_new_stock THEN
      RAISE EXCEPTION 'INVENTORY_INCONSISTENT: batches total % but product stock would be % — reconcile before trading',
        v_sum, v_new_stock USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    business_id, product_id, batch_id, movement_type, quantity,
    qty_before, qty_after, source_type, source_id, source_line_id,
    reason, idempotency_key, actor_id, moved_by
  ) VALUES (
    p_business_id, p_product_id, p_batch_id, p_movement_type, p_delta,
    coalesce(v_stock, 0), v_new_stock, p_source_type, p_source_id, p_source_line_id,
    p_reason, p_idempotency_key, auth.uid(), coalesce(p_actor_name, auth.email())
  ) RETURNING id INTO v_mid;

  PERFORM set_config('carehub.stock_authority', v_prev, true);
  RETURN v_mid;
END;
$function$;

COMMENT ON FUNCTION public.apply_stock_change(uuid, uuid, integer, text, uuid, text, text, text, text, text, text) IS
  'The single stock-writing function. Locks product then batch, refuses negative stock, keeps products.stock = sum(batches) for tracked products, journals one stock_movements row, idempotent on p_idempotency_key. SECURITY INVOKER: RLS is the tenant boundary.';

CREATE OR REPLACE FUNCTION public.set_product_tracking_mode(p_product_id uuid, p_business_id uuid, p_mode text, p_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev      text := coalesce(current_setting('carehub.stock_authority', true), '');
  v_stock     integer;
  v_old_mode  text;
  v_category  text;
  v_sum       bigint;
  v_no_expiry bigint;
BEGIN
  IF p_mode NOT IN ('none', 'batch_only', 'batch_expiry') THEN
    RAISE EXCEPTION 'invalid tracking mode %', p_mode USING ERRCODE = 'check_violation';
  END IF;

  SELECT stock, tracking_mode, category INTO v_stock, v_old_mode, v_category
    FROM public.products
   WHERE id = p_product_id AND business_id = p_business_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: product % does not exist in this business', p_product_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_old_mode = p_mode THEN RETURN p_mode; END IF;

  IF coalesce(v_category, '') = 'Services' AND p_mode <> 'none' THEN
    RAISE EXCEPTION 'a service has no stock to track' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(quantity), 0),
         count(*) FILTER (WHERE quantity > 0 AND expiry_date IS NULL)
    INTO v_sum, v_no_expiry
    FROM public.stock_batches
   WHERE product_id = p_product_id AND business_id = p_business_id;

  IF v_sum <> coalesce(v_stock, 0) THEN
    RAISE EXCEPTION
      'OPENING_STOCK_UNALLOCATED: product holds % but its batches total % — allocate or correct the batches with a physical count first',
      coalesce(v_stock, 0), v_sum USING ERRCODE = 'check_violation';
  END IF;
  IF p_mode = 'batch_expiry' AND v_no_expiry > 0 THEN
    RAISE EXCEPTION 'EXPIRY_REQUIRED: % batch(es) holding stock have no expiry date', v_no_expiry
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('carehub.stock_authority', 'on', true);
  UPDATE public.products SET tracking_mode = p_mode
   WHERE id = p_product_id AND business_id = p_business_id;

  INSERT INTO public.stock_movements (
    business_id, product_id, movement_type, quantity, qty_before, qty_after,
    source_type, source_id, reason, actor_id, moved_by
  ) VALUES (
    p_business_id, p_product_id, 'tracking_change', 0, v_stock, v_stock,
    'tracking_mode', v_old_mode || '->' || p_mode,
    coalesce(p_reason, 'Tracking mode changed'), auth.uid(), auth.email()
  );
  PERFORM set_config('carehub.stock_authority', v_prev, true);
  RETURN p_mode;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_product_stock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stock < 0
     AND (TG_OP = 'INSERT' OR NEW.stock < coalesce(OLD.stock, 0)) THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: product stock cannot be reduced below zero (would be %).', NEW.stock
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_batch_quantity_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.quantity < 0
     AND (TG_OP = 'INSERT' OR NEW.quantity < coalesce(OLD.quantity, 0)) THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: batch quantity cannot be reduced below zero (would be %).', NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_product_tracking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tracking_mode <> 'none' AND coalesce(NEW.stock, 0) <> 0 THEN
      RAISE EXCEPTION
        'TRACKING_REQUIRES_BATCHES: a % product cannot be created with stock — receive it into batches instead.',
        NEW.tracking_mode USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tracking_mode IS DISTINCT FROM OLD.tracking_mode
     AND NOT public.in_stock_authority()
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION
      'TRACKING_MODE_LOCKED: change a product''s tracking mode through set_product_tracking_mode().'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_stock_movement_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.batch_id IS NULL AND OLD.batch_id IS NOT NULL
     AND (to_jsonb(NEW) - 'batch_id') = (to_jsonb(OLD) - 'batch_id') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'LEDGER_APPEND_ONLY: stock movements cannot be % — record a correcting movement instead.',
    lower(TG_OP) USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.journal_opening_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(NEW.stock, 0) > 0 AND coalesce(NEW.category, '') <> 'Services' THEN
    INSERT INTO public.stock_movements (
      business_id, product_id, movement_type, quantity, qty_before, qty_after,
      source_type, source_id, reason, actor_id, moved_by
    ) VALUES (
      NEW.business_id, NEW.id, 'opening', NEW.stock, 0, NEW.stock,
      'product_created', NEW.id::text, 'Opening stock on product creation',
      auth.uid(), auth.email()
    );
  END IF;
  RETURN NEW;
END;
$function$;
