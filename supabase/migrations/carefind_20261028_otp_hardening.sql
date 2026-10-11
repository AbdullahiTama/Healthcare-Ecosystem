-- ============================================================================
-- 2026-10-28 - One-time codes: per-IP and platform-wide issuance limits (H01 of the payment-security hardening track)
--
-- WHY: issue_otp limited issuance per user and purpose only (60 s gap, 3 an hour). One signed-in person could still
-- mail codes to their own inbox at a sustainable rate from any number of accounts, and nothing bounded the platform as a
-- whole (cost, provider reputation, an attacker rotating accounts). Two more ceilings are added, both counted from the
-- same table inside the same advisory-locked transaction, so concurrent requests cannot slip past them:
--   * per client IP (a keyed HMAC of the address, never the address itself)  - financial_config.otp_ip_hourly_cap
--   * across the platform                                                    - financial_config.otp_global_hourly_cap
--
-- NOT APPLIED to production. Apply BEFORE deploying the application code that sends `p_ip_hash`; until then the old
-- code keeps working because the new parameter has a default. Verify afterwards:
--   select proname, pg_get_function_identity_arguments(oid), proacl from pg_proc
--    where proname = 'issue_otp';   -- exactly ONE row, proacl = {postgres=X/postgres,service_role=X/postgres}
--
-- SIGNATURE CHANGE: the four-argument issue_otp is DROPPED and replaced by a five-argument one with a default for the
-- new parameter. `create or replace` alone would leave the old function callable beside it (known trap). The return
-- values gain two members: 'ip_limited' and 'global_limited'.
--
-- No DELETE statement here (the Supabase MCP apply path hangs on one; see the otp_challenges migration). Old rows are
-- purged by the API's scheduled step `otp_purge`.
-- Re-runnable.
-- ============================================================================

do $$
begin
  if to_regclass('public.financial_config') is null then raise exception 'apply the financial foundation first (financial_config)'; end if;
  if to_regclass('public.otp_challenges') is null then raise exception 'apply the otp_challenges migration first'; end if;
end $$;

alter table public.otp_challenges add column if not exists ip_hash text;

create index if not exists otp_challenges_ip_recent
  on public.otp_challenges (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists otp_challenges_created
  on public.otp_challenges (created_at);

insert into public.financial_config (key, value, unit, description) values
  ('otp_ip_hourly_cap',     10,  'count', 'One-time codes that may be issued to one client IP (all accounts, all purposes) in any rolling hour.'),
  ('otp_global_hourly_cap', 500, 'count', 'One-time codes that may be issued across the whole platform in any rolling hour (abuse and cost ceiling).')
on conflict (key) do nothing;

-- The old signature goes first so no sibling overload can survive.
drop function if exists public.issue_otp(uuid, text, text, integer);

-- Issue a code. Order of checks (cheapest, most specific first): 60 s gap, per-user hourly cap, per-IP hourly cap,
-- platform hourly cap. Locks are always taken in the same order (user+purpose, then ip, then platform) so concurrent
-- calls cannot deadlock. Any earlier unconsumed code for the same user and purpose is invalidated.
-- Returns 'ok' | 'cooldown' | 'rate_limited' | 'ip_limited' | 'global_limited'.
create or replace function public.issue_otp(
  p_user_id uuid, p_purpose text, p_code_hash text, p_ttl_seconds integer, p_ip_hash text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last    timestamptz;
  v_count   integer;
  v_ip_cap  numeric;
  v_all_cap numeric;
begin
  if not (p_purpose = any (array['pin_set', 'payout_account', 'withdrawal'])) then
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

  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('otp_ip:' || p_ip_hash, 0));
    select coalesce((select value from public.financial_config where key = 'otp_ip_hourly_cap'), 10) into v_ip_cap;
    select count(*) into v_count
      from public.otp_challenges
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_count >= v_ip_cap then
      return 'ip_limited';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('otp_global', 0));
  select coalesce((select value from public.financial_config where key = 'otp_global_hourly_cap'), 500) into v_all_cap;
  select count(*) into v_count
    from public.otp_challenges where created_at > now() - interval '1 hour';
  if v_count >= v_all_cap then
    return 'global_limited';
  end if;

  update public.otp_challenges set consumed_at = now()
   where user_id = p_user_id and purpose = p_purpose and consumed_at is null;

  insert into public.otp_challenges (user_id, purpose, code_hash, expires_at, ip_hash)
  values (p_user_id, p_purpose, p_code_hash, now() + make_interval(secs => p_ttl_seconds), p_ip_hash);

  return 'ok';
end;
$$;

revoke execute on function public.issue_otp(uuid, text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.issue_otp(uuid, text, text, integer, text) to service_role;
