-- Financial audit F-06: settle_card_booking converted the card fee into CareCoins, rounded UP to a
-- coin boundary, and credited the business / booked the platform commission on that rounded figure.
-- A customer who paid N1,500.50 had the business credited 80% of N1,600. A card payment is real money
-- in kobo; it must never be accounted in rounded CareCoin value.
--
-- Settlement is now from the ACTUAL fee, and the platform share comes from financial_config
-- (booking_platform_rate, currently 0.20 - the existing rule). Everything else is unchanged: same
-- signature (CREATE OR REPLACE swaps it in place, keeping grants, leaving no overload), same return
-- values and checks, same idempotency via fn_credit_business_booking's ON CONFLICT guards.
-- Still used by CareHub appointment payments until Phase 06 moves them onto the settlement engine.
-- pay_booking_with_credits (the CareCoin path) is deliberately untouched: coins ARE its currency.

-- Order matters: needs public._fin_cfg() from carefind_20261004_settle_payment_intent.
do $$
begin
  if to_regprocedure('public._fin_cfg(text)') is null then
    raise exception 'apply carefind_20261004_settle_payment_intent first (public._fin_cfg is missing)';
  end if;
end $$;

create or replace function public.settle_card_booking(p_appointment_id uuid, p_reference text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_business_id uuid; v_fee_kobo integer; v_payment_status text; v_source text; v_stored_reference text;
  v_platform_kobo integer;
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
  v_platform_kobo := round(v_fee_kobo * public._fin_cfg('booking_platform_rate'))::integer;
  perform public.fn_credit_business_booking(v_business_id, p_appointment_id, v_fee_kobo, v_platform_kobo, coalesce(p_reference, gen_random_uuid()::text));
  update appointments set payment_status = 'paid', payment_channel = 'card', refunded_at = null where id = p_appointment_id;
  return 'ok';
end;
$function$;

do $$
declare n integer; bad text;
begin
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'settle_card_booking';
  if n <> 1 then raise exception 'expected exactly one settle_card_booking, found %', n; end if;
  select string_agg(p.proname, ', ') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'settle_card_booking'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'client roles can execute %', bad; end if;
end $$;
