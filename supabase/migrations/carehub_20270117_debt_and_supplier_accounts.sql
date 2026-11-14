-- carehub_20270117_debt_and_supplier_accounts
--
-- Status: NOT APPLIED. Written 2026-11-14 against the live schema read that day (read-only): debts, clients,
-- purchases, purchase_payments, sales, sale_payments columns; the debts / clients / purchases policies, grants and
-- triggers; the live bodies of record_sale_payment, record_purchase_payment, purchases_guard_direct_write,
-- record_export_audit, member_can_delete, stamp_recorded_by, keep_recorded_by; delete_debts and
-- restore_deleted_debts as applied from carehub_20270113_debt_bulk_delete. Tested on PGlite
-- (apps/carefind/src/test/debts/debtAccounts.db.test.js). Apply only with the owner's approval, then record the
-- version and the live probe below here.
-- Live data on 2026-11-14: 91 debts (44 credit_sale, 44 purchase, 3 manual: 2 owes_us, 1 we_owe), 27 credit sales
-- (26 open, 2 without a client link), 50 purchases (23 open), one pair of clients sharing a name, no suppliers table
-- (suppliers are identified by lower(btrim(supplier_name)), as get_supplier_balances has always done).
--
-- PROBLEM
-- -------
--  1. A debt recorded by hand had no payment history: "Mark paid" overwrote amount_paid / balance in one PATCH, a
--     part payment could not be recorded at all, and nothing said when, how or by whom it was paid.
--  2. Debts could not be imported or exported, and nothing linked an imported party to an existing customer or
--     supplier, so an import would have created duplicate customers (or unlinked names).
--  3. A supplier's account was only the sum of its purchases. Supplies owed without a product purchase (an opening
--     balance, an old invoice) had nowhere to go except a "we owe" debt that the supplier totals never counted, and a
--     payment to a supplier had to be split by hand across that supplier's purchases.
--  4. A customer with several credit sales was paid sale by sale; a payment on the account as a whole had to be split
--     by hand, one request per sale, with nothing to stop half of it being recorded if the connection dropped.
--
-- FIX
-- ---
--  A. public.debt_payments: one row per payment on a hand-recorded debt, append-only (the purchase_payments /
--     expense_payments design). The amount paid when a debt is recorded becomes its first row ('at_recording');
--     existing hand-recorded debts get one 'before_history' row, so every debt's history adds up to amount_paid.
--     Sale and purchase debts keep their own ledgers (sale_payments, purchase_payments), which already move them.
--  B. Hand-recorded debts keep amount, amount_paid, balance and status consistent: a BEFORE INSERT trigger derives
--     balance and status from amount and amount_paid and refuses impossible values; a BEFORE UPDATE trigger refuses
--     any change to those four columns except through record_debt_payment (members hold table-wide UPDATE today, so a
--     column grant could not do this). Debts from a sale or a purchase are not touched by either trigger.
--  C. record_debt_payment(debt, amount, method, paid_on, note, staff_name): a full or part payment on a hand-recorded
--     debt, in one transaction with its history row. A sale or purchase debt is refused with where to pay it.
--  D. delete_debts / restore_deleted_debts keep a deleted debt's payment history with the copy and put it back on
--     restore (deleted_debts.payments), so a restore never loses or invents a payment.
--  E. Supplier accounts: get_supplier_accounts(business) = every supplier's purchases plus its hand-recorded / imported
--     "we owe" debts (supply records without products), grouped by the existing key, with supplied, paid and owed and
--     a count of items whose figures do not add up (so a summary that would not reconcile is visible, never hidden).
--     get_supplier_activity(business, key) = that supplier's supplies and every payment. Debts raised BY a purchase
--     are excluded (they mirror the purchase; counting both would double the amount owed).
--  F. record_supplier_payment(business, key, amount, ...): one payment to a supplier, applied to its open purchases
--     and supply records oldest first through record_purchase_payment / record_debt_payment (so each item's own
--     ledger, its debt and its balance move exactly as a payment on that item would), all or nothing. Each resulting
--     history row carries the same allocation_id, so the payment can be traced as one payment and per item.
--  G. record_customer_payment(business, sale_ids, amount, method): one payment on a customer's account, applied to
--     the given open credit sales oldest first through record_sale_payment (the POS ledger: cashier, shift, sale and
--     debt), all or nothing.
--  H. import_debts(business, direction, rows, dry_run, allow_duplicates): Excel/CSV rows already parsed by the app.
--     Each row is a debt (amount owed, optionally part paid) or a payment (amount paid only). The party is matched to
--     an existing customer (by phone, then by name) or supplier (by name, the supplier key); when none exists a
--     customer profile is created, or the supplier account starts with this record. Matching happens in the
--     database under a per-business lock, so two imports cannot create the same customer twice. A dry run executes
--     every row exactly as the real import would and then rolls back, so the preview is the same code path.
--     Duplicates (same reference, an exported CareHub reference, or same party/amount/description/due date/date) are
--     skipped unless asked. Audited ('debts.imported').
--  I. record_export_audit learns debts.*, supplier_accounts.* and credit_accounts.* (xlsx / csv).
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. Who may record a payment, import or export is who may already write debts / record
--     purchase and sale payments / export: a member of the business (debts RLS: business_id IN current_business_ids()
--     or a platform admin); exports keep record_export_audit's Owner / canExportReports rule.
--   * Every new function that writes is SECURITY DEFINER with search_path public, pg_temp, checks the caller's
--     business first and answers "not found" to anyone else (no existence leak). EXECUTE: authenticated only (anon
--     revoked explicitly; Supabase grants it on creation). The two read functions are SECURITY INVOKER, so RLS decides
--     what they return.
--   * debt_payments: RLS on; members SELECT their business's rows; no client INSERT / UPDATE / DELETE; anon nothing.
--     recorded_by is auth.uid() (trusted); staff_name is display text from the app.
--   * The debts guard closes a gap: before, any member could rewrite a hand-recorded debt's amounts with no trace.
--   * import_debts creates clients rows. Members can already insert clients directly; the function only adds the
--     duplicate check. It never stores a phone number shorter than 7 digits (they are not used to match).
--   * Not changed here, recorded for the audit: anon holds table grants on debts (RLS denies every row to it).
--
-- ROLLBACK
--   drop function public.import_debts(uuid, text, jsonb, boolean, boolean); drop function public.phone_match_key(text);
--   drop function public.record_customer_payment(uuid, uuid[], numeric, text);
--   drop function public.record_supplier_payment(uuid, text, numeric, text, date, text, text);
--   drop function public.get_supplier_activity(uuid, text); drop function public.get_supplier_accounts(uuid);
--   drop function public.record_debt_payment(uuid, numeric, text, date, text, text);
--   drop trigger debts_manual_defaults on public.debts; drop trigger debts_manual_guard on public.debts;
--   drop trigger debts_manual_history on public.debts;
--   drop function public.debt_manual_defaults(), public.debt_manual_guard(), public.debt_manual_history();
--   re-run delete_debts / restore_deleted_debts from carehub_20270113_debt_bulk_delete.sql;
--   re-run record_export_audit with the previous allow-list ('inventory.xlsx','sales_report.xlsx','purchases.xlsx',
--   'purchases.csv');
--   alter table public.deleted_debts drop column payments; alter table public.purchase_payments drop column allocation_id;
--   drop table public.debt_payments;
--   (The app falls back to the previous behaviour when these functions are missing.)
--
-- PROBE AFTER APPLYING (DO block that raises at the end, so nothing remains), as a real Owner, one of their active
-- staff, the owner of another business and anon:
--   1 the 3 existing hand-recorded debts: one 'before_history' row each where amount_paid > 0, sums equal amount_paid
--   2 Owner records a 10,000 receivable with 0 paid; pays 4,000 (Cash) then 6,000: amount_paid 10,000, status paid,
--     two 'payment' rows, balance_after 6,000 then 0; a further 1 refused "already paid in full"
--   3 Owner PATCHes amount_paid / balance / status of a hand-recorded debt directly: refused (guard)
--   4 record_debt_payment on a credit-sale debt: refused, names the sale
--   5 delete the debt from 2, restore it: same 3 payment rows (ids), no 'at_recording' row invented
--   6 get_supplier_accounts: every supplier's balance equals the sum of its open purchases plus its hand-recorded
--     "we owe" debts; mismatch_count 0
--   7 record_supplier_payment on a supplier with two open purchases, amount covering the first and part of the second:
--     two purchase_payments rows with one allocation_id; purchases and their debts move; more than owed refused
--   8 record_customer_payment over two open credit sales: two sale_payments 'collection' rows, sales and debts move;
--     more than owed refused; a sale of another business refused
--   9 import_debts dry run with a new customer, an existing customer by phone and by name, a new and an existing
--     supplier, a duplicate and a bad row: statuses as expected; nothing persisted (clients and debts counts unchanged)
--  10 another business / anon: every function refused (not found / permission denied); debt_payments 0 rows
-- Security advisor afterwards: expected new items for the five SECURITY DEFINER functions executable by
-- authenticated (record_debt_payment, record_supplier_payment, record_customer_payment, import_debts), each checking
-- the caller's business first.

