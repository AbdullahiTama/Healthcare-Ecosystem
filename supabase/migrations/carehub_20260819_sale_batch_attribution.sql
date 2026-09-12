-- ============================================================================
-- P0 — FEFO batch selection and expired-batch block at POS
--
-- PROBLEM
-- -------
-- Sales at the POS never attribute a line to a stock Batch and never consume
-- `stock_batches.quantity`: `apply_sale_stock_movement` (20260804) decrements
-- only `products.stock`. So the POS cannot pick the nearest-expiry Batch (FEFO)
-- and can still sell an Expired Batch — the top trust-risk for pharmacies.
--
-- FIX
-- ----
-- Batch attribution end-to-end, additive to the existing product-level
-- decrement (which is deliberately NOT changed — `products.stock` still
-- decrements for every line; batch decrement is extra):
--   1. Sale line items carry `batch_id` / `batch_number` / `batch_expiry`
--      (written by the client-side FEFO helper, batchAllocation.js).
--   2. A BEFORE INSERT guard trigger (`guard_sale_batch_expiry`) rejects any
--      line that references an Expired or non-available Batch unless the
--      caller is the business Owner AND the line carries `override_expired:
--      true`. The guard is authoritative: a line that omits batch_id entirely
--      for a product whose only batches are expired/unavailable is rejected
--      too (a client that strips attribution cannot bypass the block).
--      Because it is BEFORE INSERT, a blocked sale never reaches the
--      AFTER INSERT stock triggers — no stock is decremented for a sale that
--      was not allowed.
--   3. An AFTER INSERT trigger (`apply_sale_batch_movement`) decrements
--      `stock_batches.quantity` and journals a `stock_movements` row
--      (movement_type `sale`, negative qty, reason carries the txn_no) in the
--      same transaction as the sale insert.
-- Products without batches carry no batch_id on their lines and behave exactly
-- as before (both triggers skip them).
--
-- SECURITY MODEL
-- --------------
-- SECURITY INVOKER (Postgres' default, stated explicitly) with search_path
-- pinned to public — deliberately NOT SECURITY DEFINER, exactly the pattern
-- used by apply_sale_stock_movement and guard_sale_item_prices. Every read and
-- write runs as the caller, so the existing business-scoped RLS on
-- `stock_batches`/`stock_movements` does the tenant enforcement for free, and
-- each statement pins `business_id = NEW.business_id` explicitly as belt and
-- braces. A line referencing another business's batch id matches zero rows and
-- is skipped, never blocked and never decremented — the established failure
-- policy (see guard_sale_item_prices header).
--
-- Trusted service roles / platform admins pass through untouched (same
-- exemption list as guard_sale_item_prices): server endpoints and migrations
-- (service_role/postgres/supabase_admin/supabase_auth_admin) plus
-- is_platform_admin(). A service_role sales write is trusted by design.
--
-- HOW THE OWNER IS RESOLVED (must mirror the app exactly)
-- --------------------------------------------------------
-- The frontend's BusinessDashboard sets `role = staffUser?.role || 'Owner'`
-- and POS derives `isOwner = role === 'Owner'`. The trigger resolves the owner
-- the same way guard_sale_item_prices does: business owner by email match on
-- the sale's business (`businesses.email = auth.email()`), falling back to an
-- active staff row whose role is 'Owner' (by auth_user_id OR email). This is
-- the same identity RLS trusts for business-scoped access, so the trigger
-- cannot disagree with who RLS allows to insert, nor with the UI's isOwner.
--
-- OVERRIDE CONTRACT
-- -----------------
-- `override_expired` is an explicit per-line flag: the line that dips into
-- expired/unavailable stock carries `override_expired: true`. Both halves of
-- the condition are required — Owner WITHOUT the flag and the flag WITHOUT the
-- Owner are both rejected. A forged flag from a non-owner is rejected because
-- the trigger checks the caller's ownership, never the flag alone.
--
-- FAILURE POLICY
-- --------------
-- The AFTER INSERT decrement must NEVER raise: a sale is money that already
-- changed hands (same fail-safe as apply_sale_stock_movement). Every value is
-- guarded and every unparseable/unmatched line is skipped. The worst case is
-- the pre-existing behaviour — no batch decrement — never a lost sale. The
-- guard trigger, by contrast, is SUPPOSED to raise: its whole job is to reject
-- a sale that must not happen.
--
-- ADVISOR NOTE
-- ------------
-- Both functions are SECURITY INVOKER with a pinned search_path, so they must
-- not appear as function_search_path_mutable or as anon/authenticated
-- SECURITY DEFINER finding. Re-run get_advisors(security) after applying and
-- compare to the pre-change baseline.
--
-- VERIFY AFTER APPLYING
-- ---------------------
--   1. Both functions exist, prosecdef = false, proconfig = search_path, and
--      exactly one pg_proc row each (no sibling overloads — the C15/C17 trap):
--        select oid::regprocedure, prosecdef, proconfig from pg_proc
--        where proname in ('guard_sale_batch_expiry','apply_sale_batch_movement');
--   2. Both triggers are attached to public.sales.
--   3. As a NON-owner member of a test business, POST a sale whose line
--      references an expired/unavailable batch (with a real batch_id):
--        expect HTTP 400, check_violation message naming the batch and expiry,
--        and NO change to stock_batches.quantity or stock_movements.
--   4. As that same member, POST the same line with the batch_id omitted:
--        expect 201 (no-batch lines behave as before).
--   5. As the Owner, POST the same expired-batch line WITHOUT the flag:
--        expect 400. WITH `override_expired: true`: expect 201, quantity
--        decremented, and a `sale` movement row journalled.
--   6. Advisors after: identical to the pre-change baseline.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. BEFORE INSERT guard — never sell an expired or unavailable batch
--    unless the Owner explicitly overrides on that line
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_sale_batch_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_items         jsonb;
  v_item          jsonb;
  v_batch_id      uuid;
  v_batch_status  text;
  v_batch_expiry  date;
  v_batch_number  text;
  v_is_owner      boolean;
  v_override      boolean;
  v_product_id    uuid;
  v_total_cnt     bigint;
  v_sellable_cnt  bigint;
BEGIN
  -- Server endpoints, migrations and platform admins are trusted here (same
  -- exemption list as guard_sale_item_prices). is_platform_admin() only
  -- SELECTs, so calling it from a trigger on sales cannot recurse.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- (a) Business owner by email takes precedence, mirroring
  -- resolveAccountByEmail. This is also the only way a caller with no staff
  -- row can pass the sales RLS with_check. The staff-role fallback below
  -- mirrors guard_sale_item_prices exactly, so the trigger and the frontend
  -- (role = staffUser?.role || 'Owner', isOwner = role === 'Owner') can never
  -- disagree about who may override.
  SELECT EXISTS (
    SELECT 1 FROM businesses b
     WHERE b.id = NEW.business_id
       AND lower(b.email) = lower(auth.email())
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    -- (b) Active staff of this business whose role is Owner — by auth_user_id
    -- OR email, the two identities the RLS helper accepts (same lookup as
    -- guard_sale_item_prices). A staff row with role 'Owner' is the business
    -- owner in the app, so the trigger must treat it the same way.
    SELECT EXISTS (
      SELECT 1 FROM staff s
       WHERE s.business_id = NEW.business_id
         AND s.status = 'active'
         AND s.role = 'Owner'
         AND (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
    ) INTO v_is_owner;
  END IF;

  -- Unwrap the double-encoded items shape the app writes (a jsonb scalar
  -- string holding the real array) — same guard shape as the other sales
  -- triggers. Unparseable payload: never fail the money record here.
  BEGIN
    v_items := CASE jsonb_typeof(NEW.items)
                 WHEN 'string' THEN (NEW.items #>> '{}')::jsonb
                 ELSE NEW.items
               END;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    BEGIN
      v_batch_id := (v_item->>'batch_id')::uuid;
    EXCEPTION WHEN others THEN
      -- No usable batch reference on this line: nothing to guard.
      v_batch_id := NULL;
    END;

    -- Lines without a batch_id are NOT automatically trusted: a client that
    -- omits attribution for a product whose ONLY batches are expired must not
    -- silently bypass the block. The guard resolves the product's own batches
    -- and decides. A product with zero batches (NO_BATCHES / services / legacy
    -- lines) keeps today's behavior; a product with at least one sellable
    -- batch is fine even when unattributed (a legacy queued sale, or a
    -- client-side attribution miss — no expired stock is involved). Only a
    -- product whose batches are ALL expired/unavailable is blocked.
    IF v_batch_id IS NULL THEN
      BEGIN
        v_product_id := coalesce((v_item->>'id')::uuid, (v_item->>'product_id')::uuid);
      EXCEPTION WHEN others THEN
        v_product_id := NULL;
      END;

      IF v_product_id IS NOT NULL THEN
        -- Tenant-scoped: does this product have ANY batches, and if so any
        -- sellable ones? A product with zero batches (NO_BATCHES, services,
        -- legacy lines) must keep today's behavior — only a product that HAS
        -- batches, all of them expired/unavailable, is the strip-attribution
        -- bypass the guard exists to close.
        SELECT
            count(*)                                                       AS total_batches,
            count(*) FILTER (WHERE status = 'available'
                             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)) AS sellable_batches
          INTO v_total_cnt, v_sellable_cnt
          FROM public.stock_batches b
         WHERE b.product_id = v_product_id
           AND b.business_id = NEW.business_id;

        IF v_total_cnt > 0 AND v_sellable_cnt = 0 THEN
          -- The product has batches and NONE are sellable: an unattributed
          -- line for it is exactly the strip-attribution bypass. Same
          -- override contract as an attributed line — Owner AND the flag.
          BEGIN
            v_override := coalesce((v_item->>'override_expired')::boolean, false);
          EXCEPTION WHEN others THEN
            v_override := false;
          END;

          IF NOT (v_is_owner AND v_override) THEN
            RAISE EXCEPTION
              '"%" has no sellable batches — every batch is expired or unavailable. Only the Owner can override an expired or unavailable batch.',
              coalesce(v_item->>'name', v_product_id::text)
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END IF;

      CONTINUE;
    END IF;

    -- Tenant-scoped batch lookup: stock_batches RLS plus an explicit
    -- business_id pin. A batch of another business (or a deleted one) matches
    -- zero rows and is skipped, never blocked — the established policy.
    SELECT b.status, b.expiry_date, b.batch_number
      INTO v_batch_status, v_batch_expiry, v_batch_number
      FROM public.stock_batches b
     WHERE b.id = v_batch_id
       AND b.business_id = NEW.business_id
     LIMIT 1;

    IF v_batch_status IS NULL THEN
      CONTINUE;
    END IF;

    -- Sellable = status 'available' AND not past expiry. A batch expiring
    -- today is still sellable through the day (matches the client's FEFO
    -- helper); a batch with no expiry date is treated as never-expiring
    -- (Purchases only writes one when the user supplies it).
    IF v_batch_status = 'available'
       AND (v_batch_expiry IS NULL OR v_batch_expiry >= CURRENT_DATE) THEN
      CONTINUE;
    END IF;

    -- Non-available or expired batch: both halves of the override are
    -- required — the caller must be the Owner AND the line must carry
    -- `override_expired: true`. Rejected with check_violation (PostgREST
    -- maps 23514 to HTTP 400, which isServerRejection treats as a permanent
    -- rejection: the sale is never parked on the offline queue).
    BEGIN
      v_override := coalesce((v_item->>'override_expired')::boolean, false);
    EXCEPTION WHEN others THEN
      v_override := false;
    END;

    IF NOT (v_is_owner AND v_override) THEN
      RAISE EXCEPTION
        'Batch "%" cannot be sold — status "%", expires %. Only the Owner can override an expired or unavailable batch.',
        coalesce(v_batch_number, v_batch_id::text), v_batch_status,
        coalesce(v_batch_expiry::text, 'none')
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_sale_batch_expiry() IS
  'P0: blocks a sale line that references an expired or non-available batch '
  'unless the business Owner explicitly overrides on that line '
  '(override_expired = true). SECURITY INVOKER so stock_batches RLS enforces '
  'the tenant boundary; a foreign/deleted batch is skipped. Trusted service '
  'roles and platform admins pass through. Runs BEFORE INSERT so a blocked '
  'sale never decrements any stock.';

-- ---------------------------------------------------------------------------
-- 2. AFTER INSERT — consume the batch and journal the sale movement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_sale_batch_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_items   jsonb;
  v_item    jsonb;
  v_batch_id uuid;
  v_qty     numeric;
  v_old_qty integer;
  v_applied integer;
BEGIN
  -- A held sale is not takings yet; batches move when it is actually charged.
  -- INSERT-only on purpose, like apply_sale_stock_movement: resuming a held
  -- sale UPDATEs it and the real charge INSERTs a brand new row, so batch
  -- consumption fires exactly once per sale.
  IF coalesce(NEW.is_on_hold, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.items IS NULL OR NEW.business_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_items := CASE jsonb_typeof(NEW.items)
                 WHEN 'string' THEN (NEW.items #>> '{}')::jsonb
                 ELSE NEW.items
               END;
  EXCEPTION WHEN others THEN
    -- Unparseable payload: record the sale, skip the batch movement.
    RETURN NEW;
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    BEGIN
      v_batch_id := (v_item->>'batch_id')::uuid;
    EXCEPTION WHEN others THEN
      v_batch_id := NULL;
    END;

    -- Lines without a batch_id (NO_BATCHES products, services) keep today's
    -- behavior: the product-level decrement still runs, this one does nothing.
    IF v_batch_id IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      v_qty := (v_item->>'qty')::numeric;
    EXCEPTION WHEN others THEN
      v_qty := NULL;
    END;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Decrement the batch, clamped at zero like the product decrement (the
    -- same accepted tradeoff as apply_sale_stock_movement). Read the pre-state
    -- under the same row lock the UPDATE takes, so the journal below reflects
    -- the ACTUAL decrement — never a phantom movement for stock this batch did
    -- not hold (a sale of qty 5 against a batch of 3 journals -3, not -5; a
    -- batch already at zero journals nothing).
    SELECT coalesce(b.quantity, 0) INTO v_old_qty
      FROM public.stock_batches b
     WHERE b.id = v_batch_id
       AND b.business_id = NEW.business_id
     FOR UPDATE;

    IF NOT FOUND THEN
      -- A batch of another business (or deleted) matches zero rows: skip —
      -- the established policy, never fatal.
      CONTINUE;
    END IF;

    v_applied := LEAST(v_qty::int, v_old_qty);
    IF v_applied <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.stock_batches b
       SET quantity = v_old_qty - v_applied
     WHERE b.id = v_batch_id
       AND b.business_id = NEW.business_id;

    -- Same transaction as the sale (AFTER INSERT in the same statement), so
    -- the journal can never disagree with the table: either both happened
    -- or the whole sale rolled back. movement_type stays free-text and joins
    -- the existing 'transfer' / 'adjustment' values.
    INSERT INTO public.stock_movements (
      business_id, batch_id, from_location_id, to_location_id,
      movement_type, quantity, reason, moved_by
    ) VALUES (
      NEW.business_id, v_batch_id, NULL, NULL,
      'sale', -v_applied, 'Sale ' || NEW.txn_no, NULL
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_sale_batch_movement() IS
  'P0: consumes stock_batches.quantity for each line item of a completed (not '
  'held) sale that carries a batch_id, and journals a stock_movements row '
  '(movement_type sale, negative quantity, reason = Sale <txn_no>) in the same '
  'transaction. The journaled quantity is the ACTUAL decrement (min of line '
  'qty and quantity on hand) — never a phantom movement for stock the batch '
  'did not hold. SECURITY INVOKER so stock_batches/stock_movements RLS '
  'enforces the tenant boundary. Never raises — a sale is never lost because '
  'batch stock could not be adjusted. Additive to apply_sale_stock_movement '
  '(products.stock still decrements for every line).';

DROP TRIGGER IF EXISTS guard_sale_batch_expiry ON public.sales;
CREATE TRIGGER guard_sale_batch_expiry
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sale_batch_expiry();

DROP TRIGGER IF EXISTS sale_batch_movement ON public.sales;
CREATE TRIGGER sale_batch_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_sale_batch_movement();