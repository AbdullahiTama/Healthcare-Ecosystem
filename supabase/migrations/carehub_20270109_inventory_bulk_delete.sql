-- carehub_20270109_inventory_bulk_delete
--
-- Status: APPLIED TO PRODUCTION 2026-11-10 with the owner's approval (Supabase migration version 20261110075244),
-- applied verbatim from this file (statements only); restore was then tightened by
-- carehub_20270110_restore_respects_plan_limit (version 20261110083834). Tested first on PGlite
-- (apps/carefind/src/test/inventory/inventoryBulkDelete.db.test.js) with the live current_business_ids(),
-- is_business_owner(), is_platform_admin(), the live products foreign keys and the live stock_movements / audit_log
-- columns, read 2026-11-10. After applying: 9,930 products, unchanged; deleted_products RLS on, authenticated SELECT
-- only; both functions EXECUTE: authenticated only.
-- Live probe (DO blocks that raised at the end; afterwards 9,930 products, 0 copies, 0 audit rows, 0 write-offs),
-- on the carehub.test pharmacy (8 products, 2 linked; its plan has expired):
--   cashier (no delete permission) deletes:          refused DELETE_NOT_ALLOWED
--   owner of another business deletes:               refused DELETE_NOT_ALLOWED
--   owner deletes 2 plain + 1 linked product:         2 deleted; kept "Amoxicillin 500mg (Pack of 10)" (shop_listing);
--                                                    1 write-off movement (the other had no stock); 2 copies; 1 audit row
--   owner restores that deletion (plan expired):      2 restored, products back to 8
--   delete all with a wrong phrase:                  refused DELETE_ALL_CONFIRM
--   delete all with DELETE ALL PRODUCTS:             6 deleted, 2 kept, 2 remaining
--   other businesses' products before / after:       9,916 / 9,916 (the 6 others of 9,930 have no business_id at all;
--                                                    pre-existing, untouched; see CODE_AUDIT A18)
--   anon:                                            refused, permission denied for function delete_products
--
-- PROBLEM
-- -------
-- Inventory had no way to delete many products, or to clear the catalogue to upload it again, other than deleting one
-- product at a time. A plain DELETE on products is also unsafe in bulk (live foreign keys, 2026-11-10):
--   * it CASCADES away the product's customer reviews (product_reviews), its online-shop listing (ecommerce_products)
--     and its lines in past stock counts (stock_validation_items), silently;
--   * it is REFUSED for a product in a shop order (shop_order_items, RESTRICT), an internal order (order_items) or with
--     stock batches (stock_batches), so one such product fails the whole request;
--   * the stock on hand disappears from the stock ledger without a movement, and nothing records who deleted what.
--
-- FIX
-- ---
--   1. public.deleted_products: a copy of every product deleted in bulk (the full row as JSON), grouped by deletion,
--      with who deleted it and when, so a deletion can be undone. Read by members of the business; written only here.
--   2. delete_products(business, product_ids, all, confirm): deletes the named products (or, with all = true, every
--      product of the business) in one transaction:
--        * keeps, and reports with the reason, every product with records that must not be lost or broken: shop orders,
--          internal orders, stock batches, customer reviews, an online-shop listing, past stock counts;
--        * writes the stock on hand of each deleted stocked product off in the ledger (stock_movements 'write_off',
--          source 'product_deleted'), so stock history still adds up;
--        * copies each deleted row into deleted_products, deletes it, and records one audit_log entry.
--      Who: the Owner, or a staff member whose role may delete products (the same rule as merge_duplicate_products).
--      Deleting ALL products is the Owner's alone and needs p_confirm = 'DELETE ALL PRODUCTS'.
--   3. restore_deleted_products(business, deletion): puts a deletion's products back with their original ids, prices
--      and stock (the opening-stock trigger records the stock in the ledger again). A product whose id is back already,
--      or whose name is now taken by another product (for example after a re-upload), is skipped and counted, so a
--      restore never creates duplicates. Same people as deleting selected products. Audit-logged.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. Today any member of the business may DELETE products through the API (RLS "products of own
--     business"); the app limits it to roles with delete permission. These functions are stricter: owner or
--     delete-permission role, and all-products for the Owner only with a typed confirmation.
--   * Both functions are SECURITY DEFINER with search_path public, pg_temp, check the caller first, and touch only the
--     named business. EXECUTE: authenticated only (anon revoked explicitly).
--   * deleted_products: RLS on; authenticated may SELECT their own business's rows (product data they could already
--     read); no client INSERT/UPDATE/DELETE; anon nothing.
--   * Customer-facing and financial records are never deleted: products tied to them are kept.
--
-- ROLLBACK
--   drop function public.restore_deleted_products(uuid, uuid);
--   drop function public.delete_products(uuid, uuid[], boolean, text);
--   drop table public.deleted_products;   -- only after restoring anything still needed from it

