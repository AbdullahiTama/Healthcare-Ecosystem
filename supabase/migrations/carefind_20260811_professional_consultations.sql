-- ============================================================================
-- 2026-08-11 — CareFind professional consultations: booking table, RLS, and
--              atomic CareCoin payment
--
-- WHY THIS EXISTS
-- ---------------
-- CareFind professionals can set a consultation offer (type, fee, notes) and
-- see "incoming bookings", but a patient can never book: there is no
-- patient-facing UI, and the professional side writes to the SHARED
-- `consultations` table — which is CareHub's clinical table
-- (`patient_id, business_id, hpi, examination, primary_diagnosis, ...`).
-- Verified live: `professional_id`, `type`, `fee`, `notes` do not exist on
-- `consultations` (42703), so every setup save has silently failed in
-- production. The same lesson as `20260803_consultation_forms.sql` — that
-- name is taken by CareHub; CareFind gets its own table.
--
-- DESIGN
-- ------
-- * `professional_consultations` holds both the professional's OFFER
--   (status = 'setup', patient_id = professional's own id — the shape the
--   existing dashboard already filters on) and PAID BOOKINGS
--   (status = 'paid', patient_id = the paying patient).
-- * Money moves only through `pay_professional_consultation`
--   (SECURITY DEFINER, pinned search_path — the send_gift / credit_wallet_topup
--   pattern). The patient is derived from auth.uid() inside the function,
--   never caller-supplied (the C11/C17 lesson). One transaction: lock the
--   wallet, debit the patient ceil(fee/200) CareCoins (1 CareCoin = ₦200),
--   credit the professional's wallet, write both `transactions` ledger rows,
--   and insert the paid booking. No partial states — the whole body sits in
--   one exception block, so a raced double-booking's unique violation rolls
--   back the money movement too, not just the insert.
-- * A partial unique index makes a paid booking idempotent per
--   (professional, patient) pair — double-taps return 'already_booked'
--   instead of double-charging. A second index keeps one offer per
--   professional.
-- * RLS: a professional sees their own offer and incoming paid bookings; a
--   patient sees their own paid bookings. Only the professional's own
--   status='setup' row is client-insertable — paid rows are RPC-only.
--   Card payments settle server-side via api/charge-consultation +
--   api/verify-consultation-payment (service role), which use the same
--   ON CONFLICT idempotency.
--
-- SCOPE
-- -----
-- One new table, three indexes (two partial unique + one on transactions),
-- three policies, two RPCs. Idempotent; run once via the Supabase SQL editor.
-- ============================================================================

create table if not exists professional_consultations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references profiles(id) on delete cascade,
  patient_id uuid not null references profiles(id) on delete cascade,
  type text not null default 'text',          -- text | video | document
  fee numeric not null default 0,             -- naira
  notes text,
  status text not null default 'setup',       -- setup | paid
  created_at timestamptz not null default now()
);

create unique index if not exists professional_consultations_setup_uniq
  on professional_consultations (professional_id)
  where status = 'setup';

create unique index if not exists professional_consultations_paid_uniq
  on professional_consultations (professional_id, patient_id)
  where status = 'paid';

alter table professional_consultations enable row level security;

drop policy if exists "professional_consultations visible to either party" on professional_consultations;
create policy "professional_consultations visible to either party"
  on professional_consultations
  for select
  using (professional_id = auth.uid() or patient_id = auth.uid());

drop policy if exists "professionals create their own offer" on professional_consultations;
create policy "professionals create their own offer"
  on professional_consultations
  for insert
  with check (professional_id = auth.uid() and status = 'setup');


