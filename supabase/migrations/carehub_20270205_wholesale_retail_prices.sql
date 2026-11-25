-- ─────────────────────────────────────────────────────────────────────────────
-- Wholesale and retail prices on one product (feedback from a pharmacy onboarded in Lagos, 2026-11-25).
-- Docs: docs/architecture/Wholesale-and-Retail-Prices.md
-- Status: APPLIED 2026-11-25 with owner approval (version 20261125154202), before the app deploy. The live guard was
-- first checked identical to carehub_20270118's body (md5 of the whitespace-stripped source). Probed live in rolled-back
-- transactions as an active staff member whose role has "Edit prices" off, on a product given a temporary wholesale
-- price (retail 10000, wholesale 9950): retail ACCEPTED, wholesale ACCEPTED, 9923 REFUSED (42501, message names both
-- prices); authenticated can read wholesale_price. Afterwards: 0 probe sales, 0 products with a wholesale price.
-- (The app names the column in every products read, so it must never be deployed without this.)
-- Tested on PGlite: apps/carefind/src/test/pos/wholesalePrices.db.test.js
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PROBLEM
-- A product has one selling price (products.price). Pharmacies that sell to other pharmacies and to the public need
-- a wholesale price and a retail price for the same product, both optional, and the POS must sell at either. The POS
-- price guard (guard_sale_item_prices) refuses any line whose price differs from products.price unless the role may
-- edit prices, so a Cashier could not sell at the wholesale price.
--
-- FIX
-- 1. products.wholesale_price numeric NULL (null = not entered), never negative. products.price stays the retail
--    price, with its meaning and default unchanged (0 = not entered, as for 1,235 live products today), so CareFind,
--    the master catalogue push, reports and every existing reader keep working unchanged.
-- 2. guard_sale_item_prices accepts a line priced at the product's retail price OR its wholesale price (when one is
--    set). Any other price still needs "Edit prices". Everything else in the guard is unchanged (verbatim from
--    carehub_20270118_sale_guard_branch_owner).
-- 3. SELECT on the new column for authenticated, so it stays readable once carehub_20270203 (column-by-column
--    SELECT on products) is applied. INSERT / UPDATE on products are table-level grants and already cover it.
--
-- SECURITY IMPLICATIONS
-- * The price guard is widened by exactly one value per product: the wholesale price an Owner or a role with
--   "Edit prices" set on that product. Staff without "Edit prices" still cannot choose an arbitrary price, and setting
--   the wholesale price is itself a price edit (the app shows the field read-only without "Edit prices", as for the
--   retail price). Negative wholesale prices are refused by a CHECK constraint.
-- * Read access follows the row: whoever can read a product row can read its wholesale price, exactly like the
--   retail price. Today (carehub_20270203 not applied) that includes the policy "public can view listed products",
--   i.e. any signed-in user can read the wholesale price of a product listed on CareFind; carehub_20270203 as written
--   grants every column but cost_price to anon and authenticated, so that remains true after it. If wholesale prices
--   must be private to the business, revoke SELECT (wholesale_price) from anon/authenticated after 20270203 and read
--   it through a checked function (as product_costs does for cost_price). Owner decision; recorded in CODE_AUDIT A50.
-- * No policy changes. No SECURITY DEFINER function added. The guard stays SECURITY INVOKER.
--
-- ROLLBACK
--   Re-run the function body from carehub_20270118_sale_guard_branch_owner.sql, then
--   ALTER TABLE public.products DROP COLUMN wholesale_price;
--   (only after the app that reads the column has been rolled back.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_price numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_wholesale_price_not_negative') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_wholesale_price_not_negative CHECK (wholesale_price IS NULL OR wholesale_price >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.products.wholesale_price IS
  'Optional wholesale selling price; null when not entered. products.price is the retail price (0 = not entered). The POS may sell at either (guard_sale_item_prices, carehub_20270205).';

GRANT SELECT (wholesale_price) ON public.products TO authenticated;

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
  v_wholesale_price numeric;
  v_line_price numeric;
  v_product_name text;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- (a) Owner of this business or of a business above it (a branch location),
  -- limited to the businesses RLS gives them. Both helpers are executable by
  -- authenticated (this trigger runs as the caller); is_business_owner is not.
  v_is_owner := NEW.business_id IN (SELECT public.current_business_ids())
                AND coalesce(public.caller_owns_business(NEW.business_id), false);

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

    v_product_name := NULL;
    SELECT p.price, p.wholesale_price, p.name INTO v_catalog_price, v_wholesale_price, v_product_name
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

    -- The retail price, or the wholesale price when the product has one, needs no permission.
    IF v_line_price IS DISTINCT FROM coalesce(v_catalog_price, 0)
       AND (v_wholesale_price IS NULL OR v_line_price IS DISTINCT FROM v_wholesale_price)
       AND NOT v_can_edit_price THEN
      IF v_wholesale_price IS NULL THEN
        RAISE EXCEPTION
          'Price override not allowed: "%" is priced at % but was recorded at %. Only staff with "Edit prices" permission can change selling prices.',
          v_product_name, coalesce(v_catalog_price, 0), v_line_price
          USING ERRCODE = 'insufficient_privilege';
      ELSE
        RAISE EXCEPTION
          'Price override not allowed: "%" is priced at % (retail) or % (wholesale) but was recorded at %. Only staff with "Edit prices" permission can change selling prices.',
          v_product_name, coalesce(v_catalog_price, 0), v_wholesale_price, v_line_price
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
