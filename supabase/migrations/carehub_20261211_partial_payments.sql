-- Partial payments with history: customers paying off credit sales, and the business paying suppliers.
--
-- Written against the LIVE schema read on 2026-10-26:
--   * sales(amount_paid, balance, is_credit, txn_no, client_name, ...), purchases(supplier_name, total_cost,
--     amount_paid, balance, status 'pending'|'paid', ...), debts(source 'credit_sale'|'purchase'|'manual',
--     source_ref = sale txn_no | purchase id, amount_paid, balance, status 'pending'|'paid').
--   * All three tables: one RLS policy "<table> of own business" (business_id in current_business_ids() or admin).
--   * There was no payment-history table. POS updated amount_paid with a value computed in the browser
--     (read, add, write back), so two tills collecting at the same moment could lose one payment; Purchases could
--     only set a purchase to fully paid.
--
-- WHAT THIS ADDS (nothing existing is altered except rows the backfill below inserts into the new tables)
--   1. sale_payments, purchase_payments: one row per payment, append-only. Clients may only SELECT their own
--      business's rows; rows are written only by the functions below and the insert triggers.
--   2. record_sale_payment(), record_purchase_payment(): lock the row, validate the amount (> 0, <= balance),
--      update amount_paid / balance / status, keep the linked debt (Debts page) in step, and record the payment,
--      all in one transaction. They return the new totals.
--   3. Insert triggers: the amount paid when a credit sale or a purchase is first recorded becomes its first
--      history row, so the history adds up to amount_paid.
--   4. get_supplier_balances() / get_supplier_purchases(): totals and purchases per supplier (purchases are keyed
--      by supplier_name; names are grouped ignoring case and surrounding spaces).
--   5. Backfill: one "before payment history" row for each existing credit sale / purchase with amount_paid > 0.
--
-- SECURITY
--   * The record_* functions are SECURITY DEFINER (so the history tables need no client write grant) and check
--     membership first, with the same rule as the tables' RLS: the row's business is in current_business_ids(),
--     or the caller is a platform admin. Anyone else gets "not found" (no existence leak). anon has no EXECUTE.
--   * Who may record a payment is unchanged: any member of the business could already update these rows.
--   * recorded_by is auth.uid() (trusted); staff_name is the display name the app passes (informational only).
--
-- ROLLBACK: drop the six functions, the two triggers and the two tables. sales/purchases/debts keep the totals
-- that were written, which is exactly what the old code would have written.

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.sale_payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  sale_id       uuid not null references public.sales(id) on delete cascade,
  txn_no        text not null,
  client_name   text,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null default 'Cash' check (method in ('Cash', 'Transfer', 'POS', 'Other')),
  kind          text not null default 'payment' check (kind in ('payment', 'at_sale', 'before_history')),
  note          text check (note is null or length(note) <= 300),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  recorded_by   uuid,
  staff_name    text check (staff_name is null or length(staff_name) <= 120),
  created_at    timestamptz not null default now()
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id, created_at desc);
create index if not exists sale_payments_business_idx on public.sale_payments (business_id, created_at desc);

create table if not exists public.purchase_payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  purchase_id   uuid not null references public.purchases(id) on delete cascade,
  supplier_name text not null,
  supplier_key  text generated always as (lower(btrim(supplier_name))) stored,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null default 'Transfer' check (method in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other')),
  kind          text not null default 'payment' check (kind in ('payment', 'at_purchase', 'before_history')),
  paid_on       date not null default current_date,
  note          text check (note is null or length(note) <= 300),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  recorded_by   uuid,
  staff_name    text check (staff_name is null or length(staff_name) <= 120),
  created_at    timestamptz not null default now()
);
create index if not exists purchase_payments_purchase_idx on public.purchase_payments (purchase_id, created_at desc);
create index if not exists purchase_payments_supplier_idx on public.purchase_payments (business_id, supplier_key, created_at desc);

