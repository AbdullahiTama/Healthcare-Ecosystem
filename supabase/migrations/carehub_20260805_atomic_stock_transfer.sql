-- ============================================================================
-- Atomic stock transfer and adjustment
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-05, on explicit user authorization.
-- Applied as TRACKED migrations, recorded in supabase_migrations.schema_migrations
-- (untracked direct changes are what produced C16 and C17):
--   20260805075311  atomic_stock_transfer
--   20260805075332  atomic_stock_adjustment
--   20260805075408  restrict_stock_batch_rpcs_to_authenticated   — ACL follow-up
--
-- ACL FOLLOW-UP (why there are three migrations, not two)
-- -------------------------------------------------------
-- The REVOKE ... FROM PUBLIC below did NOT produce the intended ACL on its own.
-- Read back immediately after applying, both functions showed:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Supabase's default privileges re-grant EXECUTE to anon at function-creation
-- time, AFTER the revoke runs — the same trap that forced a second migration in
-- C5. A third migration revoked anon explicitly. Verified after:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Never a live hole (both are SECURITY INVOKER, so an anon caller has no
-- current_business_ids() and the locked lookup matches zero rows) — but the
-- lesson stands: re-read proacl, never trust the REVOKE statement.
--
-- VERIFIED IN PRODUCTION, end to end, 2026-08-05
-- -----------------------------------------------
-- Run inside a DO block that RAISEd at the end, so everything rolled back and
-- nothing entered the live tables (confirmed after: still 1 batch, 0 movements,
-- 0 SELFTEST rows, 0 SELFTEST locations). Results, all as expected:
--   split source qty                    70    (from 100, moving 30)
--   split destination qty               30
--   CONSERVED TOTAL                    100
--   destination batch_number      B-SELFTEST  (identity follows the stock)
--   destination expiry            2027-01-01
--   destination cost_price            250.50  (the old code dropped this)
--   destination sales_unit               box  (dropped too)
--   destination notes          'selftest note'(dropped too)
--   movement qty / type           30 / transfer
--   movement from=A / to=B             t / t
--   over-transfer refused with  'You only have 70 units in this batch.'
--       ^ 70, NOT the stale 100 — proof the check reads the locked, current
--         quantity. This is the race fix, demonstrated.
--   cross-tenant call returned          NULL  (silent no-op, as designed)
--   adjust 70 -> 64 returned diff         -6  (computed server-side)
--   adjust movement journalled            -6
--   total movements journalled             2
--
-- Advisors re-run after applying: identical to the pre-change baseline of 27
-- findings. Neither new function appears (both SECURITY INVOKER with a pinned
-- search_path). pg_proc shows exactly one row per name — no sibling overloads,
-- the C15/C17 trap.
--
-- Client side: modules/stock/repositories calls these two RPCs. Its tests
-- assert the call shape (one write, right arguments, difference NOT sent from
-- the client); the transactional behaviour is proven by the block above rather
-- than faked in the in-memory adapter.
--
-- WHAT THIS FIXES
-- ---------------
-- 1. TRANSFER IS NOT ATOMIC (the reason this file exists).
--    Moving PART of a batch was two client-issued writes with no transaction:
--      a) decrement the source batch
--      b) insert a new batch at the destination
--    If (b) failed after (a) succeeded, the units were debited from the source
--    and arrived nowhere — stock silently vanished. Worse, the movement row is
--    written last, so nothing recorded the loss either: no error trail, no
--    journal entry, just a smaller number. Same class as the partial
--    offline-sync data loss fixed earlier in the repository-seam rollout.
--
-- 2. TRANSFER HAD A LOST-UPDATE RACE.
--    The quantity check ran in JavaScript against a batch read earlier. Two
--    users transferring from the same batch could both see quantity = 100 and
--    each move 60, driving it to -20 (or to 40, depending on interleaving) —
--    the check passed for both because neither saw the other's write. The
--    SELECT ... FOR UPDATE below serialises them.
--
-- 3. ADJUST JOURNALLED A STALE DIFFERENCE.
--    `adjust` computed `diff = newQty - batch.quantity` in JavaScript from a
--    possibly-stale read, then wrote that diff into the audit log. If the batch
--    had changed since the page loaded, the movement recorded a difference that
--    never happened. The difference is now computed server-side from the locked
--    row, so the journal cannot disagree with the table. Its two writes are
--    also now one transaction.
--
--    NOTE: fixing `adjust` was not strictly asked for — the request was the
--    transfer atomicity. It is included because it is the same bug class in the
--    same operation pair and the same file, and leaving it would mean a second
--    pass over this exact code. Drop the second function if that is not wanted;
--    the two are independent.
--
-- BLAST RADIUS (measured, not assumed — 2026-08-05, live)
-- -------------------------------------------------------
--   stock_batches                     1 row
--   stock_movements                   0 rows
--   stock_movements WHERE type=transfer  0 rows
-- So no transfer has ever run in production and no historical data depends on
-- the old behaviour. This is a fix-before-it-bites, not a repair — which is
-- also why it is safe to correct the column-copy gap below in the same change.
--
-- COLUMN-COPY GAP CORRECTED (a real behaviour change, called out deliberately)
-- ---------------------------------------------------------------------------
-- The old split copied 11 columns onto the destination batch and silently
-- dropped four that exist on the table: notes, cost_price, selling_price and
-- sales_unit. A split batch therefore lost its costing and its unit, and the
-- destination half came back with cost_price = 0 / selling_price = 0 (column
-- defaults). All four are copied below.
-- Measured before changing it: of the 1 live batch, 0 have a non-zero
-- cost_price, 0 a non-zero selling_price, 0 a sales_unit and 0 any notes — so
-- the correction is inert on today's data and cannot alter an existing row.
-- It matters the moment the receive form starts capturing those fields.
--
-- SECURITY MODEL
-- --------------
-- SECURITY INVOKER (stated explicitly, not merely defaulted) with a pinned
-- search_path — deliberately NOT SECURITY DEFINER. Both statements run as the
-- caller, so the existing RLS on both tables does the tenant enforcement:
--   stock_batches   "stock_batches of own business"
--   stock_movements "stock_movements of own business"
--   both: (business_id IN (SELECT current_business_ids())) OR is_platform_admin()
--   both: ALL, with a matching WITH CHECK  -- verified live 2026-08-05
-- A caller passing another business's batch id matches zero rows and gets NULL
-- back — the same no-op the scoped PATCH in the repository already produced.
-- No new publicly-callable SECURITY DEFINER surface is introduced; that is the
-- exact pattern that produced C15 and C17.
--
-- Advisor baseline taken immediately before writing this (2026-08-05): 27
-- findings, all pre-existing and already listed in SESSION-STATE §4. Neither
-- function below should add one — increment_product_stock, built the same way
-- in C5, does not appear in that baseline.
--
-- THE ACL FOLLOW-UP, AS APPLIED (kept here so this file is self-contained)
-- ------------------------------------------------------------------------
--   REVOKE EXECUTE ON FUNCTION public.transfer_stock_batch(uuid,uuid,uuid,integer,text) FROM anon;
--   REVOKE EXECUTE ON FUNCTION public.adjust_stock_batch(uuid,uuid,integer,text,text) FROM anon;
--
-- VERIFICATION QUERIES (do not trust the statements — re-read the catalog):
--   1. No sibling overloads left behind — CREATE OR REPLACE does not drop a
--      differently-signed twin, which is precisely how C15 and C17 happened:
--        select oid::regprocedure, prosecdef, proconfig from pg_proc
--        where proname in ('transfer_stock_batch','adjust_stock_batch');
--      Expect exactly one row each, prosecdef = false, proconfig = search_path.
--   2. Re-read the ACL rather than trusting the REVOKE — Supabase's default
--      privileges re-grant EXECUTE to anon/authenticated at creation time,
--      AFTER the revoke runs (this is what forced a second migration in C5):
--        select proname, proacl from pg_proc where proname in (...);
--      Expect postgres | authenticated | service_role. No anon.
--   3. get_advisors(security) — expect zero new findings versus the baseline.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Atomic transfer between warehouses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_stock_batch(
  p_batch_id       uuid,
  p_business_id    uuid,
  p_to_location_id uuid,
  p_qty            integer,
  p_moved_by       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch   public.stock_batches%ROWTYPE;
  v_dest_id uuid;
BEGIN
  -- The client validates this too, for a friendlier message and a fast fail.
  -- This copy is the authoritative one: it is the only check that cannot be
  -- bypassed by calling the RPC directly, and the only one that sees the
  -- CURRENT quantity rather than whatever the page last loaded.
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Enter a quantity greater than zero.' USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE is the point of the whole exercise: it serialises concurrent
  -- transfers of the same batch, so the quantity check below is made against a
  -- value no other transaction can change underneath it.
  SELECT * INTO v_batch
    FROM public.stock_batches
   WHERE id = p_batch_id
     AND business_id = p_business_id
     FOR UPDATE;

  -- Wrong tenant, or a batch deleted since the page loaded. Returning NULL
  -- rather than raising keeps the contract identical to the scoped PATCH this
  -- replaces, which simply matched zero rows.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_qty > v_batch.quantity THEN
    RAISE EXCEPTION 'You only have % units in this batch.', v_batch.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_qty = v_batch.quantity THEN
    -- Whole batch moves: relocate the row rather than splitting it, so the
    -- batch keeps its identity and history.
    UPDATE public.stock_batches
       SET location_id = p_to_location_id
     WHERE id = v_batch.id;
    v_dest_id := v_batch.id;
  ELSE
    UPDATE public.stock_batches
       SET quantity = quantity - p_qty
     WHERE id = v_batch.id;

    -- Every column that describes the stock follows it, including the four the
    -- old implementation dropped (notes, cost_price, selling_price,
    -- sales_unit). Expiry and batch_number in particular must follow, or the
    -- split half becomes untraceable and never expires.
    INSERT INTO public.stock_batches (
      business_id, location_id, product_id, product_name, batch_number,
      quantity, expiry_date, date_received, supplier_source, storage_location,
      status, notes, received_by, cost_price, selling_price, sales_unit
    ) VALUES (
      v_batch.business_id, p_to_location_id, v_batch.product_id, v_batch.product_name, v_batch.batch_number,
      p_qty, v_batch.expiry_date, v_batch.date_received, v_batch.supplier_source, v_batch.storage_location,
      v_batch.status, v_batch.notes, v_batch.received_by, v_batch.cost_price, v_batch.selling_price, v_batch.sales_unit
    )
    RETURNING id INTO v_dest_id;
  END IF;

  -- Same transaction as the movement of stock above, so the journal can never
  -- disagree with the table: either both happened or neither did.
  INSERT INTO public.stock_movements (
    business_id, batch_id, from_location_id, to_location_id,
    movement_type, quantity, reason, moved_by
  ) VALUES (
    v_batch.business_id, v_batch.id, v_batch.location_id, p_to_location_id,
    'transfer', p_qty, NULL, p_moved_by
  );

  RETURN v_dest_id;
END;
$$;

COMMENT ON FUNCTION public.transfer_stock_batch(uuid, uuid, uuid, integer, text) IS
  'Moves stock between warehouses atomically: splits or relocates the batch and '
  'journals the movement in one transaction, with the source row locked so '
  'concurrent transfers cannot both pass the quantity check. Replaces a '
  'client-side two-write sequence that could lose stock on partial failure. '
  'SECURITY INVOKER — stock_batches/stock_movements RLS enforces the tenant '
  'boundary; a foreign batch id returns NULL.';

REVOKE ALL ON FUNCTION public.transfer_stock_batch(uuid, uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_stock_batch(uuid, uuid, uuid, integer, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. Atomic adjustment (physical count correction)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  p_batch_id    uuid,
  p_business_id uuid,
  p_qty         integer,
  p_reason      text DEFAULT NULL,
  p_moved_by    text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch public.stock_batches%ROWTYPE;
  v_diff  integer;
BEGIN
  IF p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'Enter a valid quantity.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_batch
    FROM public.stock_batches
   WHERE id = p_batch_id
     AND business_id = p_business_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Computed here, from the locked row — not passed in from the client. The
  -- old implementation subtracted against whatever quantity the page had
  -- loaded, so a batch that changed in the meantime was journalled with a
  -- difference that never occurred.
  v_diff := p_qty - v_batch.quantity;

  UPDATE public.stock_batches
     SET quantity = p_qty
   WHERE id = v_batch.id;

  INSERT INTO public.stock_movements (
    business_id, batch_id, from_location_id, to_location_id,
    movement_type, quantity, reason, moved_by
  ) VALUES (
    v_batch.business_id, v_batch.id, v_batch.location_id, NULL,
    'adjustment', v_diff, p_reason, p_moved_by
  );

  RETURN v_diff;
END;
$$;

COMMENT ON FUNCTION public.adjust_stock_batch(uuid, uuid, integer, text, text) IS
  'Corrects a batch to a counted quantity and journals the signed difference in '
  'one transaction, computing that difference from the locked row so the audit '
  'log cannot disagree with the table. SECURITY INVOKER — RLS enforces the '
  'tenant boundary; a foreign batch id returns NULL.';

REVOKE ALL ON FUNCTION public.adjust_stock_batch(uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(uuid, uuid, integer, text, text) TO authenticated;
