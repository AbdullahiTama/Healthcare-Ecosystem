-- 2026-11-03 - truthful superseded OTP outcome (Phase 1). Additive, re-runnable.
do $$ begin
  if to_regclass('public.otp_challenges') is null then raise exception 'apply the otp_challenges migration first'; end if;
end $$;
alter table public.otp_challenges add column if not exists consumed_reason text;
create or replace function public.issue_otp(p_user_id uuid, p_purpose text, p_code_hash text, p_ttl_seconds integer, p_ip_hash text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_count integer; v_ip_cap numeric; v_all_cap numeric;
begin
  if not (p_purpose = any (array['pin_set','payout_account','withdrawal'])) then raise exception 'unknown otp purpose: %', p_purpose; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_purpose, 0));
  select max(created_at) into v_last from public.otp_challenges where user_id=p_user_id and purpose=p_purpose;
  if v_last is not null and v_last > now() - interval '60 seconds' then return 'cooldown'; end if;
  select count(*) into v_count from public.otp_challenges where user_id=p_user_id and purpose=p_purpose and created_at > now() - interval '1 hour';
  if v_count >= 3 then return 'rate_limited'; end if;
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('otp_ip:' || p_ip_hash, 0));
    select coalesce((select value from public.financial_config where key='otp_ip_hourly_cap'),10) into v_ip_cap;
    select count(*) into v_count from public.otp_challenges where ip_hash=p_ip_hash and created_at > now() - interval '1 hour';
    if v_count >= v_ip_cap then return 'ip_limited'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('otp_global', 0));
  select coalesce((select value from public.financial_config where key='otp_global_hourly_cap'),500) into v_all_cap;
  select count(*) into v_count from public.otp_challenges where created_at > now() - interval '1 hour';
  if v_count >= v_all_cap then return 'global_limited'; end if;
  update public.otp_challenges set consumed_at=now(), consumed_reason='superseded'
   where user_id=p_user_id and purpose=p_purpose and consumed_at is null;
  insert into public.otp_challenges (user_id, purpose, code_hash, expires_at, ip_hash)
  values (p_user_id, p_purpose, p_code_hash, now() + make_interval(secs=>p_ttl_seconds), p_ip_hash);
  return 'ok';
end; $$;
create or replace function public.verify_otp(p_user_id uuid, p_purpose text, p_code_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.otp_challenges%rowtype;
begin
  select * into v from public.otp_challenges
   where user_id=p_user_id and purpose=p_purpose and consumed_at is null
   order by created_at desc limit 1 for update;
  if not found then return 'none'; end if;
  if v.expires_at < now() then update public.otp_challenges set consumed_at=now(), consumed_reason='expired' where id=v.id; return 'expired'; end if;
  if v.attempts >= 5 then update public.otp_challenges set consumed_at=now(), consumed_reason='locked' where id=v.id; return 'locked'; end if;
  if v.code_hash = p_code_hash then update public.otp_challenges set consumed_at=now(), consumed_reason='used' where id=v.id; return 'ok'; end if;
  if exists (select 1 from public.otp_challenges where user_id=p_user_id and purpose=p_purpose and code_hash=p_code_hash and consumed_reason='superseded') then
    return 'superseded';
  end if;
  update public.otp_challenges set attempts=attempts+1, consumed_at=case when attempts+1>=5 then now() else null end,
    consumed_reason=case when attempts+1>=5 then 'locked' else consumed_reason end where id=v.id;
  return case when v.attempts+1>=5 then 'locked' else 'invalid' end;
end; $$;
revoke execute on function public.issue_otp(uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.issue_otp(uuid,text,text,integer,text) to service_role;
revoke execute on function public.verify_otp(uuid,text,text) from public, anon, authenticated;
grant execute on function public.verify_otp(uuid,text,text) to service_role;
