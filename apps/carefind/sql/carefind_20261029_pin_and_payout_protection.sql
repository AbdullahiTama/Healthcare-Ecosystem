-- ============================================================================
-- 2026-10-29 - PIN-change cooling-off and destination history lookups (H02 of the payment-security hardening track)
--
-- WHY: a withdrawal needs the PIN and a fresh emailed code, but a person who controls the session AND the inbox could reset
-- the PIN ("forgot PIN" needs only a code) and withdraw at once. The platform now caps withdrawals for a configurable period
-- after the PIN is set or reset (same cap as a new payout account), and it needs to know WHEN the PIN was last set:
--   * withdrawal_pins.pin_set_at   written by set_withdrawal_pin; NULL for PINs that were never changed since this
--                                  migration, which are treated as "not recent" (no existing user is capped by applying it).
--   * financial_config.pin_change_cooloff_hours   (default 24; 0 disables the rule, no deploy needed)
-- It also adds partial indexes for the "have we already paid this destination?" lookup the withdrawal handlers do
-- (a completed withdrawal to the same bank account makes a destination known).
--
-- NOT APPLIED to production. Safe to apply before the code deploy: nothing reads pin_set_at until the new code does, and
-- set_withdrawal_pin keeps its signature (no sibling overload).
--
-- Verify afterwards: select proname, pg_get_function_identity_arguments(oid), proacl from pg_proc
--   where proname = 'set_withdrawal_pin';  -- ONE row, {postgres=X/postgres,service_role=X/postgres}
-- Re-runnable.
-- ============================================================================

do $$
begin
  if to_regclass('public.withdrawal_pins') is null then raise exception 'apply carefind_20260816_withdrawal_pin first'; end if;
  if to_regclass('public.financial_config') is null then raise exception 'apply the financial foundation first (financial_config)'; end if;
end $$;

alter table public.withdrawal_pins add column if not exists pin_set_at timestamptz;

insert into public.financial_config (key, value, unit, description) values
  ('pin_change_cooloff_hours', 24, 'hours', 'After a withdrawal PIN is set or reset, withdrawals are capped at payout_account_cooloff_daily_cap_kobo per rolling 24 h for this many hours. 0 disables.')
on conflict (key) do nothing;

-- Same signature as before (create or replace keeps the one function); the only change is pin_set_at.
create or replace function public.set_withdrawal_pin(p_user_id uuid, p_pin_hash text, p_pin_salt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.withdrawal_pins (user_id, pin_hash, pin_salt, pin_set_at)
  values (p_user_id, p_pin_hash, p_pin_salt, now())
  on conflict (user_id) do update
    set pin_hash        = excluded.pin_hash,
        pin_salt        = excluded.pin_salt,
        failed_attempts = 0,
        locked_until    = null,
        pin_set_at      = now(),
        updated_at      = now();
end;
$$;

revoke execute on function public.set_withdrawal_pin(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.set_withdrawal_pin(uuid, text, text) to service_role;

-- "Has this owner already received a completed withdrawal at this bank account?" (index-only, partial)
do $$
begin
  if to_regclass('public.withdrawal_requests') is not null then
    execute 'create index if not exists withdrawal_requests_known_destination
               on public.withdrawal_requests (user_id, bank_code, account_number) where status = ''completed''';
  end if;
  if to_regclass('public.business_withdrawal_requests') is not null then
    execute 'create index if not exists business_withdrawal_requests_known_destination
               on public.business_withdrawal_requests (business_id, bank_code, account_number) where status = ''completed''';
  end if;
end $$;
