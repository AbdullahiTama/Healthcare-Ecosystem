-- carehub_20270107_expense_payments
--
-- Status: APPLIED TO PRODUCTION 2026-11-09 with the owner's approval (Supabase migration version 20261109100502),
-- applied verbatim from this file (statements only). Tested first on PGlite
-- (apps/carefind/src/test/expenses/expensePayments.db.test.js) with the live current_business_ids(),
-- is_platform_admin(), expense_effective_date() and the live expenses columns, read 2026-11-09.
-- Before: 55 expenses, total 277,259, none with a missing or negative amount. After: 55 expenses, all amount_paid =
-- amount; 55 'before_history' rows totalling 277,259.00; expense_payments: authenticated SELECT only, anon nothing;
-- record_expense_payment EXECUTE: authenticated only; expense_payment_history EXECUTE: nobody.
-- Live probe (DO block that raised at the end, so nothing remained; 0 rows left afterwards), as the Owner and active
-- cashier of a business and the owner of another business (carehub.test accounts):
--   1 unpaid insert (10,000, amount_paid 0):     paid 0, no history rows
--   2 Owner pays 4,000 (Cash):                   paid 4,000; one 'payment' row, balance_after 6,000
--   3 Owner pays 7,000:                          refused "That is more than the 6,000.00 still owed on this expense."
--   4 cashier pays 6,000 (Transfer):             paid 10,000
--   5 Owner sets amount_paid directly:           refused (guard)
--   6 Owner lowers amount to 3,000:              refused "cannot be less than what has already been paid (4000.00)"
--   7 insert without amount_paid (500):          paid 500; one 'at_recording' row
--     direct insert into expense_payments:       refused, permission denied
--   8 other business pays / reads history:       refused "That expense was not found." / 0 rows
--   9 anon pays / reads history:                 refused, permission denied (function / table)
-- Security advisor afterwards: one new item in authenticated_security_definer_function_executable,
-- record_expense_payment, which is intended (the app's way to pay an expense; it checks the caller's business first).
--
-- PROBLEM
-- -------
-- An expense could only be recorded as money already spent: public.expenses has no paid / unpaid state (audit A16,
-- verified against the live columns 2026-11-09). A bill received but not yet paid (rent due, a repair on credit) could
-- not be recorded truthfully, and the Expenses page could not filter or total by payment status.
--
-- FIX
-- ---
--   1. expenses.amount_paid (naira, 0 .. amount) and expenses.payment_method (how the first payment was made).
--      Every existing expense is set fully paid (amount_paid = amount), which is what it meant until now. The
--      outstanding balance and the status (paid / partially paid / unpaid) are derived, never stored, so they cannot
--      drift: balance = amount - amount_paid.
--   2. A BEFORE INSERT trigger defaults amount_paid to the full amount when the app does not send it, so an app build
--      from before this change keeps recording paid expenses exactly as before.
--   3. public.expense_payments: one row per payment, append-only (the same design as purchase_payments). The amount
--      paid when an expense is recorded becomes its first row ('at_recording'); existing paid expenses get one
--      'before_history' row, so each expense's history adds up to its amount_paid.
--   4. record_expense_payment(expense, amount, method, paid_on, note, staff_name): locks the expense, checks the
--      caller belongs to its business, checks 0 < amount <= balance, raises amount_paid and writes the history row in
--      one transaction. Returns the new totals.
--   5. amount_paid can change only through that function: a BEFORE UPDATE trigger refuses any other change to it, and
--      refuses lowering an expense's amount below what has been paid. (Signed-in members hold table-wide UPDATE on
--      expenses today, so a column grant could not do this; the trigger does.)
-- get_expense_totals / get_expense_summary / get_expenses_page are unchanged: spending is still the expense amount
-- (incurred), whether or not it has been paid. The budget therefore still counts an unpaid bill as spending.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. Who may record a payment is who may already edit expenses: a member of the business
--     (same rule as the expenses RLS policy: business_id IN current_business_ids(), or a platform admin). Anyone else
--     gets "not found" (no existence leak).
--   * record_expense_payment is SECURITY DEFINER with search_path public, pg_temp, so the history needs no client
--     write grant. EXECUTE: authenticated only (anon revoked explicitly; Supabase grants it on creation).
--   * expense_payments: RLS on; authenticated SELECT of their own business's rows; no client INSERT/UPDATE/DELETE;
--     anon nothing. recorded_by is auth.uid() (trusted); staff_name is display text from the app.
--   * The update guard closes a gap rather than opening one: before, a member could set any column; now amount_paid
--     moves only with a matching history row.
--
-- ROLLBACK
--   drop function public.record_expense_payment(uuid, numeric, text, date, text, text);
--   drop trigger expenses_payment_defaults on public.expenses; drop trigger expenses_payment_guard on public.expenses;
--   drop trigger expenses_payment_history on public.expenses;
--   drop function public.expense_payment_defaults(), public.expense_payment_guard(), public.expense_payment_history();
--   drop table public.expense_payments;
--   alter table public.expenses drop column payment_method, drop column amount_paid;
--   (The app treats a missing amount_paid as fully paid, so it keeps working after a rollback.)
--
-- PROBE AFTER APPLYING (inside a DO block that raises at the end, so nothing remains), as a real Owner, one of their
-- active staff and the owner of another business:
--   1 Owner inserts an expense of 10,000 with amount_paid 0:      allowed; 0 history rows; status unpaid
--   2 Owner records 4,000 (Cash):                                 amount_paid 4,000; 1 'payment' row, balance_after 6,000
--   3 Owner records 7,000:                                        refused "more than the 6,000 still owed"
--   4 staff member records 6,000:                                 allowed; amount_paid 10,000
--   5 Owner PATCHes amount_paid directly:                         refused
--   6 Owner lowers amount below amount_paid:                      refused
--   7 insert without amount_paid:                                 amount_paid = amount; 1 'at_recording' row
--   8 owner of another business records a payment:                refused "not found"
--   9 anon executes the function / reads expense_payments:        permission denied
--  10 existing expenses: every row amount_paid = amount, one 'before_history' row each

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.expenses add column if not exists amount_paid numeric(14,2);
alter table public.expenses add column if not exists payment_method text;

