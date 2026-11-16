-- Product catalogue, phase 4 follow-up: let logged-out visitors read the approved library.
--
-- PROBLEM
-- -------
-- carehub_20261223 gave catalog_items one read policy for anon and authenticated:
--   status = 'active' or is_platform_admin()
-- anon has no EXECUTE on is_platform_admin() (revoked deliberately in the security remediation; see
-- carefind_20261003_public_read_policies_anon_safe), so every anon read of catalog_items, including
-- catalog_search(), failed with "permission denied for function is_platform_admin" instead of returning the
-- approved items. Found when verifying carehub_20261223 on the live database (2026-11-16).
--
-- FIX
-- ---
-- Same approach as carefind_20261003: one policy per role. anon sees approved items only, with no admin check (an
-- anonymous visitor is never an admin). authenticated keeps approved items plus everything for platform admins. No
-- function grant is added and nothing becomes visible that was not meant to be.
--
-- Safe to run more than once.
--
-- ROLLBACK: drop both policies below and re-create "catalog_items read approved" from carehub_20261223 §5.

drop policy if exists "catalog_items read approved" on public.catalog_items;

drop policy if exists "catalog_items public read approved" on public.catalog_items;
create policy "catalog_items public read approved" on public.catalog_items for select to anon
  using (status = 'active');

drop policy if exists "catalog_items signed-in read" on public.catalog_items;
create policy "catalog_items signed-in read" on public.catalog_items for select to authenticated
  using (status = 'active' or public.is_platform_admin());