-- ── 1. Copies of deleted products ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.deleted_products (
  id              uuid primary key default gen_random_uuid(),
  deletion_id     uuid not null,
  business_id     uuid not null,
  product_id      uuid not null,
  product_name    text,
  product         jsonb not null,
  deleted_by      uuid,
  deleted_by_name text,
  deleted_all     boolean not null default false,
  deleted_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid
);
create index if not exists deleted_products_deletion_idx on public.deleted_products (business_id, deletion_id);
create index if not exists deleted_products_recent_idx on public.deleted_products (business_id, deleted_at desc);

alter table public.deleted_products enable row level security;
drop policy if exists "deleted products of own business" on public.deleted_products;
create policy "deleted products of own business" on public.deleted_products for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.deleted_products from public, anon, authenticated;
grant select on public.deleted_products to authenticated;
grant all on public.deleted_products to service_role;

-- ── 2. Delete products (selected, or all) ─────────────────────────────────────────────────────────────────────
create or replace function public.delete_products(
  p_business_id uuid,
  p_product_ids uuid[] default null,
  p_all boolean default false,
  p_confirm text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner      boolean;
  v_target     uuid[];
  v_requested  int := 0;
  v_deletion   uuid := gen_random_uuid();
  v_actor_name text;
  v_kept       jsonb;
  v_deletable  uuid[];
  v_deleted    int := 0;
begin
  if auth.uid() is null then
    raise exception 'DELETE_NOT_ALLOWED: sign in to delete products' using errcode = '42501';
  end if;
  v_owner := public.is_business_owner(p_business_id);
  if not (v_owner or exists (
      select 1 from public.staff s
        join public.roles r on r.business_id = s.business_id and r.name = s.role
       where s.business_id = p_business_id and s.status = 'active'
         and lower(s.email) = lower(auth.email())
         and coalesce((r.permissions ->> 'canDelete')::boolean, false))) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete products, can delete products'
      using errcode = '42501';
  end if;

  if coalesce(p_all, false) then
    if not v_owner then
      raise exception 'DELETE_ALL_OWNER_ONLY: only the owner can delete every product' using errcode = '42501';
    end if;
    if coalesce(p_confirm, '') <> 'DELETE ALL PRODUCTS' then
      raise exception 'DELETE_ALL_CONFIRM: type DELETE ALL PRODUCTS to confirm' using errcode = '22023';
    end if;
    select coalesce(array_agg(id order by id), '{}') into v_target
      from (select id from public.products where business_id = p_business_id order by id for update) l;
    v_requested := cardinality(v_target);
  else
    select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_product_ids, '{}'::uuid[])) d where d is not null;
    v_requested := cardinality(v_target);
    if v_requested = 0 then
      raise exception 'DELETE_NONE: choose at least one product' using errcode = '22023';
    end if;
    if v_requested > 5000 then
      raise exception 'DELETE_TOO_MANY: delete at most 5,000 products at a time' using errcode = '22023';
    end if;
    select coalesce(array_agg(id order by id), '{}') into v_target
      from (select id from public.products where business_id = p_business_id and id = any (v_target) order by id for update) l;
  end if;

  -- Products with records that must not be lost (cascade) or broken (refused): kept, with every reason.
  with reasons as (
    select p.id, p.name, array_remove(array[
             case when exists (select 1 from public.shop_order_items x where x.product_id = p.id) then 'shop_orders' end,
             case when exists (select 1 from public.order_items x where x.product_id = p.id) then 'orders' end,
             case when exists (select 1 from public.stock_batches x where x.product_id = p.id) then 'batches' end,
             case when exists (select 1 from public.product_reviews x where x.product_id = p.id) then 'reviews' end,
             case when exists (select 1 from public.ecommerce_products x where x.product_id = p.id) then 'shop_listing' end,
             case when exists (select 1 from public.stock_validation_items x where x.product_id = p.id) then 'stock_counts' end
           ], null) as why
      from public.products p where p.id = any (v_target)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'reasons', to_jsonb(why)) order by name) filter (where cardinality(why) > 0), '[]'),
         coalesce(array_agg(id) filter (where cardinality(why) = 0), '{}')
    into v_kept, v_deletable
    from reasons;

  if cardinality(v_deletable) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    -- The stock on hand leaves the ledger as a write-off, so stock history still adds up.
    insert into public.stock_movements (business_id, product_id, movement_type, quantity, qty_before, qty_after,
                                        source_type, source_id, reason, actor_id, moved_by)
    select p.business_id, p.id, 'write_off', -p.stock, p.stock, 0, 'product_deleted', v_deletion::text,
           'Product deleted' || case when coalesce(p_all, false) then ' (all products cleared)' else '' end,
           auth.uid(), auth.email()
      from public.products p
     where p.id = any (v_deletable) and coalesce(p.stock, 0) <> 0 and coalesce(p.category, '') <> 'Services';

    insert into public.deleted_products (deletion_id, business_id, product_id, product_name, product, deleted_by, deleted_by_name, deleted_all)
    select v_deletion, p.business_id, p.id, p.name, to_jsonb(p), auth.uid(), v_actor_name, coalesce(p_all, false)
      from public.products p where p.id = any (v_deletable);

    delete from public.products where id = any (v_deletable);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when v_owner then 'owner' else 'staff' end, p_business_id, 'inventory.products_deleted',
            'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'all', coalesce(p_all, false),
                               'requested', v_requested));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

