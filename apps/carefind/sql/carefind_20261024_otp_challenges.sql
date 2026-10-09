-- ============================================================================
-- 2026-10-24 - One-time codes (otp_challenges) for step-up actions on money settings
--
-- WHY: the withdrawal PIN was the second factor against a stolen session, but /api/withdrawal-pin/set let any
-- signed-in session REPLACE it (audit F-32), so a thief just set their own PIN and withdrew. Setting or replacing the
-- PIN now needs a fresh emailed 6-digit code (and the current PIN unless "forgot"). Later: adding a payout account.
--
-- APPLIED to production 2026-10-09 (as otp_challenges_table + otp_functions + issue_otp re-create). carefind_20261025
-- extends issue_otp with the payout_account purpose.
--
-- SECURITY MODEL: RLS on, no policies, no anon/authenticated grants. Reachable only through the SECURITY DEFINER
-- functions below, EXECUTE service_role only (the API verifies the JWT first). Only an HMAC of the code is stored,
-- keyed with OTP_HMAC_SECRET (falls back to the service-role key). 5 wrong guesses burn the code; 5-minute TTL;
-- 60 s between sends, 3 per hour, enforced atomically under an advisory lock.
--
-- NOTE: no DELETE statement inside issue_otp. Old codes are purged by the API (otp.js) after a send; the Supabase MCP
-- tool also hangs on SQL containing a DELETE, which is how this file ended up the way it is.
-- Re-runnable.
-- ============================================================================

create table if not exists public.otp_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  purpose     text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists otp_challenges_lookup
  on public.otp_challenges (user_id, purpose, created_at desc);

alter table public.otp_challenges enable row level security;
revoke all on table public.otp_challenges from public, anon, authenticated;

-- Issue a code. Atomic cooldown (60 s between sends) and hourly cap (3), so
-- concurrent requests cannot bypass them. Any earlier unconsumed code for the
-- same purpose is invalidated: only the newest code ever works.
-- Returns 'ok' | 'cooldown' | 'rate_limited'.
create or replace function public.issue_otp(
  p_user_id uuid, p_purpose text, p_code_hash text, p_ttl_seconds integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last  timestamptz;
  v_count integer;
begin
  if not (p_purpose = any (array['pin_set'])) then
    raise exception 'unknown otp purpose: %', p_purpose;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_purpose, 0));

  select max(created_at) into v_last
    from public.otp_challenges where user_id = p_user_id and purpose = p_purpose;
  if v_last is not null and v_last > now() - interval '60 seconds' then
    return 'cooldown';
  end if;

  select count(*) into v_count
    from public.otp_challenges
   where user_id = p_user_id and purpose = p_purpose and created_at > now() - interval '1 hour';
  if v_count >= 3 then
    return 'rate_limited';
  end if;

  update public.otp_challenges set consumed_at = now()
   where user_id = p_user_id and purpose = p_purpose and consumed_at is null;

  insert into public.otp_challenges (user_id, purpose, code_hash, expires_at)
  values (p_user_id, p_purpose, p_code_hash, now() + make_interval(secs => p_ttl_seconds));

  return 'ok';
end;
$$;

-- Verify and consume the newest live code. Row-locked so concurrent guesses are
-- serialised; 5 wrong guesses burn the code. Single use.
-- Returns 'ok' | 'invalid' | 'expired' | 'locked' | 'none'.
create or replace function public.verify_otp(
  p_user_id uuid, p_purpose text, p_code_hash text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.otp_challenges%rowtype;
begin
  select * into v
    from public.otp_challenges
   where user_id = p_user_id and purpose = p_purpose and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then
    return 'none';
  end if;

  if v.expires_at < now() then
    update public.otp_challenges set consumed_at = now() where id = v.id;
    return 'expired';
  end if;

  if v.attempts >= 5 then
    update public.otp_challenges set consumed_at = now() where id = v.id;
    return 'locked';
  end if;

  if v.code_hash = p_code_hash then
    update public.otp_challenges set consumed_at = now() where id = v.id;
    return 'ok';
  end if;

  update public.otp_challenges
     set attempts = attempts + 1,
         consumed_at = case when attempts + 1 >= 5 then now() else null end
   where id = v.id;
  return case when v.attempts + 1 >= 5 then 'locked' else 'invalid' end;
end;
$$;

revoke execute on function public.issue_otp(uuid, text, text, integer) from public, anon, authenticated;
grant  execute on function public.issue_otp(uuid, text, text, integer) to service_role;
revoke execute on function public.verify_otp(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.verify_otp(uuid, text, text) to service_role;

-- Superseded: an earlier draft of this work added a parallel business refund function. The withdrawal engine
-- (settle_business_withdrawal) is the only door for provider outcomes, so it is not kept.
drop function if exists public.reject_business_withdrawal(uuid);
