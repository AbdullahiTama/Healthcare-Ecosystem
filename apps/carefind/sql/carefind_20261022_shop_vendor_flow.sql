-- Shop flow review, part 3: the order from CareFind to CareHub (docs/architecture/Shop-Flow-Review.md, SV-1 .. SV-6).
-- SV-1 .. SV-3 are app fixes (CareHub); this migration carries SV-4 .. SV-6.
--
-- SV-4  Shop orders, their items, status history, payment attempts and tracking events are written ONLY by the SECURITY DEFINER
--       functions (create_shop_order, settle_payment_intent, update_shop_order_status, add_tracking_event, quote_shop_order_delivery,
--       cancel_shop_order, the return/refund engine, expire_unpaid_shop_orders) and by the service role (the payment API). No client
--       writes them directly (checked across CareFind, CareHub and the API on 2026-10-07). The table grants are therefore taken back
--       from anon and authenticated, so whatever write policy production still carries from before the conformance work can never be
--       used: a vendor writing a backdated 'delivered' history row (which starts the return-window clock that releases its money),
--       editing an order's status/amounts, or adding items to an order. Reads are untouched (RLS still decides who sees what).
-- SV-5  generate_tracking_token: the vendor's "Generate tracking link" (CareHub, Delivery Tracking) always failed: the function let
--       only the customer create a token. The order's vendor may now create one too (it already sees everything the public tracking
--       page shows). The token comes from gen_random_uuid() (core Postgres) instead of pgcrypto's gen_random_bytes, which a
--       search_path of public does not reach on Supabase (pgcrypto lives in the extensions schema).
-- SV-6  shop_tracking_tokens was readable by anyone (policy "shop_tracking_tokens_select": anon, USING (true)): the anon key alone
--       listed every token, and each token opens get_tracking_by_token for that order: its status, the vendor's tracking notes and
--       the GPS locations recorded on the way to the customer. Tokens are now read and written only through the SECURITY DEFINER
--       functions (generate_tracking_token, get_tracking_by_token); nothing in the apps reads the table directly.
--
-- Safe to re-run. Rollback: re-grant the privileges below and restore the token policies and generate_tracking_token from
-- carehub_20260906_shop_delivery_tracking.sql (not recommended: it reopens SV-4 and SV-6).

begin;

-- ---------------------------------------------------------------------------------------------
-- SV-4 no direct client writes to the order, its items, its history, its payments or its tracking
-- ---------------------------------------------------------------------------------------------
revoke insert, update, delete, truncate on table
  public.shop_orders,
  public.shop_order_items,
  public.shop_order_status_history,
  public.shop_payments,
  public.shop_order_tracking_events
from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- SV-6 tracking tokens are secrets: no listing them
-- ---------------------------------------------------------------------------------------------
drop policy if exists "shop_tracking_tokens_select" on public.shop_tracking_tokens;
drop policy if exists "shop_tracking_tokens_insert" on public.shop_tracking_tokens;
alter table public.shop_tracking_tokens enable row level security;
revoke all on table public.shop_tracking_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- SV-5 the vendor can create the public tracking link for its own order
-- ---------------------------------------------------------------------------------------------
create or replace function public.generate_tracking_token(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_customer uuid;
  v_vendor uuid;
begin
  select customer_id, vendor_business_id into v_customer, v_vendor from shop_orders where id = p_order_id;
  if v_customer is null then raise exception 'Order not found'; end if;

  if not (auth.role() = 'service_role' or public.is_platform_admin()
          or v_customer = auth.uid()
          or v_vendor in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select token into v_token from shop_tracking_tokens where order_id = p_order_id and expires_at > now() order by expires_at desc limit 1;
  if v_token is not null then return v_token; end if;

  v_token := 'TRK-' || replace(gen_random_uuid()::text, '-', '');
  insert into shop_tracking_tokens (order_id, token) values (p_order_id, v_token);
  return v_token;
end;
$$;
revoke all on function public.generate_tracking_token(uuid) from public, anon;
grant execute on function public.generate_tracking_token(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- self-check
-- ---------------------------------------------------------------------------------------------
do $$
declare t text; p text;
begin
  foreach t in array array['shop_orders', 'shop_order_items', 'shop_order_status_history', 'shop_payments', 'shop_order_tracking_events'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || t, p) or has_table_privilege('anon', 'public.' || t, p) then
        raise exception 'a client can still % %', p, t;
      end if;
    end loop;
  end loop;
  if has_table_privilege('anon', 'public.shop_tracking_tokens', 'SELECT') or has_table_privilege('authenticated', 'public.shop_tracking_tokens', 'SELECT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shop_tracking_tokens') then
    raise exception 'tracking tokens are still readable by clients';
  end if;
end $$;

commit;