alter table public.sale_payments enable row level security;
alter table public.purchase_payments enable row level security;

drop policy if exists "sale payments of own business" on public.sale_payments;
create policy "sale payments of own business" on public.sale_payments for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());
drop policy if exists "purchase payments of own business" on public.purchase_payments;
create policy "purchase payments of own business" on public.purchase_payments for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

-- Read-only to clients: history is written by the functions and triggers below, never edited.
revoke all on public.sale_payments, public.purchase_payments from public, anon, authenticated;
grant select on public.sale_payments, public.purchase_payments to authenticated;
grant all on public.sale_payments, public.purchase_payments to service_role;

-- ── Record a payment against a credit sale ───────────────────────────────────────────────────────────────────
create or replace function public.record_sale_payment(
  p_sale_id uuid,
  p_amount numeric,
  p_method text default 'Cash',
  p_note text default null,
  p_staff_name text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.sales%rowtype;
  v_amount numeric(14,2);
  v_paid   numeric(14,2);
  v_bal    numeric(14,2);
  v_id     uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;
  v_amount := round(p_amount, 2);

  select * into s from public.sales where id = p_sale_id for update;
  if not found or not (s.business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if coalesce(s.is_on_hold, false) then
    raise exception 'This sale is on hold. Complete it before recording a payment.' using errcode = '22023';
  end if;
  if round(coalesce(s.balance, 0), 2) <= 0 then
    raise exception 'This sale has nothing left to pay.' using errcode = '22023';
  end if;
  if v_amount > round(s.balance, 2) then
    raise exception 'The amount is more than the balance of %.', to_char(round(s.balance, 2), 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;
  if coalesce(p_method, '') not in ('Cash', 'Transfer', 'POS', 'Other') then
    raise exception 'Choose how the customer paid.' using errcode = '22023';
  end if;

  v_paid := round(coalesce(s.amount_paid, 0) + v_amount, 2);
  v_bal  := greatest(round(s.balance - v_amount, 2), 0);

  update public.sales
     set amount_paid = v_paid, balance = v_bal, is_credit = v_bal > 0
   where id = s.id;

  -- The credit sale's debt on the Debts page moves with it.
  update public.debts
     set amount_paid = round(coalesce(amount_paid, 0) + v_amount, 2),
         balance     = greatest(round(coalesce(balance, 0) - v_amount, 2), 0),
         status      = case when round(coalesce(balance, 0) - v_amount, 2) <= 0 then 'paid' else 'pending' end
   where business_id = s.business_id and source = 'credit_sale' and source_ref = s.txn_no
     and coalesce(status, '') <> 'paid';

  insert into public.sale_payments (business_id, sale_id, txn_no, client_name, amount, method, kind, note, balance_after, recorded_by, staff_name)
  values (s.business_id, s.id, s.txn_no, s.client_name, v_amount, p_method, 'payment', nullif(btrim(p_note), ''), v_bal, auth.uid(), nullif(btrim(p_staff_name), ''))
  returning id into v_id;

  return json_build_object('payment_id', v_id, 'sale_id', s.id, 'amount', v_amount, 'amount_paid', v_paid, 'balance', v_bal);
end;
$$;

-- ── Record a payment to a supplier against a purchase ────────────────────────────────────────────────────────
create or replace function public.record_purchase_payment(
  p_purchase_id uuid,
  p_amount numeric,
  p_method text default 'Transfer',
  p_paid_on date default null,
  p_note text default null,
  p_staff_name text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.purchases%rowtype;
  v_amount numeric(14,2);
  v_paid   numeric(14,2);
  v_bal    numeric(14,2);
  v_status text;
  v_id     uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;
  v_amount := round(p_amount, 2);

  select * into p from public.purchases where id = p_purchase_id for update;
  if not found or not (p.business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'Purchase not found.' using errcode = 'P0002';
  end if;
  if round(coalesce(p.balance, 0), 2) <= 0 then
    raise exception 'This purchase is already fully paid.' using errcode = '22023';
  end if;
  if v_amount > round(p.balance, 2) then
    raise exception 'The amount is more than the balance of %.', to_char(round(p.balance, 2), 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;
  if coalesce(p_method, '') not in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other') then
    raise exception 'Choose how the supplier was paid.' using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  v_paid   := round(coalesce(p.amount_paid, 0) + v_amount, 2);
  v_bal    := greatest(round(p.balance - v_amount, 2), 0);
  v_status := case when v_bal <= 0 then 'paid' else 'partial' end;

  update public.purchases set amount_paid = v_paid, balance = v_bal, status = v_status where id = p.id;

  -- The "we owe" debt raised for this purchase on the Debts page moves with it.
  update public.debts
     set amount_paid = round(coalesce(amount_paid, 0) + v_amount, 2),
         balance     = greatest(round(coalesce(balance, 0) - v_amount, 2), 0),
         status      = case when round(coalesce(balance, 0) - v_amount, 2) <= 0 then 'paid' else 'pending' end
   where business_id = p.business_id and source = 'purchase' and source_ref = p.id::text
     and coalesce(status, '') <> 'paid';

  insert into public.purchase_payments (business_id, purchase_id, supplier_name, amount, method, kind, paid_on, note, balance_after, recorded_by, staff_name)
  values (p.business_id, p.id, coalesce(nullif(btrim(p.supplier_name), ''), 'Unknown supplier'), v_amount, p_method, 'payment',
          coalesce(p_paid_on, current_date), nullif(btrim(p_note), ''), v_bal, auth.uid(), nullif(btrim(p_staff_name), ''))
  returning id into v_id;

  return json_build_object('payment_id', v_id, 'purchase_id', p.id, 'amount', v_amount, 'amount_paid', v_paid, 'balance', v_bal, 'status', v_status);
end;
$$;

-- ── Totals per supplier ──────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: purchases' RLS decides which rows the caller sees.
create or replace function public.get_supplier_balances(p_business_id uuid)
returns table (supplier_key text, supplier_name text, purchase_count bigint, total_cost numeric, amount_paid numeric,
               balance numeric, open_count bigint, last_purchase_at timestamp)
language sql
stable
security invoker
set search_path = public
as $$
  select lower(btrim(p.supplier_name)) as supplier_key,
         min(btrim(p.supplier_name)) as supplier_name,
         count(*) as purchase_count,
         coalesce(sum(p.total_cost), 0) as total_cost,
         coalesce(sum(p.amount_paid), 0) as amount_paid,
         coalesce(sum(greatest(p.balance, 0)), 0) as balance,
         count(*) filter (where coalesce(p.balance, 0) > 0) as open_count,
         max(p.created_at) as last_purchase_at
    from public.purchases p
   where p.business_id = p_business_id
   group by lower(btrim(p.supplier_name))
   order by coalesce(sum(greatest(p.balance, 0)), 0) desc, min(btrim(p.supplier_name))
$$;

-- The purchases from one supplier, by the same key (case and surrounding spaces ignored). SECURITY INVOKER.
create or replace function public.get_supplier_purchases(p_business_id uuid, p_supplier_key text)
returns setof public.purchases
language sql
stable
security invoker
set search_path = public
as $$
  select p.* from public.purchases p
   where p.business_id = p_business_id and lower(btrim(p.supplier_name)) = lower(btrim(p_supplier_key))
   order by p.created_at desc, p.id
$$;

-- ── First history row when a credit sale / purchase is recorded with money already paid ─────────────────────
-- History must never block a sale or a purchase: if the history row cannot be written (an unexpected value),
-- the sale/purchase is still recorded and a warning is logged.
create or replace function public.sale_payment_at_sale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not null and coalesce(new.is_credit, false) and coalesce(new.amount_paid, 0) > 0 then
    begin
      insert into public.sale_payments (business_id, sale_id, txn_no, client_name, amount, method, kind, balance_after, staff_name, created_at)
      values (new.business_id, new.id, coalesce(new.txn_no, ''), new.client_name, round(new.amount_paid, 2),
              case when new.payment_method in ('Cash', 'Transfer', 'POS') then new.payment_method else 'Other' end,
              'at_sale', greatest(round(coalesce(new.balance, 0), 2), 0), left(new.staff_name, 120), coalesce(new.created_at, now()));
    exception when others then
      raise warning 'sale_payment_at_sale: history not written for sale %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

create or replace function public.purchase_payment_at_purchase() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not null and coalesce(new.amount_paid, 0) > 0 then
    begin
      insert into public.purchase_payments (business_id, purchase_id, supplier_name, amount, method, kind, paid_on, balance_after, created_at)
      values (new.business_id, new.id, coalesce(nullif(btrim(new.supplier_name), ''), 'Unknown supplier'), round(new.amount_paid, 2), 'Other',
              'at_purchase', coalesce(new.created_at::date, current_date), greatest(round(coalesce(new.balance, 0), 2), 0), coalesce(new.created_at, now()));
    exception when others then
      raise warning 'purchase_payment_at_purchase: history not written for purchase %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists sale_payment_at_sale on public.sales;
create trigger sale_payment_at_sale after insert on public.sales for each row execute function public.sale_payment_at_sale();
drop trigger if exists purchase_payment_at_purchase on public.purchases;
create trigger purchase_payment_at_purchase after insert on public.purchases for each row execute function public.purchase_payment_at_purchase();

-- ── Backfill: what was paid before history existed ───────────────────────────────────────────────────────────
insert into public.sale_payments (business_id, sale_id, txn_no, client_name, amount, method, kind, note, balance_after, created_at)
select s.business_id, s.id, s.txn_no, s.client_name, round(s.amount_paid, 2), 'Other', 'before_history',
       'Paid before payment history was kept', greatest(round(coalesce(s.balance, 0), 2), 0), coalesce(s.created_at, now())
  from public.sales s
 where s.business_id is not null and coalesce(s.amount_paid, 0) > 0
   and (coalesce(s.is_credit, false) or exists (select 1 from public.debts d where d.source = 'credit_sale' and d.source_ref = s.txn_no and d.business_id = s.business_id))
   and not exists (select 1 from public.sale_payments x where x.sale_id = s.id);

insert into public.purchase_payments (business_id, purchase_id, supplier_name, amount, method, kind, paid_on, note, balance_after, created_at)
select p.business_id, p.id, coalesce(nullif(btrim(p.supplier_name), ''), 'Unknown supplier'), round(p.amount_paid, 2), 'Other', 'before_history',
       coalesce(p.created_at::date, current_date), 'Paid before payment history was kept', greatest(round(coalesce(p.balance, 0), 2), 0), coalesce(p.created_at, now())
  from public.purchases p
 where p.business_id is not null and coalesce(p.amount_paid, 0) > 0
   and not exists (select 1 from public.purchase_payments x where x.purchase_id = p.id);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.record_sale_payment(uuid, numeric, text, text, text) from public, anon;
revoke all on function public.record_purchase_payment(uuid, numeric, text, date, text, text) from public, anon;
revoke all on function public.get_supplier_balances(uuid) from public, anon;
revoke all on function public.get_supplier_purchases(uuid, text) from public, anon;
revoke all on function public.sale_payment_at_sale() from public, anon, authenticated;
revoke all on function public.purchase_payment_at_purchase() from public, anon, authenticated;
grant execute on function public.record_sale_payment(uuid, numeric, text, text, text) to authenticated, service_role;
grant execute on function public.record_purchase_payment(uuid, numeric, text, date, text, text) to authenticated, service_role;
grant execute on function public.get_supplier_balances(uuid) to authenticated, service_role;
grant execute on function public.get_supplier_purchases(uuid, text) to authenticated, service_role;
