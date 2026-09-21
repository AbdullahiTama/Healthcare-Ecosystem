-- Migration: Enqueue order_status_update email on shop_orders.status change
-- Mirrors the production trigger (originally applied manually) so the repo
-- migrations reflect remote DB state.

create or replace function public.enqueue_shop_order_status_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_name text;
  v_template_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_template_status := case new.status
    when 'in_transit' then 'shipped'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'cancelled'
    when 'accepted' then 'processing'
    when 'processing' then 'processing'
    when 'packed' then 'processing'
    when 'at_pickup_station' then 'processing'
    when 'ready_for_pickup' then 'processing'
    else null
  end;

  if v_template_status is null then
    return new;
  end if;

  if new.delivery_email is null or position('@' in new.delivery_email) = 0 then
    return new;
  end if;

  select name into v_business_name
  from public.businesses
  where id = new.vendor_business_id;

  insert into public.email_outbox (
    to_email, from_email, subject, template_key, payload,
    status, next_retry_at
  ) values (
    new.delivery_email,
    'CareFind <support@mail.carefind.app>',
    'Your CareFind order has been updated',
    'order_status_update',
    jsonb_build_object(
      'fullName', coalesce(new.customer_name, 'Valued Customer'),
      'orderRef', new.order_ref,
      'status', v_template_status,
      'businessName', coalesce(v_business_name, 'CareFind')
    ),
    'pending', now()
  );

  return new;
end;
$function$;

drop trigger if exists trg_shop_orders_status_email on public.shop_orders;
create trigger trg_shop_orders_status_email
  after update of status on public.shop_orders
  for each row execute function public.enqueue_shop_order_status_email();