-- ── A. Payment history for hand-recorded debts ───────────────────────────────────────────────────────────────────
create table if not exists public.debt_payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  debt_id       uuid not null references public.debts(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null default 'Cash' check (method in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other')),
  kind          text not null default 'payment' check (kind in ('payment', 'at_recording', 'before_history')),
  paid_on       date not null default current_date,
  note          text check (note is null or length(note) <= 300),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  allocation_id uuid,
  recorded_by   uuid,
  staff_name    text check (staff_name is null or length(staff_name) <= 120),
  created_at    timestamptz not null default now()
);
create index if not exists debt_payments_debt_idx on public.debt_payments (debt_id, created_at desc);
create index if not exists debt_payments_business_idx on public.debt_payments (business_id, paid_on desc);
create index if not exists debt_payments_allocation_idx on public.debt_payments (allocation_id) where allocation_id is not null;

alter table public.debt_payments enable row level security;
drop policy if exists "debt payments of own business" on public.debt_payments;
create policy "debt payments of own business" on public.debt_payments for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.debt_payments from public, anon, authenticated;
grant select on public.debt_payments to authenticated;
grant all on public.debt_payments to service_role;

-- One supplier payment spread over several purchases is traced by the id its rows share.
alter table public.purchase_payments add column if not exists allocation_id uuid;
create index if not exists purchase_payments_allocation_idx on public.purchase_payments (allocation_id) where allocation_id is not null;

-- ── B. Hand-recorded debts stay consistent ───────────────────────────────────────────────────────────────────────
create or replace function public.debt_manual_defaults() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.source, 'manual') <> 'manual' or coalesce(current_setting('carehub.debt_restore', true), '') = 'on' then
    return new;
  end if;
  if new.direction is null or new.direction not in ('owes_us', 'we_owe') then
    raise exception 'A debt is either owed to the business (owes_us) or owed by it (we_owe).' using errcode = '23514';
  end if;
  new.amount := round(coalesce(new.amount, 0), 2);
  new.amount_paid := round(coalesce(new.amount_paid, 0), 2);
  if new.amount < 0 or new.amount_paid < 0 then
    raise exception 'Amounts cannot be negative.' using errcode = '23514';
  end if;
  if new.amount_paid > new.amount then
    raise exception 'The amount paid (%) is more than the amount owed (%).', new.amount_paid, new.amount using errcode = '23514';
  end if;
  new.balance := new.amount - new.amount_paid;
  new.status := case when new.balance <= 0 then 'paid' else 'pending' end;
  new.source := 'manual';
  return new;
end $$;

drop trigger if exists debts_manual_defaults on public.debts;
create trigger debts_manual_defaults before insert on public.debts
  for each row execute function public.debt_manual_defaults();

