-- Let logged-out visitors read the public rows of five tables again.
--
-- PROBLEM
-- -------
-- businesses, products, ecommerce_products, business_services and
-- shop_pickup_stations each have a policy that exposes their public rows
-- ("public can view active visible businesses", "public can view listed
-- products", ...). Each also has a private tenant policy granted to `public`
-- (every role) whose USING expression calls is_platform_admin(). Postgres
-- evaluates every applicable permissive policy, and anon has no EXECUTE on
-- is_platform_admin() (revoked deliberately in the security remediation), so
-- ANY anon read of these tables failed with
-- "permission denied for function is_platform_admin" (HTTP 401) instead of
-- returning the public rows. Logged-out visitors saw no businesses, products,
-- services or pickup stations; the feed's engine-config loader, which reads
-- businesses, threw and skipped the Medical tab's facility list.
--
-- FIX
-- ---
-- Scope the private tenant policies to `authenticated`. They can never match
-- an anonymous visitor (they depend on auth.email(), current_business_ids()
-- or is_platform_admin(), all empty/false for anon), so for anon this changes
-- nothing except that the policy is no longer evaluated and the error goes
-- away. Authenticated behaviour is unchanged. No function grant is added and
-- no data becomes visible beyond what the existing public policies already
-- allow; column-level grants for anon still apply.
--
-- The other ~90 tables that raise the same error for anon are private
-- tenant tables where anon is meant to be denied; they are left as they are.

ALTER POLICY "own business row" ON public.businesses TO authenticated;
ALTER POLICY "products of own business" ON public.products TO authenticated;
ALTER POLICY "ecommerce_products tenant write" ON public.ecommerce_products TO authenticated;
ALTER POLICY "business_services of own business" ON public.business_services TO authenticated;
ALTER POLICY "shop_pickup_stations ops write" ON public.shop_pickup_stations TO authenticated;
