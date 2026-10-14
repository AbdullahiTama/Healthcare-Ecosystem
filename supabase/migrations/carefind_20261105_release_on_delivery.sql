-- ---------------------------------------------------------------------------------------------
-- carefind_20261105: release the vendor's share the moment the order is DELIVERED (no hold).
--
-- Owner decision (2026-10-14): a vendor withdraws as soon as the goods are delivered. Before this
-- migration the share was held until delivered + shop_vendor_return_window_days (7), then swept.
-- That single config number coupled two different things: how long the VENDOR'S MONEY waits, and
-- how long the CUSTOMER may return. They are now decoupled and the payout hold is gone:
--
--   * release_shop_vendor_credits no longer reads shop_vendor_return_window_days. A credit is
--     released as soon as the order is 'delivered' -- by the delivery trigger below (same
--     transaction, so the money is withdrawable immediately) and by the daily sweep (backstop).
--   * The CUSTOMER's return window is UNCHANGED: request_shop_return and request_shop_return_service
--     still read shop_vendor_return_window_days, measured from the first delivery. The config value
--     deliberately stays 7 -- zeroing it would delete customers' return rights.
--
-- Accepted tradeoff (owner): a return requested after delivery may find the money already
-- withdrawn. The return itself is still granted inside its 7 days; the refund engine then claws the
-- vendor's share back from available_balance, and if it is already gone it records the shortfall on
-- the refund and reconcile_shop_vendor_credits() lists it (refund_shortfall). Nothing here can
-- double-pay: release only ever moves held -> available for one order, guarded to run once
-- (status 'held'), and a refund recovers the share before the customer is paid.
--
-- The release is deliberately the SAME guarded function the sweep already runs: it still refuses an
-- order that is not delivered, has a requested return, or has a live refund, and it still takes
-- locks in one order (order, credit, wallet). So the sweep stays correct -- only now it normally
-- finds nothing to do.
--
-- release_shop_vendor_credits gains an optional p_order_id so the delivery trigger can release
-- exactly one order instead of sweeping the table from inside a delivery transaction. The signature
-- changed, so the OLD (integer) function is dropped rather than overloaded: two overloads would make
-- the existing `release_shop_vendor_credits(200)` calls ambiguous.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.release_shop_vendor_credits(integer);

create or replace function public.release_shop_vendor_credits(p_limit integer default 200, p_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  o public.shop_orders%rowtype;
  c public.shop_vendor_credits%rowtype;
  v_amount integer;
  v_held integer;
  v_move integer;
  v_released integer := 0;
  v_kobo bigint := 0;
  v_partial integer := 0;
begin
  for r in
    select c2.order_id
      from public.shop_vendor_credits c2
      join public.shop_orders o2 on o2.id = c2.order_id
     where c2.status = 'held' and c2.amount_kobo > c2.reversed_kobo and o2.status = 'delivered'
       and (p_order_id is null or c2.order_id = p_order_id)
     order by c2.credited_at
     limit greatest(1, least(p_limit, 1000))
  loop
    -- order first, then credit, then wallet: the same order a refund takes
    select * into o from public.shop_orders where id = r.order_id for update;
    select * into c from public.shop_vendor_credits where order_id = r.order_id for update;
    if o.status is distinct from 'delivered' or c.status <> 'held' then continue; end if;
    if exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = o.id and f.status in ('requested', 'processing')) then continue; end if;
    if exists (select 1 from public.shop_order_returns sr where sr.order_id = o.id and sr.status = 'requested') then continue; end if;

    v_amount := c.amount_kobo - c.reversed_kobo;
    select held_balance into v_held from public.business_wallets where business_id = c.business_id for update;
    v_move := least(v_amount, coalesce(v_held, 0));
    if v_move < v_amount then v_partial := v_partial + 1; end if;
    if v_move > 0 then
      update public.business_wallets set held_balance = held_balance - v_move, available_balance = available_balance + v_move, updated_at = now() where business_id = c.business_id;
      insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
      values (c.business_id, 'shop_release', v_move, 'shoprl_' || c.order_id, 'confirmed');
    end if;
    update public.shop_vendor_credits
       set status = 'released', released_kobo = v_move, release_shortfall_kobo = v_amount - v_move, released_at = now()
     where order_id = c.order_id;
    v_released := v_released + 1;
    v_kobo := v_kobo + v_move;
  end loop;
  return jsonb_build_object('released', v_released, 'released_kobo', v_kobo, 'partial', v_partial);
end;
$$;
revoke all on function public.release_shop_vendor_credits(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_shop_vendor_credits(integer, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Release exactly the order that was just delivered, in the same transaction that delivered it.
--
-- SECURITY DEFINER so the release runs whatever role moved the order (a vendor through
-- update_shop_order_status, the refund engine restoring an order, a return being rejected, an
-- admin, or the server): release_shop_vendor_credits itself is service_role-only, and this trigger
-- must be able to call it. search_path is pinned; it performs one call scoped to NEW.id and writes
-- nothing else, so it cannot recurse -- releasing touches business_wallets,
-- business_wallet_transactions and shop_vendor_credits, never shop_orders.
--
-- No REVOKE here, matching shop_vendor_credits_guard: PostgreSQL refuses any direct call to a
-- trigger function ("trigger functions can only be called as triggers"), so an API role cannot
-- reach this one by name at all. Revoking roles would buy no security here and would only risk
-- breaking the fire path.
--
-- The WHEN clause keeps it to a real transition INTO 'delivered', so a row that is already
-- delivered and merely updated again does not re-run it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.release_vendor_credit_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.release_shop_vendor_credits(1, NEW.id);
  return NEW;
end;
$$;

drop trigger if exists trg_shop_order_release_on_delivery on public.shop_orders;
create trigger trg_shop_order_release_on_delivery
  after update of status on public.shop_orders
  for each row
  when (NEW.status = 'delivered' and OLD.status is distinct from 'delivered')
  execute function public.release_vendor_credit_on_delivery();
