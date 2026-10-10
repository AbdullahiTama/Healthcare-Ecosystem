-- ============================================================================
-- 2026-10-25 - Saved payout accounts with identity verification (KYC)
--
-- A payout account is a bank account a person (CareFind) or business (CareHub) has PROVEN is theirs. It is saved once
-- and used for withdrawals, so money can only ever leave to an account whose holder was verified:
--   1. identity   - BVN and NIN checked with Dojah; the legal name is stored (kyc_verifications)
--   2. the account - resolved with the bank (Paystack); its name must match the verified legal name
--      (businesses: the verified owner's name, or the registered business name)
--   3. possession of the inbox - an emailed one-time code (otp_challenges, purpose 'payout_account')
-- Only then does the API call payout_account_add. Rows are never deleted (disabled instead) so there is a trail.
--
-- PRIVACY (NDPA): raw BVN / NIN are NEVER stored or logged. kyc_verifications keeps a keyed HMAC of each (to enforce
-- one BVN / NIN per person), the last four digits (to show "BVN ending 1234"), and the legal name Dojah returned
-- (needed to match account names). Dojah's other fields (photo, phone, date of birth) are discarded by the API.
--
-- SECURITY MODEL: RLS on, no policies, no anon/authenticated grants; writes revoked from EVERY role,
-- including service_role. The only writers are the SECURITY DEFINER functions below, EXECUTE service_role only (the
-- API verifies the JWT first). Same model as the withdrawal engine.
--
-- Re-runnable. Apply AFTER carefind_20261008_withdrawal_engine (financial_config) and the otp_challenges migration.
-- ============================================================================

do $$
begin
  if to_regclass('public.financial_config') is null then raise exception 'apply carefind_20261002 financial foundation first (financial_config)'; end if;
  if to_regclass('public.otp_challenges') is null then raise exception 'apply the otp_challenges migration first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Configuration. 0 = a withdrawal may still be typed in (today's behaviour); 1 = withdrawals must use a verified
