-- ============================================================================
-- C5 — make a sale actually decrement stock (and make replenishment atomic)
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-04, on explicit user authorization.
-- Applied as TRACKED migrations via the Supabase MCP connector, so they are
-- recorded in supabase_migrations.schema_migrations rather than being untracked
-- direct changes (the failure mode behind C16 and C17):
--   1. sale_stock_movement_and_atomic_replenishment   — the objects below
--   2. restrict_increment_product_stock_to_authenticated — ACL follow-up, see note
--
-- ACL FOLLOW-UP (why there are two migrations, not one)
-- -----------------------------------------------------
-- The REVOKE ALL ON FUNCTION ... FROM PUBLIC below did not produce the intended
-- ACL on its own: Supabase's default privileges grant EXECUTE on new public
-- functions to anon/authenticated/service_role at creation time, which re-added
-- anon after the revoke ran. A second migration revoked anon explicitly.
-- Verified after: acl = postgres | authenticated | service_role.
-- This was never a live hole (increment_product_stock is SECURITY INVOKER, so
-- an anon caller has no current_business_ids() and matches zero rows) — but the
-- lesson generalises: after any GRANT/REVOKE here, re-read proacl rather than
-- trusting the statement to be the final word.
--
-- VERIFIED IN PRODUCTION, end to end, 2026-08-04
-- -----------------------------------------------
-- Run inside a DO block that raised at the end, so the test sale rolled back
-- and never entered the sales ledger (confirmed after: stock restored to its
-- original value, zero TRIGGER-SELFTEST rows remaining):
--   product stock before                          6500
--   after a completed sale of qty 3               6497   (decremented exactly 3)
--   after a HELD sale of qty 3                    6497   (unchanged, as intended)
-- The test deliberately used the double-encoded items shape the app writes, so
-- the branch that would have silently no-opped is the one that was proven.
--
-- Advisors re-run after applying: identical to the pre-change baseline. Neither
-- new function appears (both SECURITY INVOKER with a pinned search_path).
--
-- WHAT THIS FIXES
-- ---------------
-- C5: selling through POS has never reduced products.stock. POS.jsx decrements
-- only React state (setProducts), which BusinessDashboard re-seeds from the
-- database on every mount, so the decrease a cashier sees is cosmetic. Verified
-- server-side on 2026-08-04: a pg_trigger/pg_proc sweep returned zero rows —
-- nothing in the database touched products.stock. Consequently products.stock
-- is overstated by every unit ever sold, and POS's out-of-stock badges,
-- Inventory's valuation totals and CareFind's `stock > 0` listing filter all
-- read that inflated number.
--
-- Decision (2026-08-04): fix forward only. Existing quantities are NOT
-- backfilled — 29 of 83 historical line items (35%) reference product ids that
-- no longer exist in `products` (duplicate-merge deletes the losing rows), so a
-- replay of sales history could not be trusted. Businesses correct their
-- opening numbers with a physical stock count.
--
-- WHY A TRIGGER RATHER THAN AN RPC
-- --------------------------------
-- Sales are inserted from three paths: saleRepository.create() (POS online),
-- saleRepository.syncQueued() (offline replay, which POSTs directly and does
-- not go through create()), and PharmacyForm.jsx's own addSale() for dispensed
-- consultation items. A trigger covers all three at once, stays correct for any
-- path added later, and is atomic against two tills selling the same product.
--
-- SECURITY MODEL
-- --------------
-- SECURITY INVOKER (Postgres' default, stated explicitly) — deliberately NOT
-- SECURITY DEFINER. The UPDATE runs as the cashier, so `products`' existing RLS
-- policy ("products of own business": business_id IN current_business_ids())
-- does the tenant enforcement for free: a sale referencing another business's
-- product id matches zero rows instead of decrementing a stranger's stock. No
-- privilege escalation is introduced, and there is no new publicly-callable
-- SECURITY DEFINER surface — the exact pattern that produced C15 and C17.
-- search_path is pinned on both objects (advisor: function_search_path_mutable).
--
-- THE RULE THAT MADE THIS NEED LIVE DATA
-- --------------------------------------
-- `sales.items` is a jsonb column, but the app writes JSON.stringify(items)
-- into it — so PostgREST stores a scalar JSON *string*, not an array. Measured
-- 2026-08-04: 51 of 54 rows are jsonb_typeof = 'string'; only 3 (the QA seed,
-- which inserts real arrays) are 'array'. A trigger written the obvious way
-- (jsonb_array_elements(new.items)) would have silently decremented nothing for
-- every real sale. Both shapes are handled below.
--
-- Line-item keys were measured too, not assumed: of 83 line items, 79 carry
-- `id` and 4 carry `product_id`, never both — hence the coalesce. `qty` is
-- present on all 83 and always an integer string.
--
-- FAILURE POLICY
-- --------------
-- A sale is money that already changed hands, so this trigger must never fail
-- an INSERT. Every value is guarded and every unparseable or unmatched item is
-- skipped rather than raised. The worst case is the pre-existing behaviour —
-- no decrement — never a lost sale.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Decrement stock when a completed sale is recorded
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_sale_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
BEGIN
  -- A held sale is not takings yet; stock moves when it is actually charged.
  -- Note this is INSERT-only on purpose. Resuming a held sale UPDATEs it
  -- (is_on_hold -> false), and the real charge INSERTs a brand new row, so
  -- firing only on INSERT decrements exactly once per sale rather than twice.
  IF coalesce(NEW.is_on_hold, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.items IS NULL OR NEW.business_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Unwrap the double-encoded case (see header): a jsonb scalar string holding
  -- the real array. `#>> '{}'` extracts the string, which is then parsed.
  BEGIN
    v_items := CASE jsonb_typeof(NEW.items)
                 WHEN 'string' THEN (NEW.items #>> '{}')::jsonb
                 ELSE NEW.items
               END;
  EXCEPTION WHEN others THEN
    -- Unparseable payload: record the sale, skip the stock movement.
    RETURN NEW;
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RETURN NEW;
  END IF;

  UPDATE products p
     SET stock = greatest(0, coalesce(p.stock, 0) - agg.qty)
    FROM (
      SELECT
        (coalesce(elem->>'id', elem->>'product_id'))::uuid AS product_id,
        sum((elem->>'qty')::numeric)::int                  AS qty
      FROM jsonb_array_elements(v_items) elem
      -- Guards, not decoration: a bad cast inside a trigger would abort the
      -- whole sale. Current data is clean (0 missing ids, 0 non-uuid ids,
      -- 0 non-integer quantities across 83 line items) and these keep it that
      -- way for anything written later.
      WHERE coalesce(elem->>'id', elem->>'product_id')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND coalesce(elem->>'qty', '') ~ '^[0-9]+$'
      GROUP BY 1
    ) agg
   WHERE p.id = agg.product_id
     AND p.business_id = NEW.business_id          -- tenant scope, belt and braces alongside RLS
     AND coalesce(p.category, '') <> 'Services'   -- services have no stock (Inventory pins them at 999)
     AND agg.qty > 0;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_sale_stock_movement() IS
  'C5: decrements products.stock for each line item of a completed (not held) sale. '
  'SECURITY INVOKER so products RLS enforces the tenant boundary. Never raises — '
  'a sale is never lost because stock could not be adjusted.';

DROP TRIGGER IF EXISTS sale_stock_movement ON public.sales;
CREATE TRIGGER sale_stock_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_sale_stock_movement();


-- ---------------------------------------------------------------------------
-- 2. Atomic replenishment, so Purchases cannot clobber a concurrent sale
-- ---------------------------------------------------------------------------
-- C12's replenishment (Purchases.jsx) works, but it is a client-side
-- read-modify-write: it reads stock, adds qty in JavaScript, and writes an
-- ABSOLUTE value back. Against a server-side decrement that is a lost update —
-- recording a purchase while a till sells the same product would silently
-- restore the sold units. This RPC makes the increment atomic; Purchases.jsx
-- calls it per line item instead of updateProduct().
--
-- A trigger is not an option here: `purchases` rows store only aggregate data
-- (product_name is a comma-joined string, quantity is a summed total), so the
-- row carries no per-item product id to work from.
--
-- SECURITY INVOKER again — RLS scopes it, so granting EXECUTE to authenticated
-- confers nothing the caller could not already do through PostgREST.
CREATE OR REPLACE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_business_id uuid,
  p_qty integer
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE products
     SET stock = coalesce(stock, 0) + p_qty
   WHERE id = p_product_id
     AND business_id = p_business_id
     AND p_qty > 0
  RETURNING stock;
$$;

COMMENT ON FUNCTION public.increment_product_stock(uuid, uuid, integer) IS
  'C12: atomic stock replenishment for Purchases, replacing a client-side '
  'read-modify-write that could clobber concurrent sale decrements. '
  'SECURITY INVOKER — products RLS enforces the tenant boundary.';

REVOKE ALL ON FUNCTION public.increment_product_stock(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_product_stock(uuid, uuid, integer) TO authenticated;


-- ============================================================================
-- OPEN DECISION, deliberately not made here
-- ----------------------------------------------------------------------------
-- The decrement clamps at zero (`greatest(0, ...)`), matching POS.jsx's
-- existing Math.max(0, ...) so behaviour stays consistent with what the UI has
-- always shown. The tradeoff: clamping hides oversells. Allowing stock to go
-- negative would instead surface "you sold more than you had", which for a
-- pharmacy is a useful data-quality signal. Change the `greatest(0, ...)` to a
-- plain subtraction if that is preferred.
--
-- VERIFICATION PLAN (run after applying)
-- ----------------------------------------------------------------------------
-- 1. Trigger exists and is attached:
--      select tgname, pg_get_triggerdef(oid) from pg_trigger
--      where tgrelid = 'public.sales'::regclass and not tgisinternal;
--
-- 2. Advisors clean — expect NO new findings versus the 2026-08-04 baseline
--    (in particular no function_search_path_mutable for either new function,
--    and no anon/authenticated SECURITY DEFINER finding, since both are
--    INVOKER):
--      get_advisors(type: security)
--
-- 3. End-to-end, against a test business only: record a sale through POS for a
--    known product, then confirm products.stock actually moved and that a
--    refresh no longer restores the old value — the specific symptom of C5.
--
-- 4. Held sales do not move stock: hold a sale, confirm stock is unchanged;
--    resume and charge it, confirm stock moves exactly once.
-- ============================================================================
