-- Subscription billing history and receipts.
--
-- Docs: docs/architecture/Subscription-Billing.md
-- Depends on: carefind_20261007_commission_engine.sql (renew_business_plan, _record_referral_commission),
--   carehub_20261214_plan_enforcement.sql (plan_limit, plan_state, plan_grace_ends_at),
--   carehub_20261216_sales_owner_corrections.sql (is_business_owner), payment_intents.
--
-- Before this, a plan renewal left one row in plan_payments: months, naira amount and reference. It did not say which
-- plan was bought, which period it paid for, how it was paid, or Paystack's transaction id, and attempts that never
-- settled (abandoned, declined, awaiting confirmation) were visible only to platform staff in payment_intents. An owner
-- could not see what they had paid for, confirm a payment, or print a receipt.
--
--   1. plan_payments gains the receipt fields. renew_business_plan (the one writer, called by both the Paystack and
--      the wallet settlement) fills them in the same transaction that extends the plan, so a receipt always describes
--      exactly the renewal that happened. Every row gets a unique, sequential receipt number.
--   2. business_billing_overview(business_id) returns, for the Owner only: the plan state, limits and current usage,
--      every settled payment (the receipts), and recent attempts that did not settle.
--
-- Security:
--   * business_billing_overview is SECURITY DEFINER because payment_intents has no business-facing policy. It returns
--     NULL unless the caller is the Owner (is_business_owner) or a platform admin; staff, including managers, get
--     nothing. It reads only; it changes nothing.
--   * Billing is a parent-level concept (verifyBusiness renews the top-level business), so a branch id resolves to its
--     top-level business, and its payments are the ones returned.
--   * renew_business_plan keeps its signature, return shape, SECURITY DEFINER and grants; its only new behaviour is
--     writing the extra columns.
--   * No client may write plan_payments or the receipt fields: the existing grants are unchanged and the receipt
--     number is assigned by a trigger, not by the caller.
--
-- Rollback: drop function business_billing_overview(uuid); restore renew_business_plan from
--   carefind_20261007_commission_engine.sql; drop trigger plan_payments_assign_receipt; the added columns can stay
--   (nullable, unused by older code).

-- ── 1. Receipt fields ────────────────────────────────────────────────────────
alter table public.plan_payments
  add column if not exists plan text,
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists payment_method text,
  add column if not exists provider_transaction_id text,
  add column if not exists currency text not null default 'NGN',
  add column if not exists paid_at timestamptz,
  add column if not exists receipt_number text;

create sequence if not exists public.plan_receipt_seq;

