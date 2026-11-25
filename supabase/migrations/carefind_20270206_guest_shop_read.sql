-- ─────────────────────────────────────────────────────────────────────────────
-- MED Market (the CareFind shop) for visitors who are not signed in.
-- Feedback 2026-11-25: "Users are required to sign up before accessing MED Market, browsing products or searching."
-- Docs: docs/architecture/CareFind-Guest-Access-Nearby-Search-and-Link-Sharing.md (CODE_AUDIT A51)
-- Status: NOT APPLIED. Apply with owner approval. Order-independent with the app change (see DEPLOYMENT).
-- Tested on PGlite: apps/carefind/src/test/shop/guestShopRead.db.test.js
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PROBLEM (verified live 2026-11-25, as the anon role in a rolled-back transaction)
--   select count(*) from ecommerce_products  →  42501 permission denied for function is_platform_admin
-- The chain: the policy "ecommerce_products public read" (role public) checks stock and prescription status with
--   EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND ...)
-- That subquery runs under products' own row security for the caller. "public can view listed products" there reads
-- business_claims, whose SELECT policy (role public) calls is_platform_admin(). anon has no EXECUTE on
-- is_platform_admin (only authenticated / service_role), so the whole read fails and the shop shows
-- "Sign in to browse the shop". Every other public CareFind read (posts, news, businesses, the carefind_products view
-- used by medicine search) already works for anon.
--
-- WHY NOT THE OBVIOUS FIX
-- Granting EXECUTE on is_platform_admin to anon (or scoping the business_claims policy to authenticated) would make
-- products itself readable by anon, and products.cost_price is still readable by the API roles until
-- carehub_20270203_cost_price_column_guard is applied (CODE_AUDIT A25 / A47). That would publish every listed
-- product's cost price to the internet. This migration does not touch products, business_claims or that function.
--
-- FIX
-- 1. public.ecommerce_product_sellable(product_id): true when the product exists, is in stock (stock null or > 0) and
--    is not prescription-restricted — exactly the condition the policy's EXISTS checked. SECURITY DEFINER, so it reads
--    products without the caller's row security; it returns one boolean and nothing else.
-- 2. "ecommerce_products public read" is recreated with that function in place of the EXISTS. Every other condition
--    is unchanged (Active, not restricted, approved vendor, no prescription required).
-- 3. The public view carefind_products gains reorder_level (appended, the seller's own low-stock threshold, used for
--    the "Low stock" badge on shop cards). Every other column and the WHERE clause are the live definition, verbatim.
-- The app then reads the product details for a shop item from the public carefind_products view (no cost column),
-- not by embedding products (apps/carefind/src/modules/shop/shopRepository.js).
--
-- SECURITY IMPLICATIONS
-- * Who can see which shop items does not change: the same four conditions, now evaluated for anon without error.
--   Signed-in users see exactly what they saw before.
-- * The function discloses, for a product id, whether it is in stock and not prescription-restricted. The
--   carefind_products view already gives anon the stock and rx status of every listed product, so nothing new is
--   readable. Pinned search_path; EXECUTE for anon and authenticated only.
-- * products, its policies, business_claims and is_platform_admin are untouched; cost_price stays unreadable by anon.
-- * carefind_products gains one non-sensitive column (reorder_level); it still never carries cost_price, and its rows
--   (listed, priced or prescription-restricted) are unchanged. Owner and grants are kept by CREATE OR REPLACE VIEW.
--
-- DEPLOYMENT
-- Either order works. Before this migration the new app still loads the shop for signed-in users (their read never
-- failed; without the view's reorder_level it retries without it and shows no "Low stock" badge); after it, guests get
-- the shop too. The old app with this migration behaves as before for everyone except
-- guests, who then get the shop items but no product details (the old app embeds products) — so deploy the app too.
--
-- ROLLBACK
--   Recreate the policy with the previous USING clause (below, PREVIOUS), then
--   DROP FUNCTION public.ecommerce_product_sellable(uuid);
--   The view's extra column can stay (harmless); to remove it, recreate the view from its definition below without
--   reorder_level (DROP VIEW + CREATE VIEW, then re-grant SELECT to anon, authenticated).
--   PREVIOUS: (status = 'Active') AND (is_restricted = false) AND is_ecommerce_vendor_approved(business_id)
--     AND (COALESCE(prescription_required, false) = false) AND (EXISTS (SELECT 1 FROM products p
--     WHERE p.id = ecommerce_products.product_id AND (p.stock IS NULL OR p.stock > 0) AND NOT is_rx_restricted(p.rx_status)))
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ecommerce_product_sellable(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.id = p_product_id
       AND (p.stock IS NULL OR p.stock > 0)
       AND NOT public.is_rx_restricted(p.rx_status)
  )
$$;

COMMENT ON FUNCTION public.ecommerce_product_sellable(uuid) IS
  'True when a shop item''s product is in stock and not prescription-restricted. Used by the policy "ecommerce_products public read" so that it does not depend on products'' row security (which fails for anon). carefind_20270206.';

REVOKE ALL ON FUNCTION public.ecommerce_product_sellable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ecommerce_product_sellable(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "ecommerce_products public read" ON public.ecommerce_products;
CREATE POLICY "ecommerce_products public read" ON public.ecommerce_products
  FOR SELECT TO public
  USING (
    status = 'Active'
    AND is_restricted = false
    AND public.is_ecommerce_vendor_approved(business_id)
    AND COALESCE(prescription_required, false) = false
    AND public.ecommerce_product_sellable(product_id)
  );

-- Live definition of carefind_products (read 2026-11-25), verbatim, with reorder_level appended.
CREATE OR REPLACE VIEW public.carefind_products AS
 SELECT id,
    business_id,
    owner_id,
    name,
    generic_name,
    category,
    emoji,
    image_url,
    description,
    whatsapp,
    sale_type,
    price_unit,
    min_purchase,
    seller_location,
    latitude,
    longitude,
    stock,
    list_on_carefind,
    created_at,
    rx_status,
    is_rx_restricted(rx_status) AS rx_restricted,
        CASE
            WHEN is_rx_restricted(rx_status) THEN NULL::numeric
            ELSE price
        END AS price,
        CASE
            WHEN is_rx_restricted(rx_status) THEN false
            ELSE show_price
        END AS show_price,
    updated_at,
    reorder_level
   FROM products p
  WHERE list_on_carefind = true AND NOT is_carefind_unpriced(rx_status, price);
