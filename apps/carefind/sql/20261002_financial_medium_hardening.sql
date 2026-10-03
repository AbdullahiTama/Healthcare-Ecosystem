-- 20261002_financial_medium_hardening.sql
-- Financial audit, Medium findings that need database changes (docs/architecture/Financial-Architecture-Audit.md).
-- Verified against the LIVE catalog 2026-10-02 before writing:
--   * wallets / business_wallets / transactions had NO CHECK constraints at all; no negative balances existed
--     (0 of each), so the constraints below can be added without touching data.
--   * appointments.payment_reference is already UNIQUE (appointments_payment_reference_uidx).
--
-- M-5  A balance can never go negative. Every debit RPC already guards `balance >= amount` in application
--      logic; this is the backstop for the next function, or hand-run SQL, that forgets to.
-- M-4  settle_card_booking trusted whatever reference its caller passed. fn_credit_business_booking claims
--      the reference with ON CONFLICT DO NOTHING, so settling appointment B with the reference of an already
--      paid appointment A would mark B paid while crediting the business and platform nothing. Every real
--      caller passes the booking's own reference (verify handlers look the booking up BY payment_reference;
--      the webhook uses the reference the server initiated), so refusing a mismatch changes no valid flow.
--
-- Idempotent. After applying, re-read pg_constraint / pg_proc.proacl (see the bottom).

begin;

-- ---------------------------------------------------------------------------------------
-- M-5: non-negative balances
-- ---------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_balance_nonnegative' and conrelid = 'public.wallets'::regclass) then
    alter table public.wallets add constraint wallets_balance_nonnegative check (balance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_wallets_held_nonnegative' and conrelid = 'public.business_wallets'::regclass) then
    alter table public.business_wallets add constraint business_wallets_held_nonnegative check (held_balance >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_wallets_available_nonnegative' and conrelid = 'public.business_wallets'::regclass) then
    alter table public.business_wallets add constraint business_wallets_available_nonnegative check (available_balance >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- M-4: settle_card_booking refuses a reference that belongs to a different booking
-- (live body, plus the stored-reference read and the mismatch guard)
-- ---------------------------------------------------------------------------------------
create or replace function public.settle_card_booking(p_appointment_id uuid, p_reference text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid; v_fee_kobo integer; v_payment_status text; v_source text; v_stored_reference text;
  v_coins integer; v_rounded_kobo integer; v_platform_kobo integer;
begin
  select business_id, fee_amount, payment_status, source, payment_reference
    into v_business_id, v_fee_kobo, v_payment_status, v_source, v_stored_reference
    from appointments where id = p_appointment_id for update;
  if v_business_id is null then return 'not_found'; end if;
  if v_payment_status in ('paid', 'refunded') then return 'already_paid'; end if;
  if v_fee_kobo is null or v_fee_kobo <= 0 then return 'no_fee'; end if;
  -- The reference being settled must be the one issued for THIS booking.
  if v_stored_reference is not null and p_reference is distinct from v_stored_reference then
    return 'reference_mismatch';
  end if;
  v_coins := ceil(v_fee_kobo / 20000.0)::int; v_rounded_kobo := v_coins * 20000; v_platform_kobo := (v_rounded_kobo * 0.2)::int;
  perform public.fn_credit_business_booking(v_business_id, p_appointment_id, v_rounded_kobo, v_platform_kobo, coalesce(p_reference, gen_random_uuid()::text));
  update appointments set payment_status = 'paid', payment_channel = 'card', refunded_at = null where id = p_appointment_id;
  return 'ok';
end;
$$;

-- CREATE OR REPLACE keeps the existing ACL, but re-assert it: service role only (callers are server handlers).
revoke all on function public.settle_card_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_card_booking(uuid, text) to service_role;

commit;

-- ---------------------------------------------------------------------------------------
-- Post-apply verification:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('wallets_balance_nonnegative','business_wallets_held_nonnegative','business_wallets_available_nonnegative');
--   select proname, proacl::text from pg_proc where proname = 'settle_card_booking';   -- expect postgres + service_role only
-- ---------------------------------------------------------------------------------------
