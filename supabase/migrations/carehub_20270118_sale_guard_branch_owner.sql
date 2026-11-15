-- ============================================================================
-- POS: an Owner's sale at one of their branch locations is refused with
-- "This sale is not authorized for your account."
--
-- STATUS: NOT YET APPLIED. Apply with owner approval, then record the version
-- and the live probe here.
--
-- PROBLEM (reported 2026-11-15; verified against the live definitions)
-- -------
-- The till shows "1 queued sale(s) were blocked by the server: This sale is
-- not authorized for your account." The message comes from the BEFORE INSERT
-- trigger guard_sale_item_prices (carehub_20260814_guard_sale_item_prices).
-- It decides the caller's role in two steps:
--   a. Owner  = businesses.email of THE SALE'S OWN business equals the caller's
--   b. else   = an active staff row on the sale's business, else REFUSE.
-- The sales RLS policy uses current_business_ids(), which also gives an Owner
-- every branch below their business (within branch_depth_limit). A branch is
-- its own businesses row with its own email (live 2026-11-15: 3 branches, all 3
-- with an email different from their parent). So an Owner ringing up a sale at
-- a branch passes RLS, fails step (a) (the branch email is not theirs), has no
-- staff row there, and is refused. Queued (offline) sales hit it most because
-- they are posted under the location they were rung up at, but online sales at
-- a branch are refused the same way.
--
-- FIX
-- ---
-- Step (a) now asks is_business_owner(NEW.business_id): the helper every other
-- Owner-only function already uses. It is true when the caller owns the sale's
-- business or an ancestor of it AND that business is in current_business_ids()
-- (so the branch depth limit is respected exactly as RLS respects it), or when
-- the caller is an active staff member with role 'Owner' on that business (who
-- step (b) already resolved to 'Owner'). Nothing else in the trigger changes:
-- price checks, the custom roles override and the trusted-role exemption are
-- identical.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- * Widens nothing RLS did not already allow: is_business_owner requires the
--   business to be in current_business_ids(), the same set the sales policy
--   checks. A stranger, a staff member of the parent (staff never see
--   branches), or an Owner beyond the depth limit is still refused.
-- * An Owner at a branch now gets the Owner preset (canEditPrice) unless the
--   branch has a custom 'Owner' roles row, which is what the app already shows
--   them (role = 'Owner' in BusinessDashboard).
-- * Staff resolution, price-override refusal and negative-price refusal are
--   unchanged. The function stays SECURITY INVOKER with a pinned search_path;
--   is_business_owner is SECURITY DEFINER and only SELECTs.
--
-- ROLLBACK
-- --------
-- Re-run the function body from carehub_20260814_guard_sale_item_prices.sql
-- (live definition identical to it, read 2026-11-15).
--
-- TESTS
-- -----
-- apps/carefind/src/test/pos/saleGuardBranchOwner.db.test.js (PGlite, live
-- helpers): reproduces the refusal on the old body, then Owner at main and
-- branch accepted, branch beyond the depth limit refused, parent staff at a
-- branch refused, stranger refused, price override by a Cashier still refused.
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
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- (a) Owner of this business or of a business above it (a branch location),
  -- within the depth limit RLS applies: the same rule as every Owner-only function.
  v_is_owner := coalesce(public.is_business_owner(NEW.business_id), false);

  IF v_is_owner THEN
    v_role := 'Owner';
  ELSE
    -- (b) Active staff of this business, by auth_user_id OR email.
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

  -- (c) canEditPrice: a custom roles row for this role name wins; otherwise
  -- only the 'Owner' preset may edit prices. Fails closed.
  SELECT coalesce(r.permissions->>'canEditPrice' = 'true', false)
    INTO v_can_edit_price
    FROM roles r
   WHERE r.business_id = NEW.business_id
     AND r.name = v_role
   LIMIT 1;

  IF v_can_edit_price IS NULL THEN
    v_can_edit_price := (v_role = 'Owner');
  END IF;

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
      v_product_id := coalesce((v_item->>'id')::uuid, (v_item->>'product_id')::uuid);
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    IF v_product_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT p.price, p.name INTO v_catalog_price, v_product_name
      FROM products p
     WHERE p.id = v_product_id
       AND p.business_id = NEW.business_id
     LIMIT 1;

    IF v_product_name IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      v_line_price := (v_item->>'price')::numeric;
    EXCEPTION WHEN others THEN
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