-- CH-<year>-<6 digits>, e.g. CH-2026-000042. Assigned on insert whatever the writer, and never by the caller.
create or replace function public.plan_payments_assign_receipt()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.paid_at := coalesce(new.paid_at, new.created_at, now());
  new.receipt_number := 'CH-' || to_char(new.paid_at at time zone 'Africa/Lagos', 'YYYY') || '-'
                        || lpad(nextval('public.plan_receipt_seq')::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists plan_payments_assign_receipt on public.plan_payments;
create trigger plan_payments_assign_receipt
  before insert on public.plan_payments
  for each row execute function public.plan_payments_assign_receipt();

-- Backfill rows written before this migration, oldest first so numbers follow payment order. Their period was never
-- recorded, so it is shown as the months bought from the payment date: exact when the plan had lapsed at payment
-- time, an approximation when the payment extended a plan that was still running.
do $$
declare r record;
begin
  for r in select p.id, p.created_at from public.plan_payments p where p.receipt_number is null order by p.created_at, p.id loop
    update public.plan_payments
       set paid_at = coalesce(paid_at, created_at),
           receipt_number = 'CH-' || to_char(coalesce(paid_at, created_at) at time zone 'Africa/Lagos', 'YYYY') || '-'
                            || lpad(nextval('public.plan_receipt_seq')::text, 6, '0')
     where id = r.id;
  end loop;
end $$;

update public.plan_payments p
   set plan = coalesce(p.plan, i.metadata ->> 'plan'),
       payment_method = coalesce(p.payment_method, case when i.purpose = 'plan_renewal_wallet' then 'wallet' else i.provider end),
       provider_transaction_id = coalesce(p.provider_transaction_id, i.provider_transaction_id)
  from public.payment_intents i
 where i.reference = p.reference;

update public.plan_payments p
   set period_start = p.paid_at,
       period_end = p.paid_at + make_interval(months => p.months)
 where p.period_start is null;

create unique index if not exists plan_payments_receipt_number_key on public.plan_payments (receipt_number);
alter table public.plan_payments alter column receipt_number set not null;
alter table public.plan_payments alter column paid_at set not null;

-- ── 2. renew_business_plan writes the receipt ───────────────────────────────
-- Unchanged apart from the plan, period and payment details it now records.
create or replace function public.renew_business_plan(p_business_id uuid, p_months integer, p_naira_amount integer, p_reference text)
returns table(already_processed boolean, payment_id uuid, new_expiry timestamptz, is_first_payment boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count bigint;
  v_base timestamptz;
  v_plan text;
  v_new_expiry timestamptz;
  v_payment_id uuid;
  v_purpose text;
  v_provider text;
  v_txn text;
begin
  select plan_expires_at, coalesce(plan, 'basic') into v_base, v_plan from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'unknown business %', p_business_id using errcode = 'P0002';
  end if;

  if v_base is null or v_base < now() then
    v_base := now();
  end if;
  v_new_expiry := v_base + make_interval(months => p_months);

  -- The settlement that called us has already stamped the intent with Paystack's transaction id. No intent means a
  -- renewal recorded by platform staff.
  select i.purpose, i.provider, i.provider_transaction_id into v_purpose, v_provider, v_txn
    from public.payment_intents i where i.reference = p_reference;

  select count(*) into v_count from public.plan_payments where business_id = p_business_id;

  insert into public.plan_payments (business_id, months, naira_amount, reference, status, is_first_payment,
                                    plan, period_start, period_end, payment_method, provider_transaction_id, paid_at)
  values (p_business_id, p_months, p_naira_amount, p_reference, 'success', v_count = 0,
          v_plan, v_base, v_new_expiry,
          case when v_purpose = 'plan_renewal_wallet' then 'wallet' when v_purpose is not null then v_provider else 'manual' end,
          v_txn, now())
  on conflict (reference) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    return query select true, null::uuid, null::timestamptz, false;
    return;
  end if;

  update public.businesses set plan_expires_at = v_new_expiry where id = p_business_id;

  perform public._record_referral_commission(v_payment_id);

  return query select false, v_payment_id, v_new_expiry, v_count = 0;
end;
$function$;

-- ── 3. The Owner's billing overview ──────────────────────────────────────────
create or replace function public.business_billing_overview(p_business_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_root uuid;
  v_out json;
begin
  if p_business_id is null or not (public.is_business_owner(p_business_id) or public.is_platform_admin()) then
    return null;
  end if;

  with recursive up(id, parent_business_id, depth) as (
    select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
    union all
    select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10
  )
  select id into v_root from up where parent_business_id is null limit 1;
  v_root := coalesce(v_root, p_business_id);

  with recursive tree(id, depth) as (
    select v_root, 0
    union all
    select c.id, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id where t.depth < 10 and c.deleted_at is null
  )
  select json_build_object(
    'business', json_build_object('id', b.id, 'name', b.name, 'email', b.email, 'phone', b.phone,
                                  'address', b.address, 'city', b.city, 'state', b.state, 'logo_url', b.logo_url),
    'plan', coalesce(b.plan, 'basic'),
    'expires_at', b.plan_expires_at,
    'grace_ends_at', public.plan_grace_ends_at(b.plan_expires_at),
    'state', public.plan_state(b.plan_expires_at),
    'limits', json_build_object(
      'staff', public.plan_limit(b.plan, 'staff'),
      'locations', public.plan_limit(b.plan, 'locations'),
      'products', public.plan_limit(b.plan, 'products')),
    -- Counted the way the plan checks count them (staff_enforce_plan, products_enforce_plan, guard_business_insert),
    -- for the business being viewed; locations are the whole organisation.
    'usage', json_build_object(
      'staff', (select count(*) from public.staff s where s.business_id = p_business_id),
      'locations', (select count(*) from tree),
      'products', (select count(*) from public.products pr where pr.business_id = p_business_id)),
    'payments', coalesce((
      select json_agg(json_build_object(
               'id', pp.id, 'receipt_number', pp.receipt_number, 'reference', pp.reference, 'plan', pp.plan,
               'months', pp.months, 'amount', pp.naira_amount, 'currency', pp.currency,
               'payment_method', pp.payment_method, 'provider_transaction_id', pp.provider_transaction_id,
               'period_start', pp.period_start, 'period_end', pp.period_end, 'paid_at', pp.paid_at,
               'is_first_payment', pp.is_first_payment)
             order by pp.paid_at desc)
        from public.plan_payments pp
       where pp.business_id = v_root and pp.status = 'success'), '[]'::json),
    -- Attempts that did not (yet) become a payment, newest 50 of the last 180 days.
    'attempts', coalesce((
      select json_agg(a order by a.created_at desc) from (
        select i.reference, i.status, i.purpose, i.provider, i.expected_amount / 100 as amount, i.currency,
               (i.metadata ->> 'months')::int as months, i.metadata ->> 'plan' as plan,
               i.metadata ->> 'refund_reason' as refund_reason, i.created_at, i.updated_at
          from public.payment_intents i
         where i.business_id = v_root
           and i.purpose in ('plan_renewal', 'plan_renewal_wallet')
           and i.status <> 'settled'
           and not exists (select 1 from public.plan_payments pp where pp.reference = i.reference)
           and i.created_at > now() - interval '180 days'
         order by i.created_at desc
         limit 50) a), '[]'::json)
  ) into v_out
  from public.businesses b
  where b.id = v_root;

  return v_out;
end;
$$;

revoke all on function public.business_billing_overview(uuid) from public, anon;
grant execute on function public.business_billing_overview(uuid) to authenticated;
revoke all on function public.plan_payments_assign_receipt() from public, anon, authenticated;