-- ============================================================================
-- pay_professional_consultation — atomic CareCoin settlement
-- ============================================================================
create or replace function public.pay_professional_consultation(p_professional uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid := auth.uid();
  v_fee numeric;
  v_type text;
  v_notes text;
  v_coins int;
  v_balance int;
begin
  if v_patient is null then
    return 'not_signed_in';
  end if;
  if p_professional is null then
    return 'no_professional';
  end if;

  -- The whole body is one exception block: if the paid-booking insert
  -- collides (unique index) the exception aborts this subtransaction, so
  -- the wallet debit/credit and ledger rows roll back with it — a raced
  -- double-booking can never move money.
  begin
    -- Already booked? Common case, caught cleanly before any money moves.
    if exists (
      select 1 from professional_consultations
       where professional_id = p_professional
         and patient_id = v_patient
         and status = 'paid'
    ) then
      return 'already_booked';
    end if;

    -- The professional's offer. A booking copies type/fee/notes from it.
    select fee, type, notes into v_fee, v_type, v_notes
      from professional_consultations
     where professional_id = p_professional
       and status = 'setup'
     limit 1;
    if v_fee is null or v_fee <= 0 then
      return 'no_setup';
    end if;

    -- 1 CareCoin = ₦200; round up so the platform never over-credits.
    v_coins := ceil(v_fee / 200)::int;

    -- Serialize concurrent payments for the same pair. The unique index is
    -- the backstop; the lock makes the wallet check race-free.
    select balance into v_balance
      from wallets
     where user_id = v_patient
     for update;
    if v_balance is null then
      v_balance := 0;
    end if;
    if v_balance < v_coins then
      return 'insufficient';
    end if;

    -- Debit the patient.
    update wallets set balance = balance - v_coins where user_id = v_patient;

    -- Credit the professional (self-provision the wallet row if needed).
    insert into wallets (user_id, balance)
    values (p_professional, v_coins)
    on conflict (user_id) do update set balance = wallets.balance + v_coins;

    -- Ledger both sides.
    insert into transactions (user_id, type, amount, naira_amount, status)
    values (v_patient, 'consultation_payment', v_coins, v_fee, 'success');
    insert into transactions (user_id, type, amount, naira_amount, status)
    values (p_professional, 'consultation_earnings', v_coins, v_fee, 'success');

    -- The paid booking. Unique violation => the race lost; abort everything.
    insert into professional_consultations (professional_id, patient_id, type, fee, notes, status)
    values (p_professional, v_patient, v_type, v_fee, v_notes, 'paid');

    return 'ok';
  exception
    when unique_violation then
      return 'already_booked';
  end;
end;
$$;

revoke execute on function public.pay_professional_consultation(uuid) from public, anon;
grant execute on function public.pay_professional_consultation(uuid) to authenticated;


-- ============================================================================
-- settle_consultation_payment — atomic card settlement (service_role only)
-- ----------------------------------------------------------------------------
-- Called by BOTH api/paystack-webhook.js and api/verify-consultation-payment.js,
-- which race the same reference when a patient pays by card (the webhook is
-- Paystack's async notification, the verify endpoint the redirect path). The
-- JS-level check-then-act that caused C15's top-up race must not be repeated:
-- this function claims the reference against a partial unique index, inserts
-- the paid booking, and credits the professional's wallet as one atomic unit,
-- so only one of the two racing callers can ever settle anything.
--
-- The patient's wallet is deliberately NOT debited here — the card payment
-- itself is the settlement. This is the fix to the subscription card path's
-- latent quirk (verify-subscription-payment.js calls pay_creator_subscription,
-- which debits the subscriber wallet even though they just paid by card).
-- ============================================================================
create unique index if not exists transactions_consultation_payment_reference_uniq
  on public.transactions (reference)
  where type = 'consultation_payment';

create or replace function public.settle_consultation_payment(
  p_patient uuid,
  p_professional uuid,
  p_fee numeric,
  p_reference text
) returns table(already_processed boolean, already_booked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins int;
  v_type text;
  v_notes text;
begin
  -- Claim the reference first; a racing caller settles nothing.
  insert into transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_patient, 'consultation_payment', ceil(coalesce(p_fee, 0) / 200)::int, p_fee, p_reference, 'success')
  on conflict (reference) where type = 'consultation_payment' do nothing;

  if not found then
    return query select true, false;
    return;
  end if;

  -- Copy the offer's type/notes; the charged fee is authoritative.
  select type, notes into v_type, v_notes
    from professional_consultations
   where professional_id = p_professional
     and status = 'setup'
   limit 1;
  if v_type is null then
    v_type := 'text';
  end if;

  -- The paid booking — unique per (professional, patient) pair, so a patient
  -- who already booked (wallet or card) can never be booked or paid twice.
  insert into professional_consultations (professional_id, patient_id, type, fee, notes, status)
  values (p_professional, p_patient, v_type, p_fee, v_notes, 'paid')
  on conflict (professional_id, patient_id) where status = 'paid' do nothing;

  if not found then
    return query select false, true;
    return;
  end if;

  -- Credit the professional's wallet (self-provision if needed).
  insert into wallets (user_id, balance)
  values (p_professional, ceil(coalesce(p_fee, 0) / 200)::int)
  on conflict (user_id) do update set balance = wallets.balance + ceil(coalesce(p_fee, 0) / 200)::int;

  -- Ledger the professional side.
  insert into transactions (user_id, type, amount, naira_amount, reference, status)
  values (p_professional, 'consultation_earnings', ceil(coalesce(p_fee, 0) / 200)::int, p_fee, p_reference, 'success');

  return query select false, false;
end;
$$;

revoke execute on function public.settle_consultation_payment(uuid, uuid, numeric, text)
  from public, anon, authenticated;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. Table + indexes exist:
--        select indexname from pg_indexes
--        where tablename = 'professional_consultations';
--      plus transactions_consultation_payment_reference_uniq on transactions.
--   2. RPCs exist, SECURITY DEFINER, search_path pinned:
--        select proname, prosecdef, proconfig from pg_proc
--        where proname in ('pay_professional_consultation', 'settle_consultation_payment');
--      POST /rest/v1/rpc/pay_professional_consultation with anon key => 42501;
--      settle_consultation_payment must be service_role-only (revoked from
--      public, anon, authenticated).
--   3. Behavioural probe (owner session, rolled-back block): create a setup
--      row for pro A (fee 2000, type 'video'), then as another user call
--      pay_professional_consultation(A) => 'ok'; wallet of the patient is
--      down 10 CareCoins, pro wallet up 10, two transactions rows, one paid
--      booking. A second call => 'already_booked'. A user with a 2-coin
--      wallet booking a ₦2000 offer => 'insufficient'.
--   4. Card path: settle_consultation_payment(patient, A, 2000, 'cf_consult_<test>')
--      => already_processed=false, already_booked=false; pro wallet +10; the
--      same reference again => already_processed=true (no double credit);
--      a fresh reference for an already-booked pair => already_booked=true.
--   5. End-to-end: /u/<pro> shows the consultation card; book it (wallet and
--      card); the booking appears under "Incoming Bookings" in /earn.
-- ============================================================================
