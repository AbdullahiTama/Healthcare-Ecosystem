-- ============================================================================
-- 2026-08-16 — Feature: withdrawal PIN security gate
--
-- WHY THIS EXISTS
-- ---------------
-- Withdrawal used to require only a valid session (JWT). Anyone with access to
-- a signed-in session — a stolen token, a logged-in device — could withdraw the
-- wallet's entire balance to a bank account they control. This migration adds a
-- per-user withdrawal PIN required on EVERY withdrawal, verified server-side
-- with rate limiting, so only the account owner can move money.
--
-- SECURITY MODEL
-- --------------
--   * The withdrawal_pins table is RLS-enabled with NO policies for
--     anon/authenticated and NO direct table grants for them. It is reachable
--     only through the three SECURITY DEFINER RPCs below, whose EXECUTE is
--     revoked from public/anon/authenticated and granted to service_role only —
--     the serverless API, which has already verified the JWT via verifyUser().
--     This mirrors the request_withdrawal family
--     (sql/20260814_request_withdrawal_user_id_and_account_verify.sql).
--   * The client NEVER sees a hash or salt. It only ever requests set/verify;
--     the raw PIN travels over HTTPS to the API, which never logs it. The API
--     computes scrypt(pin, salt) with node:crypto (zero new dependencies):
--         salt = 16 random bytes, hex-encoded (32 hex chars)
--         hash = scrypt(pin, Buffer.from(salt,'hex'), 64 bytes), hex-encoded
--                (128 hex chars)
--     and only the derived hash + salt reach these RPCs.
--   * PINs are 4-6 digits, enforced on the client AND again server-side.
--   * Rate limiting: 5 consecutive failed attempts locks the PIN for 15 minutes
--     (locked_until).
--   * verify_withdrawal_pin is the authoritative compare + lockout state
--     machine. It row-locks the user's row (SELECT ... FOR UPDATE) so concurrent
--     attempts are serialized — exactly one attempt can advance
--     failed_attempts / set locked_until at a time.
--
-- APPLY: this migration must be applied live (not shipped inside a build) by
-- the lead engineer. It is safe and idempotent.
-- ============================================================================

create table if not exists public.withdrawal_pins (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  pin_hash        text not null,
  pin_salt        text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.withdrawal_pins enable row level security;

-- No anon/authenticated policies and no anon/authenticated grants: the table is
-- service-role/owner only, reached exclusively through the SECURITY DEFINER
-- RPCs below.
revoke all on table public.withdrawal_pins from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Read the stored row (or an empty result) so the API can derive/compute a PIN
-- attempt hash before calling verify_withdrawal_pin.
-- ----------------------------------------------------------------------------
create or replace function public.get_withdrawal_pin(p_user_id uuid)
returns table(pin_hash text, pin_salt text, failed_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select wp.pin_hash, wp.pin_salt, wp.failed_attempts, wp.locked_until
    from public.withdrawal_pins wp
    where wp.user_id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Upsert the PIN. (Re)setting always resets the lockout state.
-- ----------------------------------------------------------------------------
create or replace function public.set_withdrawal_pin(p_user_id uuid, p_pin_hash text, p_pin_salt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.withdrawal_pins (user_id, pin_hash, pin_salt)
  values (p_user_id, p_pin_hash, p_pin_salt)
  on conflict (user_id) do update
    set pin_hash        = excluded.pin_hash,
        pin_salt        = excluded.pin_salt,
        failed_attempts = 0,
        locked_until    = null,
        updated_at      = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- Authoritative PIN compare + lockout state machine.
-- The API computes scrypt(pin, salt) with node:crypto and passes the resulting
-- hash; this RPC only compares strings and manages failed_attempts/locked_until.
-- The row is locked FOR UPDATE so concurrent attempts are serialized.
-- ----------------------------------------------------------------------------
create or replace function public.verify_withdrawal_pin(p_user_id uuid, p_pin_hash text, p_pin_salt text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_until timestamptz;
  v_pin_hash     text;
  v_pin_salt     text;
begin
  select locked_until, pin_hash, pin_salt
    into v_locked_until, v_pin_hash, v_pin_salt
  from public.withdrawal_pins
  where user_id = p_user_id
  for update;

  -- Locked right now -> reject without touching the counter.
  if v_locked_until is not null and v_locked_until > now() then
    return false;
  end if;

  if v_pin_hash is not null and v_pin_salt is not null
     and v_pin_hash = p_pin_hash and v_pin_salt = p_pin_salt then
    update public.withdrawal_pins
      set failed_attempts = 0, locked_until = null, updated_at = now()
      where user_id = p_user_id;
    return true;
  end if;

  -- Mismatch (or no row yet): record the failure; 5 in a row locks for 15 min.
  update public.withdrawal_pins
    set failed_attempts = failed_attempts + 1,
        locked_until    = case
          when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else locked_until
        end,
        updated_at      = now()
    where user_id = p_user_id;

  return false;
end;
$$;

revoke execute on function public.get_withdrawal_pin(uuid) from public, anon, authenticated;
grant execute on function public.get_withdrawal_pin(uuid) to service_role;

revoke execute on function public.set_withdrawal_pin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_withdrawal_pin(uuid, text, text) to service_role;

revoke execute on function public.verify_withdrawal_pin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_withdrawal_pin(uuid, text, text) to service_role;

-- ============================================================================
-- VERIFY AFTER APPLYING:
--   1. withdrawal_pins exists, RLS enabled, no anon/authenticated policies, and
--      table grants list only the owner/service_role.
--   2. All three functions' proacl lists only postgres/service_role.
--   3. set_withdrawal_pin inserts; a second set for the same user upserts and
--      resets failed_attempts/locked_until.
--   4. verify_withdrawal_pin returns true for a correct hash and resets the
--      counter; 5 wrong hashes set locked_until ~15m ahead and verify returns
--      false while locked; concurrent attempts serialize on the row lock.
--   5. initiate-withdrawal.js rejects withdrawals with no PIN, an incorrect
--      PIN, or an active lockout BEFORE any balance/transfer work.
-- ============================================================================