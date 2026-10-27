-- Credit sales must name a customer record; purchases keep their line items.
--
-- Written against the LIVE schema read on 2026-10-27:
--   * sales.client_id (uuid, nullable) and clients(id, business_id, full_name, ...). 10 of 15 credit sales had no
--     client_id: the POS linked a sale to a customer only when the typed name happened to match one exactly.
--   * purchases kept one row per invoice with the items squashed into product_name, a total quantity and an
--     average cost_price. The quantity and price of each line were never stored.
--
-- WHAT THIS ADDS
--   1. sales_require_credit_customer (BEFORE INSERT on sales): a completed credit sale (is_credit, not held) must
--      carry a client_id that belongs to the same business. Otherwise the insert is refused with a sentence the
--      till shows. Existing rows are not touched; held sales and cash sales are unaffected.
--   2. purchases.items jsonb: the invoice lines [{ name, qty, cost, sell, batch, expiry, cat }]. Older rows keep
--      NULL and are shown from product_name / quantity / cost_price as before.
--
-- SECURITY
--   * The guard is SECURITY DEFINER only so it can see the client row whatever the caller's RLS; it reads one row
--     by id and business and writes nothing. EXECUTE is revoked from everyone (it runs only as a trigger).
--   * No permission changes: who may record a sale or a purchase is unchanged.
--
-- DEPLOYMENT: safe in either order. The app sends client_id on every credit sale, and it retries a purchase
-- insert without items if this column is not there yet.
--
-- ROLLBACK: drop trigger sales_require_credit_customer on public.sales; drop function
-- public.sales_require_credit_customer(); alter table public.purchases drop column if exists items;

create or replace function public.sales_require_credit_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_credit, false) and not coalesce(new.is_on_hold, false) then
    if new.client_id is null then
      raise exception 'Select the customer for this credit sale.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.clients c where c.id = new.client_id and c.business_id = new.business_id) then
      raise exception 'That customer is not in this business''s records. Select the customer again.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.sales_require_credit_customer() from public, anon, authenticated;

drop trigger if exists sales_require_credit_customer on public.sales;
create trigger sales_require_credit_customer before insert on public.sales
  for each row execute function public.sales_require_credit_customer();

alter table public.purchases add column if not exists items jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'purchases_items_is_array') then
    alter table public.purchases add constraint purchases_items_is_array
      check (items is null or jsonb_typeof(items) = 'array');
  end if;
end $$;