create or replace function public.debt_manual_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.source, 'manual') = 'manual' and coalesce(new.amount_paid, 0) > 0
     and coalesce(current_setting('carehub.debt_restore', true), '') <> 'on' then
    insert into public.debt_payments (business_id, debt_id, amount, method, kind, paid_on, note, balance_after, recorded_by)
    values (new.business_id, new.id, round(new.amount_paid, 2), 'Other', 'at_recording',
            coalesce(new.created_at::date, current_date), 'Paid when the debt was recorded',
            greatest(round(coalesce(new.balance, 0), 2), 0), auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.debt_manual_history() from public, anon, authenticated;

drop trigger if exists debts_manual_history on public.debts;
create trigger debts_manual_history after insert on public.debts
  for each row execute function public.debt_manual_history();

create or replace function public.debt_manual_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (coalesce(old.source, 'manual') = 'manual' or coalesce(new.source, 'manual') = 'manual')
     and (new.amount is distinct from old.amount or new.amount_paid is distinct from old.amount_paid
          or new.balance is distinct from old.balance or new.status is distinct from old.status
          or coalesce(new.source, 'manual') is distinct from coalesce(old.source, 'manual'))
     and coalesce(current_setting('carehub.debt_payment', true), '') <> 'on' then
    raise exception 'Record a payment on a debt with Record payment; its amounts cannot be edited directly.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists debts_manual_guard on public.debts;
create trigger debts_manual_guard before update on public.debts
  for each row execute function public.debt_manual_guard();

-- ── C. Record a payment on a hand-recorded debt ──────────────────────────────────────────────────────────────────
create or replace function public.record_debt_payment(
  p_debt_id uuid,
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
  d         public.debts%rowtype;
  v_amount  numeric(14,2);
  v_balance numeric(14,2);
  v_after   numeric(14,2);
  v_method  text := coalesce(nullif(btrim(p_method), ''), 'Cash');
  v_id      uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to record a payment.' using errcode = '42501'; end if;

  select * into d from public.debts where id = p_debt_id for update;
  if not found or not (d.business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'That debt was not found.' using errcode = 'P0002';
  end if;
  if coalesce(d.source, 'manual') = 'credit_sale' then
    raise exception 'This debt belongs to credit sale %: record the payment against the sale (POS › Credit), so the till and the sale move with it.', d.source_ref using errcode = '22023';
  end if;
  if coalesce(d.source, 'manual') = 'purchase' then
    raise exception 'This debt belongs to a purchase: record the payment on the purchase (Purchases › Suppliers), so the purchase moves with it.' using errcode = '22023';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  v_balance := greatest(round(coalesce(d.amount, 0) - coalesce(d.amount_paid, 0), 2), 0);
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.' using errcode = '22023'; end if;
  if v_balance <= 0 then raise exception 'This debt is already paid in full.' using errcode = '22023'; end if;
  if v_amount > v_balance then
    raise exception 'That is more than the % still owed on this debt.', to_char(v_balance, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  if v_method not in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other') then
    raise exception 'Choose how it was paid: Cash, Transfer, POS, Cheque or Other.' using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  v_after := v_balance - v_amount;
  perform set_config('carehub.debt_payment', 'on', true);
  update public.debts
     set amount_paid = round(coalesce(amount_paid, 0) + v_amount, 2),
         balance = v_after,
         status = case when v_after <= 0 then 'paid' else 'pending' end
   where id = d.id;
  perform set_config('carehub.debt_payment', 'off', true);

  insert into public.debt_payments (business_id, debt_id, amount, method, kind, paid_on, note, balance_after, recorded_by, staff_name)
  values (d.business_id, d.id, v_amount, v_method, 'payment', coalesce(p_paid_on, current_date),
          nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_after, auth.uid(),
          nullif(left(btrim(coalesce(p_staff_name, '')), 120), ''))
  returning id into v_id;

  return json_build_object('payment_id', v_id, 'debt_id', d.id, 'amount', v_amount,
                           'amount_paid', round(coalesce(d.amount_paid, 0) + v_amount, 2), 'balance', v_after,
                           'status', case when v_after <= 0 then 'paid' else 'pending' end);
end $$;

revoke all on function public.record_debt_payment(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.record_debt_payment(uuid, numeric, text, date, text, text) to authenticated;

-- History for hand-recorded debts paid before this change.
insert into public.debt_payments (business_id, debt_id, amount, method, kind, paid_on, note, balance_after)
select d.business_id, d.id, round(d.amount_paid, 2), 'Other', 'before_history', coalesce(d.created_at::date, current_date),
       'Paid before payment history was kept', greatest(round(coalesce(d.balance, 0), 2), 0)
  from public.debts d
 where coalesce(d.source, 'manual') = 'manual' and d.business_id is not null and coalesce(d.amount_paid, 0) > 0
   and not exists (select 1 from public.debt_payments x where x.debt_id = d.id);

-- ── D. Bulk delete / restore keep the payment history ────────────────────────────────────────────────────────────
alter table public.deleted_debts add column if not exists payments jsonb not null default '[]';

-- delete_debts as applied in carehub_20270113_debt_bulk_delete, plus: the deleted debts' payments are copied.
create or replace function public.delete_debts(p_business_id uuid, p_debt_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target     uuid[];
  v_requested  int;
  v_deletion   uuid := gen_random_uuid();
  v_actor_name text;
  v_kept       jsonb;
  v_deletable  uuid[];
  v_deleted    int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can delete debts' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_debt_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one debt' using errcode = '22023';
  end if;
  if v_requested > 5000 then
    raise exception 'DELETE_TOO_MANY: delete at most 5,000 debts at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_target
    from (select id from public.debts where business_id = p_business_id and id = any (v_target) order by id for update) l;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', coalesce(nullif(d.party_name, ''), 'Unnamed'),
                                               'reasons', jsonb_build_array(d.source), 'ref', d.source_ref) order by d.party_name, d.id)
                    filter (where coalesce(d.source, 'manual') <> 'manual'), '[]'),
         coalesce(array_agg(d.id) filter (where coalesce(d.source, 'manual') = 'manual'), '{}')
    into v_kept, v_deletable
    from public.debts d where d.id = any (v_target);

  if cardinality(v_deletable) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    insert into public.deleted_debts (deletion_id, business_id, debt_id, party_name, debt, payments, deleted_by, deleted_by_name)
    select v_deletion, d.business_id, d.id, d.party_name, to_jsonb(d),
           coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from public.debt_payments p where p.debt_id = d.id), '[]'),
           auth.uid(), v_actor_name
      from public.debts d where d.id = any (v_deletable);

    delete from public.debts where id = any (v_deletable);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'debts.deleted', 'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'requested', v_requested,
                               'outstanding', (select coalesce(sum(greatest((debt ->> 'balance')::numeric, 0)), 0) from public.deleted_debts where deletion_id = v_deletion)));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

revoke all on function public.delete_debts(uuid, uuid[]) from public, anon;
grant execute on function public.delete_debts(uuid, uuid[]) to authenticated;

