-- Supplier payments: paying a purchase in full or in parts, with history.
--
-- Written against the LIVE schema read on 2026-10-27:
--   * purchases(supplier_name, total_cost, amount_paid, balance, status 'pending'|'paid', ...) with one RLS policy
--     (business_id in current_business_ids() or admin); debts(source 'purchase', source_ref = purchase id,
--     amount_paid, balance, status).
--   * Purchases could only be set to fully paid, and nothing recorded when or how a supplier was paid.
--   * Customer credit payments are NOT handled here: they use the POS ledger (sale_payments,
--     record_sale_payment) from carehub_20261210_pos_accounting.sql.
--
-- WHAT THIS ADDS (nothing existing is altered except rows the backfill inserts into the new table)
--   1. purchase_payments: one row per payment to a supplier, append-only. Clients may only SELECT their own
--      business's rows; rows are written only by the function and the insert trigger below.
--   2. record_purchase_payment(): locks the purchase, validates the amount (> 0, <= balance), updates
--      amount_paid / balance / status ('partial' or 'paid'), keeps the linked debt (Debts page) in step, and
--      records the payment, all in one transaction. Returns the new totals.
--   3. Insert trigger: the amount paid when a purchase is first recorded becomes its first history row, so the
--      history adds up to amount_paid. It never blocks the purchase.
--   4. get_supplier_balances() / get_supplier_purchases(): totals and purchases per supplier (purchases are keyed
--      by supplier_name; names are grouped ignoring case and surrounding spaces).
--   5. Backfill: one "before payment history" row for each existing purchase with amount_paid > 0.
--
-- SECURITY
--   * record_purchase_payment is SECURITY DEFINER (so the history table needs no client write grant) and checks
--     membership first, with the same rule as purchases' RLS: the row's business is in current_business_ids(),
--     or the caller is a platform admin. Anyone else gets "not found" (no existence leak). anon has no EXECUTE
--     (revoked explicitly: Supabase grants EXECUTE to anon when a function is created).
--   * Who may record a payment is unchanged: any member of the business could already update purchases.
--   * recorded_by is auth.uid() (trusted); staff_name is the display name the app passes (informational only).
--
-- ROLLBACK: drop the four functions, the trigger and purchase_payments. purchases/debts keep the totals that were
-- written.

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────────────────────
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

alter table public.purchase_payments enable row level security;

drop policy if exists "purchase payments of own business" on public.purchase_payments;
create policy "purchase payments of own business" on public.purchase_payments for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

-- Read-only to clients: history is written by the functions and triggers below, never edited.
revoke all on public.purchase_payments from public, anon, authenticated;
grant select on public.purchase_payments to authenticated;
grant all on public.purchase_payments to service_role;

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

-- ── First history row when a purchase is recorded with money already paid ─────────────────────
-- History must never block a purchase: if the history row cannot be written (an unexpected value), the purchase
-- is still recorded and a warning is logged.
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

drop trigger if exists purchase_payment_at_purchase on public.purchases;
create trigger purchase_payment_at_purchase after insert on public.purchases for each row execute function public.purchase_payment_at_purchase();

-- ── Backfill: what was paid before history existed ───────────────────────────────────────────────────────────
insert into public.purchase_payments (business_id, purchase_id, supplier_name, amount, method, kind, paid_on, note, balance_after, created_at)
select p.business_id, p.id, coalesce(nullif(btrim(p.supplier_name), ''), 'Unknown supplier'), round(p.amount_paid, 2), 'Other', 'before_history',
       coalesce(p.created_at::date, current_date), 'Paid before payment history was kept', greatest(round(coalesce(p.balance, 0), 2), 0), coalesce(p.created_at, now())
  from public.purchases p
 where p.business_id is not null and coalesce(p.amount_paid, 0) > 0
   and not exists (select 1 from public.purchase_payments x where x.purchase_id = p.id);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.record_purchase_payment(uuid, numeric, text, date, text, text) from public, anon;
revoke all on function public.get_supplier_balances(uuid) from public, anon;
revoke all on function public.get_supplier_purchases(uuid, text) from public, anon;
revoke all on function public.purchase_payment_at_purchase() from public, anon, authenticated;
grant execute on function public.record_purchase_payment(uuid, numeric, text, date, text, text) to authenticated, service_role;
grant execute on function public.get_supplier_balances(uuid) to authenticated, service_role;
grant execute on function public.get_supplier_purchases(uuid, text) to authenticated, service_role;
