-- carehub_20270110_restore_respects_plan_limit
--
-- Status: APPLIED TO PRODUCTION 2026-11-10 (Supabase migration version 20261110083834) as part of the approved inventory
-- bulk delete change (it only narrows
-- restore), straight after carehub_20270109_inventory_bulk_delete. Tested first on PGlite
-- (apps/carefind/src/test/inventory/inventoryBulkDelete.db.test.js, plan-limit case included). Found by the live probe:
-- the probe's own product insert as a signed-in owner was refused by products_enforce_plan (the plan had expired),
-- which showed the trigger does not see this function's inserts. The live probe afterwards restored 2 products on that
-- expired plan (allowed, by design) with skipped_plan_limit 0.
--
-- PROBLEM
-- -------
-- restore_deleted_products() inserts products inside a SECURITY DEFINER function. products_enforce_plan (live,
-- 2026-11-10) only checks inserts made directly by signed-in users (current_user 'authenticated'/'anon'), so a restore
-- skipped the plan's product limit (Basic: 5,000): delete all, upload a new list of different names, restore the old
-- one, and the business is over its limit.
--
-- FIX
-- ---
-- Re-create restore_deleted_products() with one change: it stops at the plan's product limit
-- (plan_limit(plan, 'products'); none for paid plans) and returns how many it could not restore
-- (skipped_plan_limit). An expired plan still does not block a restore: undoing a deletion is not adding products,
-- and the expiry message itself says existing products keep working.
--
-- SECURITY IMPLICATIONS: none widened; the function is otherwise unchanged (same caller checks, SECURITY DEFINER,
-- search_path, grants).
--
-- ROLLBACK: re-run section 3 of carehub_20270109_inventory_bulk_delete.sql.

-- Restore a deletion, within the plan's product limit ─────────────────────────────────────────────────────────────────────────────────────
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
  v_skipped_limit int := 0;
  v_limit    integer;
  v_count    integer;
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
  -- The plan's product limit (products_enforce_plan does not run for this function's own inserts). An expired plan
  -- does not stop a restore: putting back what was deleted is not adding products.
  select public.plan_limit(b.plan, 'products') into v_limit from public.businesses b where b.id = p_business_id;
  select count(*) into v_count from public.products where business_id = p_business_id;

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
    elsif v_limit is not null and v_count >= v_limit then
      v_skipped_limit := v_skipped_limit + 1;
    else
      insert into public.products select (jsonb_populate_record(null::public.products, r.product)).*;
      update public.deleted_products set restored_at = now(), restored_by = auth.uid() where id = r.id;
      v_restored := v_restored + 1;
      v_count := v_count + 1;
    end if;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when v_owner then 'owner' else 'staff' end, p_business_id, 'inventory.products_restored',
            'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_name_taken', v_skipped_name,
                               'skipped_plan_limit', v_skipped_limit));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_name_taken', v_skipped_name,
                            'skipped_plan_limit', v_skipped_limit);
end $$;

revoke all on function public.restore_deleted_products(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_products(uuid, uuid) to authenticated;