-- Every expense recorded so far was money already spent.
update public.expenses set amount_paid = coalesce(amount, 0) where amount_paid is null;

alter table public.expenses alter column amount_paid set not null;
alter table public.expenses drop constraint if exists expenses_amount_paid_range;
alter table public.expenses add constraint expenses_amount_paid_range
  check (amount_paid >= 0 and amount_paid <= coalesce(amount, 0)) not valid;
alter table public.expenses validate constraint expenses_amount_paid_range;
alter table public.expenses drop constraint if exists expenses_payment_method_valid;
alter table public.expenses add constraint expenses_payment_method_valid
  check (payment_method is null or payment_method in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other'));

-- ── 2. History ─────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.expense_payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  expense_id    uuid not null references public.expenses(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null default 'Cash' check (method in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other')),
  kind          text not null default 'payment' check (kind in ('payment', 'at_recording', 'before_history')),
  paid_on       date not null default current_date,
  note          text check (note is null or length(note) <= 300),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  recorded_by   uuid,
  staff_name    text check (staff_name is null or length(staff_name) <= 120),
  created_at    timestamptz not null default now()
);
create index if not exists expense_payments_expense_idx on public.expense_payments (expense_id, created_at desc);
create index if not exists expense_payments_business_idx on public.expense_payments (business_id, paid_on desc);

alter table public.expense_payments enable row level security;
drop policy if exists "expense payments of own business" on public.expense_payments;
create policy "expense payments of own business" on public.expense_payments for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.expense_payments from public, anon, authenticated;
grant select on public.expense_payments to authenticated;
grant all on public.expense_payments to service_role;

-- ── 3. Defaults and the first history row on insert ───────────────────────────────────────────────────────────
create or replace function public.expense_payment_defaults() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- An app build from before this change sends no amount_paid: the expense is paid in full, as it always was.
  if new.amount_paid is null then new.amount_paid := coalesce(new.amount, 0); end if;
  if new.amount_paid > 0 and new.payment_method is null then new.payment_method := 'Cash'; end if;
  return new;
end $$;

drop trigger if exists expenses_payment_defaults on public.expenses;
create trigger expenses_payment_defaults before insert on public.expenses
  for each row execute function public.expense_payment_defaults();

create or replace function public.expense_payment_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.amount_paid > 0 then
    insert into public.expense_payments (business_id, expense_id, amount, method, kind, paid_on, balance_after, recorded_by, staff_name)
    values (new.business_id, new.id, new.amount_paid, coalesce(new.payment_method, 'Cash'), 'at_recording',
            coalesce(public.expense_effective_date(new.date, coalesce(new.created_at, now()::timestamp)), current_date),
            greatest(coalesce(new.amount, 0) - new.amount_paid, 0), auth.uid(), left(nullif(btrim(new.staff_name), ''), 120));
  end if;
  return null;
end $$;
revoke all on function public.expense_payment_history() from public, anon, authenticated;

drop trigger if exists expenses_payment_history on public.expenses;
create trigger expenses_payment_history after insert on public.expenses
  for each row execute function public.expense_payment_history();

-- ── 4. amount_paid moves only through record_expense_payment ──────────────────────────────────────────────────
create or replace function public.expense_payment_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.amount_paid is distinct from old.amount_paid
     and coalesce(current_setting('carehub.expense_payment', true), '') <> 'on' then
    raise exception 'Record a payment on an expense with Record payment; the amount paid cannot be edited directly.'
      using errcode = '42501';
  end if;
  if coalesce(new.amount, 0) < new.amount_paid then
    raise exception 'An expense cannot be less than what has already been paid on it (%).', new.amount_paid
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists expenses_payment_guard on public.expenses;
create trigger expenses_payment_guard before update on public.expenses
  for each row execute function public.expense_payment_guard();

-- ── 5. Record a payment on an expense ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_expense_payment(
  p_expense_id uuid,
  p_amount numeric,
  p_method text default 'Cash',
  p_paid_on date default null,
  p_note text default null,
  p_staff_name text default null
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e         public.expenses%rowtype;
  v_amount  numeric(14,2);
  v_balance numeric(14,2);
  v_method  text := coalesce(nullif(btrim(p_method), ''), 'Cash');
begin
  if auth.uid() is null then raise exception 'Sign in to record a payment.' using errcode = '42501'; end if;

  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not (e.business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'That expense was not found.' using errcode = 'P0002';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  v_balance := coalesce(e.amount, 0) - e.amount_paid;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.' using errcode = '22023'; end if;
  if v_balance <= 0 then raise exception 'This expense is already paid in full.' using errcode = '22023'; end if;
  if v_amount > v_balance then
    raise exception 'That is more than the % still owed on this expense.', to_char(v_balance, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if v_method not in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other') then
    raise exception 'Choose how it was paid: Cash, Transfer, POS, Cheque or Other.' using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  perform set_config('carehub.expense_payment', 'on', true);
  update public.expenses set amount_paid = amount_paid + v_amount where id = e.id;
  perform set_config('carehub.expense_payment', 'off', true);

  insert into public.expense_payments (business_id, expense_id, amount, method, kind, paid_on, note, balance_after, recorded_by, staff_name)
  values (e.business_id, e.id, v_amount, v_method, 'payment', coalesce(p_paid_on, current_date),
          nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_balance - v_amount, auth.uid(),
          nullif(left(btrim(coalesce(p_staff_name, '')), 120), ''));

  return json_build_object('expense_id', e.id, 'amount', e.amount, 'amount_paid', e.amount_paid + v_amount,
                           'balance', v_balance - v_amount);
end $$;

revoke all on function public.record_expense_payment(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.record_expense_payment(uuid, numeric, text, date, text, text) to authenticated;

-- ── 6. History for the expenses recorded before this change ───────────────────────────────────────────────────
insert into public.expense_payments (business_id, expense_id, amount, method, kind, paid_on, note, balance_after, staff_name)
select x.business_id, x.id, x.amount_paid, 'Other', 'before_history',
       coalesce(public.expense_effective_date(x.date, x.created_at), current_date),
       'Recorded before payment history', 0, left(nullif(btrim(x.staff_name), ''), 120)
from public.expenses x
where x.amount_paid > 0
  and not exists (select 1 from public.expense_payments p where p.expense_id = x.id);
