-- Product catalogue, phase 2: prescription-only safety on CareFind.
-- Design: docs/architecture/Product-Catalogue-Design.md §3.6 (owner's decisions, 2026-10-27 and 2026-10-28).
--
-- Written against the LIVE schema read on 2026-10-28:
--   * products: the policy "public can view listed products" lets anyone read every listed product, price included.
--     884 prescription-only products are listed and 861 of them show a price.
--   * The shop: ecommerce_products ("public read" policy; one listing of a prescription-only product is orderable)
--     and the shop_public_products view (security_invoker). Orders are created by create_shop_order(), which inserts
--     one shop_order_items row per line inside the order's transaction.
--   * products.rx_status comes from carehub_20261215 (otc, pharmacy_only, prescription_only, controlled).
--
-- OWNER'S DECISION: prescription-only and controlled medicines, and shop listings marked "prescription required",
-- show on CareFind as "Available: ask the pharmacist": no price and no online ordering.
--
-- WHAT THIS DOES
--   1. is_rx_restricted(rx_status): true for prescription_only and controlled.
--   2. The public policy on products no longer returns restricted items to the public. The business's own members
--      (existing policy), the product's owner and an approved claimant still see them in full.
--   3. carefind_products: the one public view of listed products for CareFind. Restricted items are included with no
--      price (price null, show_price false, rx_restricted true). Cost price is never exposed.
--   4. The shop: restricted products and "prescription required" listings are no longer publicly readable (policy
--      and shop_public_products), and a trigger on shop_order_items refuses any order line for them, so
--      create_shop_order() fails as a whole.
--
-- SECURITY: this only narrows what the public can read and order. carefind_products is a view owned by the database
-- owner (not security_invoker) so it can list restricted items without their price; it exposes only listed products
-- and only the columns CareFind displays. The order-line trigger cannot be bypassed by the app, since it runs on the
-- table itself.
--
-- ROLLBACK: re-create the policies "public can view listed products" (list_on_carefind = true) and
-- "ecommerce_products public read" and the view shop_public_products from their previous definitions (recorded in
-- docs/architecture/Product-Catalogue-Design.md §7); drop view carefind_products, trigger
-- shop_order_items_no_prescription and functions shop_order_items_no_prescription(), is_rx_restricted(text).

-- ── 1. The rule ──────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_rx_restricted(p_rx_status text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_rx_status, '') in ('prescription_only', 'controlled')
$$;
grant execute on function public.is_rx_restricted(text) to anon, authenticated, service_role;

-- ── 2. The products table: no restricted items for the public ────────────────────────────────────────────────────────
drop policy if exists "public can view listed products" on public.products;
create policy "public can view listed products" on public.products for select
  using (
    list_on_carefind = true
    and (
      not public.is_rx_restricted(rx_status)
      or owner_id = (select auth.uid())
      or business_id in (select bc.business_id from public.business_claims bc
                          where bc.user_id = (select auth.uid()) and bc.status = 'approved')
    )
  );

-- ── 3. What CareFind shows ───────────────────────────────────────────────────────────────────────────────────────────
create or replace view public.carefind_products as
select p.id, p.business_id, p.owner_id, p.name, p.generic_name, p.category, p.emoji, p.image_url, p.description,
       p.whatsapp, p.sale_type, p.price_unit, p.min_purchase, p.seller_location, p.latitude, p.longitude, p.stock,
       p.list_on_carefind, p.created_at, p.rx_status,
       public.is_rx_restricted(p.rx_status) as rx_restricted,
       case when public.is_rx_restricted(p.rx_status) then null else p.price end as price,
       case when public.is_rx_restricted(p.rx_status) then false else p.show_price end as show_price
  from public.products p
 where p.list_on_carefind = true;

revoke all on public.carefind_products from public, anon, authenticated;
grant select on public.carefind_products to anon, authenticated, service_role;

-- ── 4. The shop ──────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "ecommerce_products public read" on public.ecommerce_products;
create policy "ecommerce_products public read" on public.ecommerce_products for select
  using (
    status = 'Active' and is_restricted = false and is_ecommerce_vendor_approved(business_id)
    and coalesce(prescription_required, false) = false
    and exists (select 1 from public.products p
                 where p.id = ecommerce_products.product_id
                   and (p.stock is null or p.stock > 0)
                   and not public.is_rx_restricted(p.rx_status))
  );

create or replace view public.shop_public_products with (security_invoker = true) as
select ep.id, ep.business_id, ep.product_id, ep.description, ep.category, ep.ecommerce_price_kobo, ep.attributes,
       ep.active_at, ep.prescription_required, ep.warnings, ep.restrictions,
       p.name as product_name, p.generic_name, p.price as inventory_price, p.stock, p.category as inventory_category,
       p.sale_type, p.price_unit, p.image_url as fallback_image_url
  from public.ecommerce_products ep
  join public.products p on p.id = ep.product_id
 where ep.status = 'Active' and ep.is_restricted = false and is_ecommerce_vendor_approved(ep.business_id)
   and (p.stock is null or p.stock > 0)
   and coalesce(ep.prescription_required, false) = false
   and not public.is_rx_restricted(p.rx_status);

-- Every order line, whoever creates it: a prescription medicine is never sold online.
create or replace function public.shop_order_items_no_prescription()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text; v_restricted boolean;
begin
  select coalesce(p.name, new.product_name),
         public.is_rx_restricted(p.rx_status) or coalesce(ep.prescription_required, false)
    into v_name, v_restricted
    from public.products p
    left join public.ecommerce_products ep on ep.id = new.ecommerce_product_id
   where p.id = new.product_id;
  if coalesce(v_restricted, false) then
    raise exception '% is a prescription medicine and is not sold online. Please ask the pharmacist.', coalesce(v_name, 'This item')
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists shop_order_items_no_prescription on public.shop_order_items;
create trigger shop_order_items_no_prescription before insert on public.shop_order_items
  for each row execute function public.shop_order_items_no_prescription();

revoke all on function public.shop_order_items_no_prescription() from public, anon, authenticated;
