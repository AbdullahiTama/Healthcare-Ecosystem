-- Shop-Flow-Review section 10: the CareFind order status email (reliable email catalog, event carefind/order_status_update).
--
--  * The email now carries the order id, so its button opens /orders/<id> (it could only fall back to the order list).
--  * A delivery quote (delivery_quote_pending -> pending_payment, by quote_shop_order_delivery) now emails the customer
--    "Your delivery has been quoted - Pay for your order". Before, the customer was only told in the app.
--
-- Based on production's enqueue_shop_order_status_email() as read on 2026-10-07 (trigger trg_shop_order_status_history_email on
-- shop_order_status_history); changed only where marked. The catalog's payload schema gains an optional order_id (a uuid) and the
-- status 'delivery_quoted'; every other rule of the schema is kept. Nothing here enables the event: it stays as the catalog has it.
-- Requires the shared-email template that reads the catalog's snake_case payload (packages/shared-email, CareFind orderStatusUpdate).

-- the catalog accepts the order id and the quote status
update public.email_event_catalog
   set payload_schema = jsonb_set(
         jsonb_set(payload_schema, '{properties,order_id}',
                   '{"type": "string", "maxLength": 36, "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"}'::jsonb),
         '{properties,status,enum}',
         '["processing", "packed", "shipped", "delivered", "cancelled", "delivery_quoted"]'::jsonb)
 where app = 'carefind' and event_key = 'order_status_update';

create or replace function public.enqueue_shop_order_status_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_order record;
  v_business_name text;
  v_template_status text;
  v_source_id uuid;
begin
  if new.to_status is null then
    return new;
  end if;

  v_template_status := case new.to_status
    when 'packed' then 'packed'
    when 'in_transit' then 'shipped'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'cancelled'
    when 'accepted' then 'processing'
    when 'processing' then 'processing'
    when 'at_pickup_station' then 'processing'
    when 'ready_for_pickup' then 'processing'
    -- changed: the vendor's delivery quote opens the order for payment
    when 'pending_payment' then case when new.from_status = 'delivery_quote_pending' then 'delivery_quoted' end
    else null
  end;

  if v_template_status is null then
    return new;
  end if;

  select o.* into v_order
  from public.shop_orders o
  where o.id = new.order_id;

  if v_order is null then
    return new;
  end if;

  if v_order.delivery_email is null
     or position('@' in v_order.delivery_email) = 0 then
    return new;
  end if;

  select b.name into v_business_name
  from public.businesses b
  where b.id = v_order.vendor_business_id;

  v_source_id := new.id;

  perform public.enqueue_business_email_event(
    'carefind',
    'order_status_update',
    v_order.delivery_email,
    jsonb_build_object(
      'recipient_name', coalesce(v_order.customer_name, 'Valued Customer'),
      'business_name', coalesce(v_business_name, 'CareFind'),
      'order_reference', v_order.order_ref,
      'order_id', v_order.id::text,          -- changed: the email links to the order
      'status', v_template_status
    ),
    v_source_id
  );

  return new;
end;
$function$;

do $$
begin
  if not public.email_payload_schema_matches(
       (select payload_schema from public.email_event_catalog where app = 'carefind' and event_key = 'order_status_update'),
       jsonb_build_object('recipient_name', 'A', 'business_name', 'B', 'order_reference', 'CF-1',
                          'order_id', '3f6c1e2a-7b8d-4e9f-a1b2-c3d4e5f60718', 'status', 'delivery_quoted')) then
    raise exception 'the order status email schema does not accept the new payload';
  end if;
end $$;
