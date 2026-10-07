-- Shop flow review (order -> payment -> fulfilment -> delivery). Two database defects on the vendor / customer side of the flow:
--
--  S-1  add_tracking_event (the vendor's "add tracking update") wrote its customer notice into notifications(user_id, title, data).
--       The live notifications table is (recipient_id, type, message, link) - the columns every other shop function and the app
--       use - so the insert failed and took the whole call down: the vendor could never record a tracking update. It also set the
--       order status on its own terms, with only "is the order paid" as a rule, so it bypassed the forward-only fulfilment rules
--       update_shop_order_status enforces since F-39 (a vendor could move a cancelled-but-paid order to 'delivered', or go backwards)
--       and wrote no status history. The status change now goes THROUGH update_shop_order_status (same rules, history, notices,
--       status email); the function only adds the tracking row.
--
--  S-2  notify_stock_alerts_on_restock (trigger on products.stock) compared products.id with ecommerce_products.id and with
--       shop_stock_alerts.ecommerce_product_id, which never match, so no "back in stock" alert was ever sent. Had they matched, its
--       notifications(user_id, title, data) insert would have failed and rolled back the restock itself (including the stock a
--       cancelled order puts back). It now finds the alerts through ecommerce_products.product_id and writes the live columns.

-- ---------------------------------------------------------------------------------------------
-- S-1 add_tracking_event
-- ---------------------------------------------------------------------------------------------
create or replace function public.add_tracking_event(p_order_id uuid, p_status text, p_notes text default null, p_location jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor uuid; v_pay text;
begin
  select vendor_business_id, payment_status into v_vendor, v_pay from shop_orders where id = p_order_id;
  if v_vendor is null then raise exception 'Order not found'; end if;
  if v_vendor not in (select current_business_ids()) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status not in ('accepted', 'processing', 'packed', 'at_pickup_station', 'ready_for_pickup', 'in_transit', 'delivered') or v_pay is distinct from 'paid' then
    raise exception 'This status change is not allowed' using errcode = '42501';
  end if;

  -- same status = a location / note update on the current step (a no-op there); otherwise the vendor's fulfilment rules apply
  perform public.update_shop_order_status(p_order_id, p_status, null, p_notes);
  insert into shop_order_tracking_events (order_id, status, location, notes, created_by) values (p_order_id, p_status, p_location, p_notes, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- S-2 notify_stock_alerts_on_restock
-- ---------------------------------------------------------------------------------------------
create or replace function public.notify_stock_alerts_on_restock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert record;
begin
  if coalesce(old.stock, 0) <= 0 and new.stock > 0 then
    -- products is the inventory row; shoppers watch its shop listing(s)
    for v_alert in
      select sa.id, sa.user_id, sa.ecommerce_product_id
        from shop_stock_alerts sa
        join ecommerce_products ep on ep.id = sa.ecommerce_product_id
       where ep.product_id = new.id and sa.is_active and sa.notified_at is null
    loop
      insert into notifications (recipient_id, type, message, link)
      values (v_alert.user_id, 'stock_alert', coalesce(new.name, 'A product you''re watching') || ' is back in stock', '/shop/' || v_alert.ecommerce_product_id::text);
      update shop_stock_alerts set notified_at = now(), is_active = false, updated_at = now() where id = v_alert.id;
    end loop;
  end if;
  return new;
end;
$$;
