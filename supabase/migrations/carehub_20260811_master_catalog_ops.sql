-- ============================================================================
-- Master catalog operations: activate / deactivate / push (ADR-004)
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql, AFTER
-- 20260810_master_catalog.sql. Code that calls these RPCs ships with this
-- migration (modules/master-catalog), so the UI must not go live before it.
--
-- WHAT THIS ADDS
-- --------------
-- 1. RLS write policies for the two catalog tables. The draft only gave them
--    SELECT policies, so the owner's own client calls (cloneBranchData, the
--    master-catalog repository) would have been denied with 42501. Same shape
--    as every tenant table: `X IN (SELECT current_business_ids())` so the
--    owner at the parent sees and writes every branch in the tree.
-- 2. Three RPCs, all SECURITY INVOKER with a pinned search_path (never
--    SECURITY DEFINER — the C15/C17 pattern):
--      activate_branch_product(branch_id, master_product_id, override_price)
--        upserts the activation link AND materialises the branch's own
--        sellable `products` row (stock 0, price = override or master
--        default). Existing stock and costing on that product are preserved.
--      deactivate_branch_product(branch_id, master_product_id)
--        flips the link to inactive. The branch's products row is untouched —
--        remaining stock stays sellable and owned by the branch; it just
--        stops receiving master pushes.
--      push_master_product(master_product_id, business_id)
--        copies name/category to every branch with an ACTIVE link, and the
--        price only where the branch has no override (ADR-004: "the default
--        price is a suggestion, not a rule").
--
-- MATERIALISATION MODEL (why activation writes products)
-- ------------------------------------------------------
-- The branch's own `products` table is what Inventory, POS and CareFind read.
-- A branch_products link with no matching products row is an orphan — the
-- branch "carries" a product nobody can sell. So activation materialises the
-- row, and `name` is the join key between the two layers (there is no FK; a
-- branch product with the same name as a master product IS the master
-- product, by design — updating one updates the other's master-owned fields).
--
-- BLAST RADIUS (2026-08-10, live)
-- -------------------------------
--   master_products   0 rows  (never written — no UI has ever existed)
--   branch_products   0 rows  (cloneBranchData's inserts have failed under
--                             RLS since the commit that added them — the
--                             `.catch(() => {})` in Locations.jsx swallowed
--                             it; see the INSERT policy gap above)
-- So this migration cannot alter existing data: nothing exists to alter.
-- It also fixes the silent clone gap: cloneBranchData is changed to call
-- activate_branch_product so a new branch's activations materialise its
-- sellable products (previously raw inserts created orphan links).
--
-- THE ACL, AND THE TRAP (learned twice — C5 and the atomic stock transfer)
-- ------------------------------------------------------------------------
-- Supabase's default privileges re-grant EXECUTE to anon at creation time,
-- AFTER the REVOKE runs. Both statements below are therefore required, and
-- the verification must re-read pg_proc.proacl rather than trust the REVOKE:
--
--   select proname, proacl from pg_proc
--   where proname in ('activate_branch_product','deactivate_branch_product',
--                     'push_master_product');
--   Expect postgres | authenticated | service_role. NO anon.
--   Also confirm no sibling overloads (the C15/C17 trap):
--   select oid::regprocedure from pg_proc where proname in (...);
--   Expect exactly one row per name, prosecdef = false, proconfig set.
--
-- Note: even with anon EXECUTE these are SECURITY INVOKER, so an anon caller
-- has no current_business_ids() membership and every lookup matches zero rows
-- — the same no-op argument that kept the stock RPCs safe pre-revoke.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Write policies (the draft file only created SELECT policies)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_products' AND policyname = 'master_products owner insert') THEN
    CREATE POLICY "master_products owner insert" ON master_products
    FOR INSERT WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_products' AND policyname = 'master_products owner update') THEN
    CREATE POLICY "master_products owner update" ON master_products
    FOR UPDATE USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_products' AND policyname = 'master_products owner delete') THEN
    CREATE POLICY "master_products owner delete" ON master_products
    FOR DELETE USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branch_products' AND policyname = 'branch_products owner insert') THEN
    CREATE POLICY "branch_products owner insert" ON branch_products
    FOR INSERT WITH CHECK (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branch_products' AND policyname = 'branch_products owner update') THEN
    CREATE POLICY "branch_products owner update" ON branch_products
    FOR UPDATE USING (branch_id IN (SELECT current_business_ids()) OR is_platform_admin())
    WITH CHECK (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branch_products' AND policyname = 'branch_products owner delete') THEN
    CREATE POLICY "branch_products owner delete" ON branch_products
    FOR DELETE USING (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. activate_branch_product — upsert the link, materialise the sellable row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_branch_product(
  p_branch_id        uuid,
  p_master_product_id uuid,
  p_override_price   integer DEFAULT NULL
)
RETURNS uuid  -- the branch's products row id
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_master    public.master_products%ROWTYPE;
  v_price     integer;
  v_product_id uuid;
BEGIN
  IF p_branch_id IS NULL OR p_master_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The master product must exist in the caller's tree. SECURITY INVOKER
  -- means RLS already scopes this read; the current_business_ids() predicate
  -- is that same rule stated explicitly, so a cross-tenant id matches nothing.
  SELECT * INTO v_master
    FROM public.master_products
   WHERE id = p_master_product_id
     AND business_id IN (SELECT public.current_business_ids());
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 0 is not a saleable price: an override of 0 would silently discount the
  -- product to free. A NULL override inherits the master default price.
  IF p_override_price IS NOT NULL AND p_override_price <= 0 THEN
    RAISE EXCEPTION 'Override price must be greater than zero.' USING ERRCODE = 'check_violation';
  END IF;

  v_price := COALESCE(p_override_price, v_master.default_price);

  -- The activation link itself.
  INSERT INTO public.branch_products (branch_id, master_product_id, active, override_price)
  VALUES (p_branch_id, p_master_product_id, true, p_override_price)
  ON CONFLICT (branch_id, master_product_id)
  DO UPDATE SET active = true, override_price = EXCLUDED.override_price;

  -- Materialise the branch's own sellable product row (no UNIQUE
  -- (business_id, name) on products, so ON CONFLICT never fires — the
  -- INSERT only adds the row when the branch does not have one with this
  -- name; the UPDATE below then refreshes master-owned fields while
  -- preserving stock, costing and everything the branch manages itself).
  INSERT INTO public.products
    (business_id, name, generic_name, category, price, cost_price, stock,
     reorder_level, sale_type, list_on_carefind, emoji)
  VALUES
    (p_branch_id, v_master.name, '', v_master.category, v_price, 0, 0,
     5, 'retail', true, '💊')
  ON CONFLICT DO NOTHING;

  UPDATE public.products
     SET category = v_master.category,
         price    = v_price
   WHERE business_id = p_branch_id
     AND name = v_master.name
  RETURNING id INTO v_product_id;

  RETURN v_product_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. deactivate_branch_product — stop pushes, keep the branch's own stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_branch_product(
  p_branch_id        uuid,
  p_master_product_id uuid
)
RETURNS boolean  -- true when a link row was actually flipped
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.branch_products
     SET active = false
   WHERE branch_id = p_branch_id
     AND master_product_id = p_master_product_id;
  RETURN FOUND;
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. push_master_product — copy master-owned fields to every active branch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_master_product(
  p_master_product_id uuid,
  p_business_id       uuid
)
RETURNS integer  -- number of branch products rows updated
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_master   public.master_products%ROWTYPE;
  v_updated  integer;
BEGIN
  SELECT * INTO v_master
    FROM public.master_products
   WHERE id = p_master_product_id
     AND business_id = p_business_id
     AND business_id IN (SELECT public.current_business_ids());
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.products p
     SET name     = v_master.name,
         category = v_master.category,
         price    = COALESCE(bp.override_price, v_master.default_price)
    FROM public.branch_products bp
   WHERE bp.master_product_id = p_master_product_id
     AND bp.active = true
     AND bp.branch_id = p.business_id
     AND p.name = v_master.name
     AND p.business_id IN (SELECT public.current_business_ids());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. The ACL. BOTH statements are required (see header) — and then RE-READ
--    pg_proc.proacl, because the second revoke is what actually sticks.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.activate_branch_product(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deactivate_branch_product(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_master_product(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_branch_product(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deactivate_branch_product(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_master_product(uuid, uuid) FROM PUBLIC;
