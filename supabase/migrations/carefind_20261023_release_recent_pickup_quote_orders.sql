-- Shop-Flow-Review SD-7 data fix (applied to production on 2026-10-07): pickup orders placed in the last 7 days that the old
-- create_shop_order sent to delivery_quote_pending have nothing to quote; open them for payment (history + customer notice).
-- Older ones are left to expire_unpaid_shop_orders (7 days without a quote), which cancels them and returns their stock.
with fixed as (
  update public.shop_orders
     set status = 'pending_payment', updated_at = now()
   where status = 'delivery_quote_pending' and delivery_preference = 'pickup' and payment_status = 'pending'
     and created_at > now() - interval '7 days'
  returning id, customer_id, order_ref
), hist as (
  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  select id, 'delivery_quote_pending', 'pending_payment', null, 'Pickup order: no delivery to quote' from fixed
  returning order_id
)
insert into public.notifications (recipient_id, type, message, link)
select customer_id, 'shop_order_pending', 'Order ' || order_ref || ' is ready for payment — complete payment to confirm', '/orders/' || id::text
from fixed;