-- restore_deleted_debts as applied in carehub_20270113_debt_bulk_delete, plus: the debt goes back exactly as it was
-- (no derived values, no invented "at recording" payment) and its payment rows go back with their ids.
create or replace function public.restore_deleted_debts(p_business_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_claims   text := current_setting('request.jwt.claims', true);
  v_actor    uuid := auth.uid();
  v_owner    boolean;
  v_debt     jsonb;
  v_restored int := 0;
  v_skipped_back int := 0;
  v_unlinked int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can restore debts' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_debts where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;
  v_owner := public.is_business_owner(p_business_id);

  for r in
    select d.id, d.debt_id, d.debt, d.payments
      from public.deleted_debts d
     where d.business_id = p_business_id and d.deletion_id = p_deletion_id and d.restored_at is null
     order by d.party_name, d.id
     for update
  loop
    if exists (select 1 from public.debts where id = r.debt_id) then
      v_skipped_back := v_skipped_back + 1;
      continue;
    end if;
    v_debt := r.debt;
    if nullif(v_debt ->> 'client_id', '') is not null
       and not exists (select 1 from public.clients c where c.id = (v_debt ->> 'client_id')::uuid) then
      v_debt := v_debt || jsonb_build_object('client_id', null);
      v_unlinked := v_unlinked + 1;
    end if;

    perform set_config('request.jwt.claims', '', true);
    perform set_config('carehub.debt_restore', 'on', true);
    insert into public.debts select (jsonb_populate_record(null::public.debts, v_debt)).*;
    perform set_config('carehub.debt_restore', 'off', true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

    insert into public.debt_payments
    select (jsonb_populate_record(null::public.debt_payments, p)).* from jsonb_array_elements(coalesce(r.payments, '[]')) p
    on conflict (id) do nothing;

    update public.deleted_debts set restored_at = now(), restored_by = v_actor where id = r.id;
    v_restored := v_restored + 1;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (v_actor, case when v_owner then 'owner' else 'staff' end, p_business_id, 'debts.restored', 'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'client_unlinked', v_unlinked));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'client_unlinked', v_unlinked);
end $$;

revoke all on function public.restore_deleted_debts(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_debts(uuid, uuid) to authenticated;

-- ── E. Supplier accounts ─────────────────────────────────────────────────────────────────────────────────────────
-- Purchases plus hand-recorded / imported "we owe" debts, per supplier key. SECURITY INVOKER: RLS decides the rows.
create or replace function public.get_supplier_accounts(p_business_id uuid)
returns table (supplier_key text, supplier_name text, purchase_count bigint, supply_count bigint, supplied_total numeric,
               paid_total numeric, balance numeric, open_count bigint, mismatch_count bigint, last_supply_at timestamp)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with items as (
    select lower(btrim(coalesce(p.supplier_name, ''))) as k, nullif(btrim(p.supplier_name), '') as name, true as is_purchase,
           round(coalesce(p.total_cost, 0), 2) as supplied, round(coalesce(p.amount_paid, 0), 2) as paid,
           round(greatest(coalesce(p.balance, 0), 0), 2) as bal, p.created_at as at
      from public.purchases p
     where p.business_id = p_business_id
    union all
    select lower(btrim(coalesce(d.party_name, ''))), nullif(btrim(d.party_name), ''), false,
           round(coalesce(d.amount, 0), 2), round(coalesce(d.amount_paid, 0), 2), round(greatest(coalesce(d.balance, 0), 0), 2), d.created_at
      from public.debts d
     where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
  )
  select k,
         coalesce((array_agg(name order by at desc nulls last) filter (where name is not null))[1], 'No supplier name'),
         count(*) filter (where is_purchase),
         count(*) filter (where not is_purchase),
         coalesce(sum(supplied), 0), coalesce(sum(paid), 0), coalesce(sum(bal), 0),
         count(*) filter (where bal > 0),
         count(*) filter (where abs(supplied - paid - bal) > 0.005),
         max(at)
    from items
   group by k
   order by coalesce(sum(bal), 0) desc, 2
$$;

-- One supplier: what it supplied (purchases and supply records) and every payment, newest first.
create or replace function public.get_supplier_activity(p_business_id uuid, p_supplier_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'supplies', coalesce((
      select jsonb_agg(s order by s.created_at desc, s.id) from (
        select 'purchase' as kind, p.id, p.supplier_name as party_name, p.supply_date as date, p.created_at,
               coalesce(nullif(p.product_name, ''), 'Purchase') as description,
               case when jsonb_typeof(p.items) = 'array' then jsonb_array_length(p.items) else null end as lines,
               round(coalesce(p.total_cost, 0), 2) as amount, round(coalesce(p.amount_paid, 0), 2) as paid,
               round(greatest(coalesce(p.balance, 0), 0), 2) as balance, p.due_date, p.status, null::text as ref
          from public.purchases p
         where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = lower(btrim(coalesce(p_supplier_key, '')))
        union all
        select 'supply', d.id, d.party_name, d.created_at::date::text, d.created_at,
               coalesce(nullif(d.description, ''), 'Supply record'), null,
               round(coalesce(d.amount, 0), 2), round(coalesce(d.amount_paid, 0), 2), round(greatest(coalesce(d.balance, 0), 0), 2),
               d.due_date, d.status, nullif(d.source_ref, '')
          from public.debts d
         where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
           and lower(btrim(coalesce(d.party_name, ''))) = lower(btrim(coalesce(p_supplier_key, '')))
      ) s), '[]'),
    'payments', coalesce((
      select jsonb_agg(x order by x.paid_on desc, x.created_at desc, x.id) from (
        select 'purchase' as source, pp.id, pp.purchase_id as item_id, pp.amount, pp.method, pp.kind, pp.paid_on, pp.note,
               pp.balance_after, pp.staff_name, pp.allocation_id, pp.created_at
          from public.purchase_payments pp
          join public.purchases p on p.id = pp.purchase_id
         where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = lower(btrim(coalesce(p_supplier_key, '')))
        union all
        select 'supply', dp.id, dp.debt_id, dp.amount, dp.method, dp.kind, dp.paid_on, dp.note,
               dp.balance_after, dp.staff_name, dp.allocation_id, dp.created_at
          from public.debt_payments dp
          join public.debts d on d.id = dp.debt_id
         where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
           and lower(btrim(coalesce(d.party_name, ''))) = lower(btrim(coalesce(p_supplier_key, '')))
      ) x), '[]'))
$$;

revoke all on function public.get_supplier_accounts(uuid) from public, anon;
revoke all on function public.get_supplier_activity(uuid, text) from public, anon;
grant execute on function public.get_supplier_accounts(uuid) to authenticated, service_role;
grant execute on function public.get_supplier_activity(uuid, text) to authenticated, service_role;

-- ── F. One payment to a supplier, oldest items first ─────────────────────────────────────────────────────────────
create or replace function public.record_supplier_payment(
  p_business_id uuid,
  p_supplier_key text,
  p_amount numeric,
  p_method text default 'Transfer',
  p_paid_on date default null,
  p_note text default null,
  p_staff_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key        text := lower(btrim(coalesce(p_supplier_key, '')));
  v_amount     numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_method     text := coalesce(nullif(btrim(p_method), ''), 'Transfer');
  v_note       text := coalesce(nullif(left(btrim(coalesce(p_note, '')), 300), ''), 'Supplier account payment');
  v_alloc      uuid := gen_random_uuid();
  v_owed       numeric(14,2);
  v_left       numeric(14,2);
  v_pay        numeric(14,2);
  v_result     json;
  v_allocs     jsonb := '[]';
  it           record;
begin
  if auth.uid() is null then raise exception 'Sign in to record a payment.' using errcode = '42501'; end if;
  if p_business_id is null or not (p_business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'Supplier not found.' using errcode = 'P0002';
  end if;
  if v_amount <= 0 then raise exception 'Enter an amount greater than zero.' using errcode = '22023'; end if;
  if v_method not in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other') then
    raise exception 'Choose how the supplier was paid.' using errcode = '22023';
  end if;
  if p_paid_on is not null and p_paid_on > current_date + 1 then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  -- Lock every open item first (purchases, then supply records), so the total cannot move underneath.
  perform 1 from public.purchases p
   where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = v_key and round(coalesce(p.balance, 0), 2) > 0
   order by p.id for update;
  perform 1 from public.debts d
   where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
     and lower(btrim(coalesce(d.party_name, ''))) = v_key and round(coalesce(d.balance, 0), 2) > 0
   order by d.id for update;

  select coalesce(sum(b), 0) into v_owed from (
    select round(greatest(coalesce(p.balance, 0), 0), 2) b from public.purchases p
     where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = v_key
    union all
    select round(greatest(coalesce(d.balance, 0), 0), 2) from public.debts d
     where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
       and lower(btrim(coalesce(d.party_name, ''))) = v_key
  ) t;
  if v_owed <= 0 then raise exception 'Nothing is owed to this supplier.' using errcode = '22023'; end if;
  if v_amount > v_owed then
    raise exception 'That is more than the % owed to this supplier.', to_char(v_owed, 'FM999,999,999,990.00') using errcode = '22023';
  end if;

  v_left := v_amount;
  for it in
    select * from (
      select 'purchase' as kind, p.id, round(greatest(coalesce(p.balance, 0), 0), 2) as bal, p.created_at as at
        from public.purchases p
       where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = v_key and round(coalesce(p.balance, 0), 2) > 0
      union all
      select 'supply', d.id, round(greatest(coalesce(d.balance, 0), 0), 2), d.created_at
        from public.debts d
       where d.business_id = p_business_id and d.direction = 'we_owe' and coalesce(d.source, 'manual') = 'manual'
         and lower(btrim(coalesce(d.party_name, ''))) = v_key and round(coalesce(d.balance, 0), 2) > 0
    ) o order by o.at nulls first, o.id
  loop
    exit when v_left <= 0;
    v_pay := least(v_left, it.bal);
    if it.kind = 'purchase' then
      v_result := public.record_purchase_payment(it.id, v_pay, v_method, p_paid_on, v_note, p_staff_name);
      update public.purchase_payments set allocation_id = v_alloc where id = (v_result ->> 'payment_id')::uuid;
    else
      v_result := public.record_debt_payment(it.id, v_pay, v_method, p_paid_on, v_note, p_staff_name);
      update public.debt_payments set allocation_id = v_alloc where id = (v_result ->> 'payment_id')::uuid;
    end if;
    v_allocs := v_allocs || jsonb_build_object('kind', it.kind, 'id', it.id, 'amount', v_pay, 'balance', (v_result ->> 'balance')::numeric);
    v_left := v_left - v_pay;
  end loop;

  return jsonb_build_object('allocation_id', v_alloc, 'amount', v_amount, 'allocations', v_allocs, 'balance', v_owed - v_amount);
end $$;

revoke all on function public.record_supplier_payment(uuid, text, numeric, text, date, text, text) from public, anon;
grant execute on function public.record_supplier_payment(uuid, text, numeric, text, date, text, text) to authenticated;

-- ── G. One payment on a customer's credit account, oldest sales first ────────────────────────────────────────────
create or replace function public.record_customer_payment(
  p_business_id uuid,
  p_sale_ids uuid[],
  p_amount numeric,
  p_method text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_ids    uuid[];
  v_owed   numeric(14,2);
  v_left   numeric(14,2);
  v_pay    numeric(14,2);
  v_result jsonb;
  v_allocs jsonb := '[]';
  s        record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_business_id is null or p_business_id not in (select public.current_business_ids()) then
    raise exception 'Customer account not found.' using errcode = 'P0002';
  end if;
  if p_method is null or p_method not in ('Cash', 'Transfer', 'POS') then
    raise exception 'Payment method must be Cash, Transfer or POS' using errcode = '22023';
  end if;
  if v_amount <= 0 then raise exception 'Amount must be more than zero' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_sale_ids, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) = 0 then raise exception 'Choose the credit sales to pay.' using errcode = '22023'; end if;
  if cardinality(v_ids) > 500 then raise exception 'An account payment covers at most 500 sales.' using errcode = '22023'; end if;

  perform 1 from public.sales where id = any (v_ids) and business_id = p_business_id order by id for update;

  select coalesce(sum(greatest(coalesce(total, 0) - least(coalesce(amount_paid, 0), coalesce(total, 0)), 0)), 0) into v_owed
    from public.sales
   where id = any (v_ids) and business_id = p_business_id and deleted_at is null
     and not coalesce(is_on_hold, false) and (status is null or status = 'completed');
  if v_owed <= 0 then raise exception 'Nothing is outstanding on this account.' using errcode = '22023'; end if;
  if v_amount > v_owed then
    raise exception 'That is more than the % outstanding on this account.', to_char(v_owed, 'FM999,999,999,990.00') using errcode = '22023';
  end if;

  v_left := v_amount;
  for s in
    select id, txn_no, greatest(coalesce(total, 0) - least(coalesce(amount_paid, 0), coalesce(total, 0)), 0) as owed
      from public.sales
     where id = any (v_ids) and business_id = p_business_id and deleted_at is null
       and not coalesce(is_on_hold, false) and (status is null or status = 'completed')
       and greatest(coalesce(total, 0) - least(coalesce(amount_paid, 0), coalesce(total, 0)), 0) > 0
     order by created_at nulls first, id
  loop
    exit when v_left <= 0;
    v_pay := least(v_left, round(s.owed, 2));
    v_result := public.record_sale_payment(s.id, v_pay, p_method);
    v_allocs := v_allocs || jsonb_build_object('sale_id', s.id, 'txn_no', s.txn_no, 'amount', (v_result ->> 'applied')::numeric,
                                               'balance', (v_result ->> 'balance')::numeric);
    v_left := v_left - (v_result ->> 'applied')::numeric;
  end loop;

  return jsonb_build_object('amount', v_amount - v_left, 'allocations', v_allocs, 'balance', v_owed - (v_amount - v_left));
end $$;

revoke all on function public.record_customer_payment(uuid, uuid[], numeric, text) from public, anon;
grant execute on function public.record_customer_payment(uuid, uuid[], numeric, text) to authenticated;

-- ── H. Import receivables or payables ────────────────────────────────────────────────────────────────────────────
-- The key two phone numbers are compared by: digits only, with Nigeria's +234 written as the leading 0, so
-- "+234 803 111 2222", "2348031112222" and "0803-111-2222" are one number. Internal: no client role may call it.
create or replace function public.phone_match_key(p_phone text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when d ~ '^234[0-9]{10}$' then '0' || substr(d, 4) else d end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function public.phone_match_key(text) from public, anon, authenticated;

-- ── H2. import_debts ────────────────────────────────────────────────────────────────────────────
-- p_rows: [{ row, party, phone, date, amount, paid, due_date, description, reference, method }] as parsed by the app
-- (debtImport.js): dates 'YYYY-MM-DD', numbers as numbers. Returns { dry_run, direction, summary, rows }.
create or replace function public.import_debts(
  p_business_id uuid,
  p_direction text,
  p_rows jsonb,
  p_dry_run boolean default true,
  p_allow_duplicates boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            jsonb;
  v_out        jsonb := '[]';
  v_row        int;
  v_party      text;
  v_key        text;
  v_phone      text;
  v_digits     text;
  v_date       date;
  v_due        text;
  v_amount     numeric(14,2);
  v_paid       numeric(14,2);
  v_desc       text;
  v_refin      text;
  v_ref        text;
  v_method     text;
  v_kind       text;
  v_client     uuid;
  v_name       text;
  v_match      text;
  v_note       text;
  v_count      int;
  v_debt       uuid;
  v_dup        boolean;
  v_left       numeric(14,2);
  v_owed       numeric(14,2);
  v_pay        numeric(14,2);
  v_status     text;
  v_res        jsonb;
  d            record;
  s_debts int := 0; s_payments int := 0; s_dups int := 0; s_errors int := 0; s_clients int := 0; s_suppliers int := 0;
  s_matched int := 0; s_amount numeric(14,2) := 0; s_paid numeric(14,2) := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to import.' using errcode = '42501'; end if;
  if p_business_id is null or not (p_business_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'Business not found.' using errcode = 'P0002';
  end if;
  if p_direction is null or p_direction not in ('owes_us', 'we_owe') then
    raise exception 'Choose receivables (owes_us) or payables (we_owe).' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'At most 2,000 rows per import. Split the file.' using errcode = '22023';
  end if;

  -- One import at a time per business, so the same new customer or supplier is never created twice.
  perform pg_advisory_xact_lock(hashtext('carehub.import_debts:' || p_business_id::text));

  begin
    for r in select value from jsonb_array_elements(p_rows)
    loop
      v_row := nullif(r ->> 'row', '')::int;
      v_party := null; v_match := null; v_client := null; v_debt := null; v_note := null; v_kind := null;
      v_amount := 0; v_paid := 0;
      begin
        v_party := regexp_replace(btrim(coalesce(r ->> 'party', '')), '\s+', ' ', 'g');
        if v_party = '' then raise exception 'The name is missing.'; end if;
        if length(v_party) > 200 then raise exception 'The name is too long (200 characters at most).'; end if;
        v_key := lower(v_party);
        v_phone := nullif(btrim(coalesce(r ->> 'phone', '')), '');
        v_digits := public.phone_match_key(v_phone);
        v_amount := round(coalesce(nullif(r ->> 'amount', '')::numeric, 0), 2);
        v_paid := round(coalesce(nullif(r ->> 'paid', '')::numeric, 0), 2);
        if v_amount < 0 or v_paid < 0 then raise exception 'Amounts cannot be negative.'; end if;
        v_date := nullif(r ->> 'date', '')::date;
        if v_date is not null and v_date > current_date + 1 then raise exception 'The date % is in the future.', v_date; end if;
        v_due := nullif(btrim(coalesce(r ->> 'due_date', '')), '');
        if v_due is not null then v_due := (v_due::date)::text; end if;
        v_desc := nullif(btrim(coalesce(r ->> 'description', '')), '');
        if length(coalesce(v_desc, '')) > 1000 then raise exception 'The description is too long (1,000 characters at most).'; end if;
        v_refin := nullif(btrim(coalesce(r ->> 'reference', '')), '');
        if length(coalesce(v_refin, '')) > 100 then raise exception 'The reference is too long (100 characters at most).'; end if;
        v_method := coalesce(nullif(btrim(coalesce(r ->> 'method', '')), ''), case when p_direction = 'we_owe' then 'Transfer' else 'Cash' end);
        if v_method not in ('Cash', 'Transfer', 'POS', 'Cheque', 'Other') then
          raise exception 'Payment method "%" is not one of Cash, Transfer, POS, Cheque, Other.', v_method;
        end if;

        if v_amount > 0 then
          v_kind := 'debt';
          if v_paid > v_amount then raise exception 'The amount paid (%) is more than the amount owed (%).', v_paid, v_amount; end if;
        elsif v_paid > 0 then
          v_kind := 'payment';
        else
          raise exception 'Enter the amount owed, or the amount paid for a payment.';
        end if;

        -- ── The party: an existing profile, or a new one ──
        if p_direction = 'owes_us' then
          if length(v_digits) >= 7 then
            select c.id, c.full_name into v_client, v_name from public.clients c
             where c.business_id = p_business_id and public.phone_match_key(c.phone) = v_digits
             order by c.created_at, c.id limit 1;
            if v_client is not null then v_match := 'phone'; end if;
          end if;
          if v_client is null then
            select count(*) into v_count from public.clients c
             where c.business_id = p_business_id and lower(regexp_replace(btrim(coalesce(c.full_name, '')), '\s+', ' ', 'g')) = v_key;
            if v_count > 0 then
              select c.id, c.full_name into v_client, v_name from public.clients c
               where c.business_id = p_business_id and lower(regexp_replace(btrim(coalesce(c.full_name, '')), '\s+', ' ', 'g')) = v_key
               order by c.created_at, c.id limit 1;
              v_match := 'name';
              if v_count > 1 then v_note := v_count || ' customers share this name; linked to the earliest. Add a phone number to choose.'; end if;
            end if;
          end if;
          if v_client is null then
            if v_kind = 'payment' then raise exception 'No customer named "%" to apply this payment to.', v_party; end if;
            insert into public.clients (business_id, full_name, phone)
            values (p_business_id, v_party, case when length(v_digits) >= 7 then v_phone end)
            returning id, full_name into v_client, v_name;
            v_match := 'created';
            s_clients := s_clients + 1;
          else
            s_matched := s_matched + 1;
          end if;
        else
          select n.name into v_name from (
            select btrim(p.supplier_name) as name, p.created_at as at from public.purchases p
             where p.business_id = p_business_id and lower(btrim(coalesce(p.supplier_name, ''))) = v_key
            union all
            select btrim(x.party_name), x.created_at from public.debts x
             where x.business_id = p_business_id and x.direction = 'we_owe' and coalesce(x.source, 'manual') = 'manual'
               and lower(btrim(coalesce(x.party_name, ''))) = v_key
          ) n order by n.at desc nulls last limit 1;
          if v_name is not null then
            v_match := 'name';
            s_matched := s_matched + 1;
          else
            if v_kind = 'payment' then raise exception 'No supplier named "%" to apply this payment to.', v_party; end if;
            v_name := v_party;
            v_match := 'created';
            s_suppliers := s_suppliers + 1;
          end if;
        end if;

        if v_kind = 'debt' then
          -- ── Already recorded? ──
          v_ref := case when v_refin is not null then 'import:' || lower(v_refin) else '' end;
          v_dup := false;
          if v_refin is not null then
            v_dup := exists (select 1 from public.debts x where x.business_id = p_business_id and x.direction = p_direction
                               and coalesce(x.source, 'manual') = 'manual' and x.source_ref = v_ref);
            -- A reference from a CareHub export (D-1A2B3C4D) names an existing debt.
            if not v_dup and v_refin ~* '^D-[0-9A-F]{8}$' then
              v_dup := exists (select 1 from public.debts x where x.business_id = p_business_id
                                 and replace(x.id::text, '-', '') like lower(substr(v_refin, 3)) || '%');
            end if;
          else
            v_dup := exists (select 1 from public.debts x where x.business_id = p_business_id and x.direction = p_direction
                               and coalesce(x.source, 'manual') = 'manual' and lower(btrim(coalesce(x.party_name, ''))) = lower(v_name)
                               and round(coalesce(x.amount, 0), 2) = v_amount and coalesce(x.description, '') = coalesce(v_desc, '')
                               and coalesce(x.due_date, '') = coalesce(v_due, '')
                               and (v_date is null or x.created_at::date = v_date));
          end if;
          if v_dup and not p_allow_duplicates then
            s_dups := s_dups + 1;
            v_out := v_out || jsonb_build_object('row', v_row, 'status', 'duplicate', 'kind', v_kind, 'party', v_name, 'matched_by', v_match,
                                                 'client_id', v_client, 'amount', v_amount, 'paid', v_paid,
                                                 'message', 'Already recorded; skipped.');
            continue;
          end if;

          insert into public.debts (business_id, client_id, direction, party_name, amount, amount_paid, balance, due_date, status,
                                    description, source, source_ref, created_at)
          values (p_business_id, v_client, p_direction, v_name, v_amount, v_paid, v_amount - v_paid, coalesce(v_due, ''),
                  case when v_paid >= v_amount then 'paid' else 'pending' end,
                  coalesce(v_desc, case when p_direction = 'we_owe' then 'Supply record (imported)' else 'Imported debt' end),
                  'manual', v_ref, coalesce(v_date::timestamp, now()::timestamp))
          returning id into v_debt;
          s_debts := s_debts + 1;
          s_amount := s_amount + v_amount;
          s_paid := s_paid + v_paid;
          v_status := 'ok';
        else
          -- ── A payment on the party's account (a reference makes a re-imported payment recognisable) ──
          if v_refin is not null and exists (
              select 1 from public.debt_payments x where x.business_id = p_business_id and x.note = 'Imported payment, ref ' || v_refin
              union all
              select 1 from public.purchase_payments x where x.business_id = p_business_id and x.note = 'Imported payment, ref ' || v_refin) then
            if not p_allow_duplicates then
              s_dups := s_dups + 1;
              v_out := v_out || jsonb_build_object('row', v_row, 'status', 'duplicate', 'kind', v_kind, 'party', v_name, 'matched_by', v_match,
                                                   'client_id', v_client, 'amount', 0, 'paid', v_paid, 'message', 'Already recorded; skipped.');
              continue;
            end if;
          end if;
          if p_direction = 'we_owe' then
            v_res := public.record_supplier_payment(p_business_id, v_name, v_paid, v_method, v_date,
                                                    coalesce('Imported payment, ref ' || v_refin, 'Imported payment'), null);
          else
            -- Customer payments apply to the customer's hand-recorded / imported debts. Credit sales are paid at the
            -- POS (Credit tab), where the money enters the till and the sales ledger.
            select coalesce(sum(greatest(round(coalesce(x.balance, 0), 2), 0)), 0) into v_owed from public.debts x
             where x.business_id = p_business_id and x.direction = 'owes_us' and coalesce(x.source, 'manual') = 'manual'
               and (x.client_id = v_client or (x.client_id is null and lower(btrim(coalesce(x.party_name, ''))) = lower(v_name)))
               and round(coalesce(x.balance, 0), 2) > 0;
            if v_paid > v_owed then
              raise exception 'The payment (%) is more than the % still owed on this customer''s recorded debts. Credit sales are paid at POS › Credit.',
                v_paid, v_owed;
            end if;
            v_left := v_paid;
            for d in
              select x.id, round(greatest(coalesce(x.balance, 0), 0), 2) as bal from public.debts x
               where x.business_id = p_business_id and x.direction = 'owes_us' and coalesce(x.source, 'manual') = 'manual'
                 and (x.client_id = v_client or (x.client_id is null and lower(btrim(coalesce(x.party_name, ''))) = lower(v_name)))
                 and round(coalesce(x.balance, 0), 2) > 0
               order by x.created_at nulls first, x.id
               for update
            loop
              exit when v_left <= 0;
              v_pay := least(v_left, d.bal);
              perform public.record_debt_payment(d.id, v_pay, v_method, v_date,
                                                 coalesce('Imported payment, ref ' || v_refin, 'Imported payment'), null);
              v_left := v_left - v_pay;
            end loop;
          end if;
          s_payments := s_payments + 1;
          s_paid := s_paid + v_paid;
          v_status := 'ok';
        end if;

        v_out := v_out || jsonb_build_object('row', v_row, 'status', v_status, 'kind', v_kind, 'party', v_name, 'matched_by', v_match,
                                             'client_id', v_client, 'debt_id', v_debt, 'amount', v_amount, 'paid', v_paid, 'note', v_note);
      exception when others then
        -- The row's own changes are rolled back (this block is a savepoint); the import goes on with the next row.
        s_errors := s_errors + 1;
        v_out := v_out || jsonb_build_object('row', v_row, 'status', 'error', 'kind', v_kind, 'party', nullif(v_party, ''),
                                             'amount', v_amount, 'paid', v_paid, 'message', sqlerrm);
      end;
    end loop;

    if not p_dry_run then
      insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
      values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
              'debts.imported', 'debts', null,
              jsonb_build_object('direction', p_direction, 'rows', jsonb_array_length(p_rows), 'debts', s_debts, 'payments', s_payments,
                                 'duplicates', s_dups, 'errors', s_errors, 'clients_created', s_clients, 'suppliers_created', s_suppliers,
                                 'amount', s_amount, 'paid', s_paid));
    else
      -- A dry run did everything for real; undo it all. Variables keep what was worked out.
      raise exception 'carehub dry run' using errcode = 'CH001';
    end if;
  exception when sqlstate 'CH001' then
    null;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'direction', p_direction,
    'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'debts', s_debts, 'payments', s_payments, 'duplicates', s_dups,
                                  'errors', s_errors, 'clients_created', s_clients, 'suppliers_created', s_suppliers, 'matched', s_matched,
                                  'amount', s_amount, 'paid', s_paid),
    'rows', v_out);
end $$;

revoke all on function public.import_debts(uuid, text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.import_debts(uuid, text, jsonb, boolean, boolean) to authenticated;

-- ── I. Export audit: debts, supplier accounts, credit accounts ───────────────────────────────────────────────────
-- record_export_audit as live on 2026-11-14 (carehub_20270115_purchase_export_audit), with six export types added.
-- Supplier accounts carry supply values (cost data); debts and credit accounts carry amounts owed, not costs.
CREATE OR REPLACE FUNCTION public.record_export_audit(p_business_id uuid, p_export_type text, p_row_count integer, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(auth.email());
  v_staff_id uuid;
  v_staff_role text;
  v_owner boolean;
  v_allowed boolean;
  v_perms jsonb;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business id is required' USING ERRCODE = '22023';
  END IF;
  IF p_export_type IS NULL OR p_export_type NOT IN ('inventory.xlsx', 'sales_report.xlsx', 'purchases.xlsx', 'purchases.csv',
       'debts.xlsx', 'debts.csv', 'supplier_accounts.xlsx', 'supplier_accounts.csv', 'credit_accounts.xlsx', 'credit_accounts.csv') THEN
    RAISE EXCEPTION 'Unknown export type' USING ERRCODE = '22023';
  END IF;
  IF p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION 'row count must be zero or more' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_filters) <> 'object' OR pg_column_size(v_filters) > 2000 THEN
    RAISE EXCEPTION 'filters must be a small JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT s.id, s.role INTO v_staff_id, v_staff_role
    FROM public.staff s
   WHERE s.business_id = p_business_id AND lower(s.email) = v_email AND s.status = 'active'
   LIMIT 1;

  WITH RECURSIVE up(id, parent_business_id, depth) AS (
    SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
    UNION
    SELECT p.id, p.parent_business_id, up.depth + 1
      FROM public.businesses p JOIN up ON p.id = up.parent_business_id
     WHERE up.depth < 10
  )
  SELECT EXISTS (
    SELECT 1 FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email
  ) INTO v_owner;

  IF NOT v_owner AND v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501';
  END IF;

  IF v_owner OR v_staff_role = 'Owner' THEN
    v_allowed := true;
  ELSE
    SELECT r.permissions INTO v_perms
      FROM public.roles r
     WHERE r.business_id = p_business_id AND r.name = v_staff_role
     LIMIT 1;
    v_allowed := COALESCE(v_perms -> 'canExportReports' = 'true'::jsonb, false);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Your role is not allowed to export data' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, metadata)
  VALUES (
    v_uid,
    CASE WHEN v_owner THEN 'owner' ELSE 'staff' END,
    p_business_id,
    'export.created',
    split_part(p_export_type, '.', 1),
    jsonb_build_object(
      'export_type', p_export_type,
      'row_count', p_row_count,
      'filters', v_filters,
      'includes_cost_data', p_export_type IN ('inventory.xlsx', 'purchases.xlsx', 'purchases.csv', 'supplier_accounts.xlsx', 'supplier_accounts.csv'),
      'actor_email', v_email,
      'staff_id', v_staff_id,
      'staff_role', v_staff_role)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
