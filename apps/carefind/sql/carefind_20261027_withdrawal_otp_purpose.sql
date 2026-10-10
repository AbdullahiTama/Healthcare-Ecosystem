-- ============================================================================
-- 2026-10-27 - A fresh emailed code on every withdrawal (otp purpose 'withdrawal')
--
-- Withdrawals need the PIN AND a one-time code emailed to the account, so a leaked or shoulder-surfed PIN alone cannot
-- move money. The code uses the same otp_challenges service as the PIN and payout-account codes (HMAC only, 5 attempts,
-- 5-minute TTL, 60 s resend gap, 3 an hour - counted per purpose). The only change is that issue_otp accepts the new
-- purpose. No tables change. Old codes are purged by the API (see the otp migration).
--
-- NOT APPLIED to production yet. Apply before deploying the code that sends purpose 'withdrawal'.
-- ============================================================================
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

  update public.otp_challenges set consumed_at = now()
   where user_id = p_user_id and purpose = p_purpose and consumed_at is null;

  insert into public.otp_challenges (user_id, purpose, code_hash, expires_at)
  values (p_user_id, p_purpose, p_code_hash, now() + make_interval(secs => p_ttl_seconds));

  return 'ok';
end;
$$;

revoke execute on function public.issue_otp(uuid, text, text, integer) from public, anon, authenticated;
grant  execute on function public.issue_otp(uuid, text, text, integer) to service_role;