-- saved payout account. Flip to 1 once Dojah is live and people have had time to save an account.
-- ---------------------------------------------------------------------------------------------
insert into public.financial_config (key, value, unit, description) values
  ('payout_account_required', 0, 'flag', '1 = a withdrawal must go to a verified saved payout account (CareFind and CareHub); 0 = typed bank details still accepted.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- OTP purposes: add payout_account (old codes are purged by the API; see the otp migration)
-- ---------------------------------------------------------------------------------------------
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
  if not (p_purpose = any (array['pin_set', 'payout_account'])) then
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

-- ---------------------------------------------------------------------------------------------
-- kyc_verifications: one row per person (auth user), shared by CareFind and CareHub
-- ---------------------------------------------------------------------------------------------
create table if not exists public.kyc_verifications (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  legal_first_name    text,
  legal_middle_name   text,
  legal_last_name     text,
  bvn_hash            text,
  bvn_last4           text,
  nin_hash            text,
  nin_last4           text,
  verified_at         timestamptz,
  tier                smallint not null default 0 check (tier between 0 and 2), -- 0 none, 1 BVN+NIN, 2 + selfie match
  selfie_verified_at  timestamptz,
  selfie_confidence   numeric,
  provider            text not null default 'dojah',
  provider_ref        text,
  attempts            integer not null default 0,
  attempt_window_start timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One BVN / one NIN per person: the same identity cannot back two accounts.
create unique index if not exists kyc_bvn_hash_uniq on public.kyc_verifications (bvn_hash) where bvn_hash is not null;
create unique index if not exists kyc_nin_hash_uniq on public.kyc_verifications (nin_hash) where nin_hash is not null;

-- ---------------------------------------------------------------------------------------------
-- payout_accounts
-- ---------------------------------------------------------------------------------------------
create table if not exists public.payout_accounts (
  id               uuid primary key default gen_random_uuid(),
  owner_type       text not null check (owner_type in ('user', 'business')),
  owner_id         uuid not null,                       -- the user's id, or the (parent) business id
  created_by       uuid not null references auth.users(id),
  bank_code        text not null,
  bank_name        text not null,
  account_number   text not null check (account_number ~ '^[0-9]{10}$'),
  account_name     text not null,                       -- as reported by the bank, never typed
  name_match_score numeric,
  is_default       boolean not null default false,
  status           text not null default 'verified' check (status in ('verified', 'disabled')),
  verified_at      timestamptz not null default now(),
  disabled_at      timestamptz,
  created_at       timestamptz not null default now()
);

create unique index if not exists payout_accounts_active_uniq
  on public.payout_accounts (owner_type, owner_id, bank_code, account_number) where status = 'verified';
create unique index if not exists payout_accounts_one_default
  on public.payout_accounts (owner_type, owner_id) where is_default and status = 'verified';
create index if not exists payout_accounts_owner on public.payout_accounts (owner_type, owner_id, status);

-- ---------------------------------------------------------------------------------------------
-- Lock the tables down: no policies, no client access, no direct writes from anyone.
-- ---------------------------------------------------------------------------------------------
alter table public.kyc_verifications enable row level security;
alter table public.payout_accounts   enable row level security;
revoke all on table public.kyc_verifications from public, anon, authenticated;
revoke all on table public.payout_accounts   from public, anon, authenticated;
-- service_role may only READ these tables; every write goes through the functions below.
revoke all on table public.kyc_verifications from service_role;
revoke all on table public.payout_accounts   from service_role;
grant select on table public.kyc_verifications to service_role;
grant select on table public.payout_accounts   to service_role;

-- ---------------------------------------------------------------------------------------------
-- KYC functions
-- ---------------------------------------------------------------------------------------------

-- Each identity check costs money and can be used to probe other people's BVNs, so attempts are capped at 5 per 24 h
-- per person. Returns 'ok' | 'locked' | 'already_verified'. Atomic.
create or replace function public.kyc_begin_attempt(p_user_id uuid, p_max integer default 5)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.kyc_verifications%rowtype;
begin
  insert into public.kyc_verifications (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v from public.kyc_verifications where user_id = p_user_id for update;

  if v.tier >= 1 then return 'already_verified'; end if;

  if v.attempt_window_start is null or v.attempt_window_start < now() - interval '24 hours' then
    update public.kyc_verifications set attempts = 1, attempt_window_start = now(), updated_at = now() where user_id = p_user_id;
    return 'ok';
  end if;
  if v.attempts >= p_max then return 'locked'; end if;

  update public.kyc_verifications set attempts = attempts + 1, updated_at = now() where user_id = p_user_id;
  return 'ok';
end;
$$;

-- Record a verified identity. Returns 'ok' | 'bvn_in_use' | 'nin_in_use' | 'already_verified'.
create or replace function public.kyc_save_verified(
  p_user_id uuid,
  p_first text, p_middle text, p_last text,
  p_bvn_hash text, p_bvn_last4 text, p_nin_hash text, p_nin_last4 text,
  p_provider_ref text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier smallint;
  v_constraint text;
begin
  select tier into v_tier from public.kyc_verifications where user_id = p_user_id for update;
  if v_tier is null then
    insert into public.kyc_verifications (user_id) values (p_user_id) on conflict (user_id) do nothing;
  elsif v_tier >= 1 then
    return 'already_verified';
  end if;

  begin
    update public.kyc_verifications
       set legal_first_name = p_first, legal_middle_name = nullif(p_middle, ''), legal_last_name = p_last,
           bvn_hash = p_bvn_hash, bvn_last4 = p_bvn_last4, nin_hash = p_nin_hash, nin_last4 = p_nin_last4,
           verified_at = now(), tier = 1, provider_ref = p_provider_ref, updated_at = now()
     where user_id = p_user_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return case when v_constraint = 'kyc_nin_hash_uniq' then 'nin_in_use' else 'bvn_in_use' end;
  end;
  return 'ok';
end;
$$;

-- Selfie match (tier 2). Needs a verified identity first. Returns 'ok' | 'not_verified'.
create or replace function public.kyc_save_selfie(p_user_id uuid, p_confidence numeric, p_provider_ref text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kyc_verifications
     set tier = 2, selfie_verified_at = now(), selfie_confidence = p_confidence,
         provider_ref = coalesce(p_provider_ref, provider_ref), updated_at = now()
   where user_id = p_user_id and tier >= 1;
  return case when found then 'ok' else 'not_verified' end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Payout account functions
-- ---------------------------------------------------------------------------------------------

-- Add a VERIFIED account (the API has already checked identity, name match and the emailed code).
-- Returns { outcome: 'ok' | 'duplicate' | 'limit', id? }. The first account becomes the default. Max 5 active.
create or replace function public.payout_account_add(
  p_owner_type text, p_owner_id uuid, p_created_by uuid,
  p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_score numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('payout_accounts:' || p_owner_type || ':' || p_owner_id::text, 0));

  if exists (select 1 from public.payout_accounts
              where owner_type = p_owner_type and owner_id = p_owner_id and status = 'verified'
                and bank_code = p_bank_code and account_number = p_account_number) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  select count(*) into v_count from public.payout_accounts
   where owner_type = p_owner_type and owner_id = p_owner_id and status = 'verified';
  if v_count >= 5 then return jsonb_build_object('outcome', 'limit'); end if;

  insert into public.payout_accounts
    (owner_type, owner_id, created_by, bank_code, bank_name, account_number, account_name, name_match_score, is_default)
  values
    (p_owner_type, p_owner_id, p_created_by, p_bank_code, p_bank_name, p_account_number, p_account_name, p_score, v_count = 0)
  returning id into v_id;

  return jsonb_build_object('outcome', 'ok', 'id', v_id);
end;
$$;

-- Make one account the default. Returns 'ok' | 'not_found'.
create or replace function public.payout_account_set_default(p_owner_type text, p_owner_id uuid, p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('payout_accounts:' || p_owner_type || ':' || p_owner_id::text, 0));
  if not exists (select 1 from public.payout_accounts
                  where id = p_id and owner_type = p_owner_type and owner_id = p_owner_id and status = 'verified') then
    return 'not_found';
  end if;
  update public.payout_accounts set is_default = false
   where owner_type = p_owner_type and owner_id = p_owner_id and is_default and id <> p_id;
  update public.payout_accounts set is_default = true where id = p_id;
  return 'ok';
end;
$$;

-- Remove (disable) an account. If it was the default, the newest remaining one takes over.
-- Returns 'ok' | 'not_found'.
create or replace function public.payout_account_disable(p_owner_type text, p_owner_id uuid, p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_default boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('payout_accounts:' || p_owner_type || ':' || p_owner_id::text, 0));
  select is_default into v_was_default from public.payout_accounts
   where id = p_id and owner_type = p_owner_type and owner_id = p_owner_id and status = 'verified' for update;
  if not found then return 'not_found'; end if;

  update public.payout_accounts set status = 'disabled', is_default = false, disabled_at = now() where id = p_id;

  if v_was_default then
    update public.payout_accounts set is_default = true
     where id = (select id from public.payout_accounts
                  where owner_type = p_owner_type and owner_id = p_owner_id and status = 'verified'
                  order by created_at desc limit 1);
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Access: service_role only
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.kyc_begin_attempt(uuid, integer) from public, anon, authenticated;
revoke execute on function public.kyc_save_verified(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.kyc_save_selfie(uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.payout_account_add(text, uuid, uuid, text, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.payout_account_set_default(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.payout_account_disable(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.kyc_begin_attempt(uuid, integer) to service_role;
grant execute on function public.kyc_save_verified(uuid, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.kyc_save_selfie(uuid, numeric, text) to service_role;
grant execute on function public.payout_account_add(text, uuid, uuid, text, text, text, text, numeric) to service_role;
grant execute on function public.payout_account_set_default(text, uuid, uuid) to service_role;
grant execute on function public.payout_account_disable(text, uuid, uuid) to service_role;

-- ============================================================================
-- VERIFY AFTER APPLYING (re-read proacl: project trap)
--   select proname, proacl from pg_proc where proname in ('issue_otp','kyc_begin_attempt','kyc_save_verified',
--     'kyc_save_selfie','payout_account_add','payout_account_set_default','payout_account_disable');
--     -> postgres + service_role only.
--   select relname, relrowsecurity from pg_class where relname in ('kyc_verifications','payout_accounts');  -- both t
--   select has_table_privilege('service_role','public.payout_accounts','insert');                          -- false
--   select value from financial_config where key = 'payout_account_required';                              -- 0
-- ============================================================================