revoke all on function public.delete_products(uuid, uuid[], boolean, text) from public, anon;
grant execute on function public.delete_products(uuid, uuid[], boolean, text) to authenticated;

-- ── 3. Restore a deletion ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.restore_deleted_products(p_business_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner    boolean;
  r          record;
  v_restored int := 0;
  v_skipped_back int := 0;
  v_skipped_name int := 0;
begin
  if auth.uid() is null then
    raise exception 'DELETE_NOT_ALLOWED: sign in to restore products' using errcode = '42501';
  end if;
  v_owner := public.is_business_owner(p_business_id);
  if not (v_owner or exists (
      select 1 from public.staff s
        join public.roles r2 on r2.business_id = s.business_id and r2.name = s.role
       where s.business_id = p_business_id and s.status = 'active'
         and lower(s.email) = lower(auth.email())
         and coalesce((r2.permissions ->> 'canDelete')::boolean, false))) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete products, can restore products'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_products where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;

  for r in
    select d.id, d.product_id, d.product
      from public.deleted_products d
     where d.business_id = p_business_id and d.deletion_id = p_deletion_id and d.restored_at is null
     order by d.product_name, d.id
     for update
  loop
    if exists (select 1 from public.products where id = r.product_id) then
      v_skipped_back := v_skipped_back + 1;
    elsif exists (select 1 from public.products p
                   where p.business_id = p_business_id
                     and lower(btrim(p.name)) = lower(btrim(r.product ->> 'name'))
                     and lower(btrim(coalesce(p.generic_name, ''))) = lower(btrim(coalesce(r.product ->> 'generic_name', '')))) then
      v_skipped_name := v_skipped_name + 1;
    else
      insert into public.products select (jsonb_populate_record(null::public.products, r.product)).*;
      update public.deleted_products set restored_at = now(), restored_by = auth.uid() where id = r.id;
      v_restored := v_restored + 1;
    end if;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when v_owner then 'owner' else 'staff' end, p_business_id, 'inventory.products_restored',
            'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_name_taken', v_skipped_name));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_name_taken', v_skipped_name);
end $$;

revoke all on function public.restore_deleted_products(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_products(uuid, uuid) to authenticated;
