-- ============================================================================
-- Feature 3 (CareHub POS Edit Price) — server-side price authorization
--
-- PROBLEM
-- -------
-- POS.jsx lets a cashier override a single line's unit price for one sale,
-- but only when their role has `canEditPrice` (Owner preset, or a custom
-- `roles` row granting it). That gate lived ONLY in the React UI. The `sales`
-- table's RLS policy is business-scoped ("sales of own business":
-- business_id IN current_business_ids()), which controls WHICH ROW a member
-- may insert — it says nothing about WHICH PRICES. Any authenticated member
-- of the business could POST crafted `items` JSON directly to
-- /rest/v1/sales with arbitrary prices, bypassing the gate entirely.
--
-- FIX
-- ----
-- A BEFORE INSERT trigger that authorizes every line price against the
-- product's catalog price, and the caller's permission, before the row lands.
-- Rejected inserts abort the whole statement — and because this trigger is
-- BEFORE INSERT, a blocked sale never reaches the AFTER INSERT stock-movement
-- trigger, so no stock is decremented for a sale that was never allowed.
--
-- SECURITY MODEL
-- --------------
-- SECURITY INVOKER (Postgres' default, stated explicitly), search_path pinned
-- to public, exactly the pattern already used by apply_sale_stock_movement and
-- guard_business_privileged_columns. The trigger only READS products/staff/
-- roles as the caller, so their existing business-scoped RLS does the tenant
-- enforcement for free: a line referencing another business's product id
-- matches zero rows and is skipped, never decremented and never authorized
-- against a stranger's catalog.
--
-- Trusted callers pass through untouched (same exemption list as
-- guard_business_privileged_columns): server endpoints and migrations
-- (service_role/postgres/supabase_admin/supabase_auth_admin) and platform
-- admins. A service_role sales write is trusted by design.
--
-- HOW THE CALLER'S PERMISSION IS RESOLVED (must mirror the app exactly)
-- ---------------------------------------------------------------------
-- The frontend resolves permissions in two steps:
--   1. BusinessDashboard: role = staffUser?.role || 'Owner', where staffUser
--      comes from resolveAccountByEmail — BUSINESS OWNER BY EMAIL TAKES
--      PRECEDENCE over a staff row.
--   2. getPerms(role, customRoles): if a `roles` row exists for this business
--      with name = role, its permissions.jsonb OVERRIDES the preset; otherwise
--      the preset applies. Only the 'Owner' preset has canEditPrice = true;
--      every other preset and DEFAULT_STAFF_PERMS have it false.
--
-- The trigger reproduces both steps:
--   a. Owner business (email match on the sale's business)      -> role 'Owner'
--   b. Else active staff (auth_user_id OR email match, same as the
--      current_business_ids() helper)                           -> staff.role
--   c. canEditPrice = custom roles row's permissions->>'canEditPrice'
--      if a row for that role name exists, else (role = 'Owner').
-- Checking staff by auth_user_id OR email covers both the newer minted
-- accounts and legacy staff rows where auth_user_id was backfilled later —
-- the RLS helper itself keys on email, so the trigger must accept the same
-- identities or it would disagree with RLS on who is allowed to insert.
--
-- WHAT IS AUTHORIZED / REJECTED PER LINE
-- --------------------------------------
-- For each line referencing a REAL product of the SAME business:
--   * price < 0                     -> REJECT (check_violation). The UI cannot
--                                       produce a negative price (setPrice
--                                       falls back to the catalog price for
--                                       n <= 0), so this is always tampering.
--   * price != catalog price AND the
--     caller lacks canEditPrice     -> REJECT (insufficient_privilege, 403),
--                                       message names the product and both
--                                       prices so the cashier can act.
--   * price matches the catalog
--     price                         -> ALLOWED (the common case; every
--                                       non-canEditPrice POS charge).
--   * price != catalog price AND the
--     caller HAS canEditPrice       -> ALLOWED (the legitimate one-off
--                                       override setPrice exists for).
-- Lines that reference a product id NOT in this business's catalog are
-- SKIPPED, not blocked — the same deliberate failure policy as
-- apply_sale_stock_movement. A stale cart line pointing at a product that was
-- deleted or duplicate-merged since the cart was built is a real, legitimate
-- path, and a sale that already happened must never be lost because of it.
-- (Trade-off, accepted and documented in the feature status: a fabricated
-- line with a made-up product id is recorded as garbage that decrements no
-- stock, rather than a real catalog item sold at the wrong price — the
-- actual exploit this guard exists to close.)
--
-- OUT OF SCOPE (documented, not guarded here)
-- -------------------------------------------
--   * `discount` / `subtotal` / `total` are still client-supplied. Discount
--     is a legitimate per-sale input for every cashier, and guarding it is a
--     separate authorization decision; the audited gap for Feature 3 is the
--     line-item price override.
--   * Held sales are validated at INSERT (hold time). Resuming a held sale
--     creates a fresh completed-sale row which is validated again at charge.
--
-- VERIFY AFTER APPLYING
-- ---------------------
--   As a NON-canEditPrice staff member (e.g. Pharmacist/Cashier) of a test
--   business, attempt a POST to /rest/v1/sales with a line whose price
--   differs from products.price for a real product:
--       expect HTTP 403, "Price override not allowed: ...".
--   As that same member, POST the same line at the catalog price:
--       expect 201 and the sale recorded.
--   As the Owner (or a custom role with canEditPrice), POST an override:
--       expect 201 and the override recorded verbatim.
--   Confirm a rejected INSERT decremented no stock.
--   Advisors after: identical to the pre-change baseline (no new
--   function_search_path_mutable / SECURITY DEFINER findings — this trigger
--   is INVOKER with a pinned search_path).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_sale_item_prices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_role text;
  v_is_owner boolean;
  v_can_edit_price boolean;
  v_product_id uuid;
  v_catalog_price numeric;
  v_line_price numeric;
  v_product_name text;
BEGIN
  -- Server endpoints, migrations and platform admins are trusted here. Same
  -- exemption list as guard_business_privileged_columns. is_platform_admin()
  -- only SELECTs, so calling it from a trigger on sales cannot recurse.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- (a) Business owner by email takes precedence, mirroring
  -- resolveAccountByEmail. This is also the only way a caller with no staff
  -- row can pass the sales RLS with_check, so no non-member can reach the
  -- staff lookup below by pretending to be an owner.
  SELECT EXISTS (
    SELECT 1 FROM businesses b
     WHERE b.id = NEW.business_id
       AND lower(b.email) = lower(auth.email())
  ) INTO v_is_owner;

  IF v_is_owner THEN
    v_role := 'Owner';
  ELSE
    -- (b) Active staff of this business, by auth_user_id OR email — the two
    -- identities the RLS helper accepts. If neither matches, the sales RLS
    -- with_check would reject this insert anyway; fail here with a clear
    -- error rather than a silent no-op permission lookup.
    SELECT s.role INTO v_role
      FROM staff s
     WHERE s.business_id = NEW.business_id
       AND s.status = 'active'
       AND (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
     LIMIT 1;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'This sale is not authorized for your account.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- (c) canEditPrice: a custom roles row for this role name wins (the
  -- frontend's customRoles map is keyed by role name the same way); otherwise
  -- only the 'Owner' preset may edit prices. `= 'true'` avoids a cast error
  -- on a malformed jsonb value and fails closed (any non-'true' -> false).
  SELECT coalesce(r.permissions->>'canEditPrice' = 'true', false)
    INTO v_can_edit_price
    FROM roles r
   WHERE r.business_id = NEW.business_id
     AND r.name = v_role
   LIMIT 1;

  IF v_can_edit_price IS NULL THEN
    v_can_edit_price := (v_role = 'Owner');
  END IF;

  -- Unwrap the double-encoded items shape the app writes (a jsonb scalar
  -- string holding the real array) — same guard shape as apply_sale_stock_movement.
  BEGIN
    v_items := CASE jsonb_typeof(NEW.items)
                 WHEN 'string' THEN (NEW.items #>> '{}')::jsonb
                 ELSE NEW.items
               END;
  EXCEPTION WHEN others THEN
    -- Unparseable payload: never fail the money record here; the stock
    -- trigger already ignores it for stock purposes.
    RETURN NEW;
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    BEGIN
      v_product_id := coalesce((v_item->>'id')::uuid, (v_item->>'product_id')::uuid);
    EXCEPTION WHEN others THEN
      -- No usable product reference on this line: nothing to authorize.
      CONTINUE;
    END;

    IF v_product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Catalog lookup is tenant-scoped by products RLS (and pinned explicitly).
    SELECT p.price, p.name INTO v_catalog_price, v_product_name
      FROM products p
     WHERE p.id = v_product_id
       AND p.business_id = NEW.business_id
     LIMIT 1;

    -- Unknown product id for this business (deleted / duplicate-merged since
    -- the cart was built, or a fabricated line): skip rather than fail the
    -- sale — the same policy as the stock-movement trigger. See header.
    IF v_product_name IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      v_line_price := (v_item->>'price')::numeric;
    EXCEPTION WHEN others THEN
      -- Unparseable price on a real product: it cannot equal the catalog
      -- price, so treat it as an override requiring authorization.
      v_line_price := NULL;
    END;

    IF v_line_price < 0 THEN
      RAISE EXCEPTION 'Invalid sale price (%) for "%".', v_line_price, v_product_name
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_line_price IS DISTINCT FROM coalesce(v_catalog_price, 0)
       AND NOT v_can_edit_price THEN
      RAISE EXCEPTION
        'Price override not allowed: "%" is priced at % but was recorded at %. Only staff with "Edit prices" permission can change selling prices.',
        v_product_name, coalesce(v_catalog_price, 0), v_line_price
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_sale_item_prices() IS
  'Feature 3: authorizes every line price of an inserted sale against the '
  'product catalog and the caller''s canEditPrice permission (custom roles '
  'row, else Owner preset). SECURITY INVOKER so tenant scoping is enforced by '
  'the existing products/staff/roles RLS. Rejects negative prices and any '
  'unauthorized override; skips lines referencing unknown products. Trusted '
  'service roles and platform admins pass through.';

DROP TRIGGER IF EXISTS guard_sale_item_prices ON public.sales;
CREATE TRIGGER guard_sale_item_prices
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sale_item_prices();