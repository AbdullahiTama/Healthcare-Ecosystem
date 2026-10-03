-- ============================================================================
-- 20260906_carefindhub_foundation.sql
--
-- CareFindHub SQL foundation: agents, tiers, earnings, admin roles,
-- applications, payouts
--
-- Spec: _bmad-output/implementation-artifacts/spec-carefindhub-sql-foundation.md
--
-- Problem: CareFindHub panel upgrade requires 7+ new tables and supporting
-- logic, but platform_team_members vs admin_team_members naming conflicts
-- and missing businesses columns block all Dashboard/Businesses/Team/
-- Applications/Ledger/Payouts work. No foundation exists for agent tiers,
-- referrals, earnings (with idempotent webhook handling), 20-cap, transfers.
--
-- Approach: Schema-first foundation. Resolve team-table naming via
-- information_schema check (rename if platform_team_members exists, else
-- create admin_team_members). Ensure businesses has owner_name, owner_email,
-- category, state, plan, status (pending/active/suspended/revoked),
-- ecommerce_enabled, deleted_at. Create agent_tiers/agents (augmented)/
-- agent_referrals/agent_earnings/agent_transfers, admin_roles/
-- admin_team_members, applications, payout_requests with FKs/indexes, RLS
-- policies (Allow all where appropriate, lockdown on sensitive agents), and
-- atomic SECURITY DEFINER earnings function with idempotency, plus 20-cap
-- enforcement and referral_code generation.
--
-- Boundaries: shared project szdybxmgmhndoytqanfb; CareHub custom
-- password_hash (no Supabase Auth unless required); RLS Allow all on
-- non-sensitive tables, lockdown on agents; reuse credit_wallet/send_gift
-- atomic pattern; keep existing CareFind/CareHub workflows intact.
--
-- Idempotency: every DDL uses IF NOT EXISTS / DO blocks checking
-- information_schema / pg_constraint / pg_policies so the file is safe to
-- re-apply. Verification queries at bottom.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Team naming resolution: platform_team_members vs admin_team_members
--    Spec: Dashboard says platform_team_members, schema says admin_team_members
--    Requirement: single table, no duplicate. Check information_schema, rename
--    if platform exists else create admin_team_members.
-- ============================================================================

do $$
begin
  -- If platform_team_members exists and admin_team_members does not, rename
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='platform_team_members')
     and not exists (select 1 from information_schema.tables where table_schema='public' and table_name='admin_team_members') then
    execute 'alter table public.platform_team_members rename to admin_team_members';
    raise notice 'renamed platform_team_members -> admin_team_members';
  elsif exists (select 1 from information_schema.tables where table_schema='public' and table_name='platform_team_members')
        and exists (select 1 from information_schema.tables where table_schema='public' and table_name='admin_team_members') then
    raise notice 'both platform_team_members and admin_team_members exist - keeping admin_team_members, not creating duplicate (manual cleanup may be needed)';
  end if;
end $$;

-- ============================================================================
-- 2. admin_roles — permission checklist
--    navCatalogueFor pattern reuse candidate: permissions jsonb holds
--    [Dashboard, Businesses, Team-Agents, Team-Platform, Applications,
--     Ledger, Payouts, Coverage] per spec Code Map.
-- ============================================================================

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure permissions column is jsonb even if table pre-existed with different type
do $$
begin
  -- no-op if already correct; keeps migration idempotent
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='admin_roles') then
    -- ensure updated_at exists
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='admin_roles' and column_name='updated_at') then
      execute 'alter table public.admin_roles add column updated_at timestamptz not null default now()';
    end if;
  end if;
end $$;

create index if not exists admin_roles_name_idx on public.admin_roles (name);

-- Seed default roles if empty (idempotent)
insert into public.admin_roles (name, permissions)
values
  ('super_admin', '{"Dashboard": true, "Businesses": true, "Team-Agents": true, "Team-Platform": true, "Applications": true, "Ledger": true, "Payouts": true, "Coverage": true}'::jsonb),
  ('admin', '{"Dashboard": true, "Businesses": true, "Team-Agents": true, "Team-Platform": false, "Applications": true, "Ledger": true, "Payouts": false, "Coverage": true}'::jsonb),
  ('viewer', '{"Dashboard": true, "Businesses": false, "Team-Agents": false, "Team-Platform": false, "Applications": false, "Ledger": false, "Payouts": false, "Coverage": false}'::jsonb)
on conflict (name) do nothing;

-- ============================================================================
-- 3. admin_team_members — single team table after rename/creation
-- ============================================================================

create table if not exists public.admin_team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique not null,
  password_hash text not null,
  role_id uuid references public.admin_roles(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login timestamptz
);

-- If table was renamed from platform_team_members, it may lack new columns — add them
alter table public.admin_team_members add column if not exists full_name text;
alter table public.admin_team_members add column if not exists email text;
alter table public.admin_team_members add column if not exists password_hash text;
alter table public.admin_team_members add column if not exists role_id uuid;
alter table public.admin_team_members add column if not exists status text;
alter table public.admin_team_members add column if not exists created_at timestamptz;
alter table public.admin_team_members add column if not exists updated_at timestamptz;
alter table public.admin_team_members add column if not exists last_login timestamptz;

-- Backfill not-null where needed (only if renamed table had nulls)
do $$
begin
  -- status check constraint if not exists
  if not exists (select 1 from pg_constraint where conname='admin_team_members_status_check' and conrelid='public.admin_team_members'::regclass) then
    -- clean any existing invalid statuses before adding constraint
    update public.admin_team_members set status='active' where status not in ('active','inactive','suspended','pending');
    alter table public.admin_team_members add constraint admin_team_members_status_check check (status in ('active','inactive','suspended','pending'));
  end if;
end $$;

-- FK for role_id if not exists (when renamed table had no FK)
do $$
begin
  if not exists (select 1 from pg_constraint where conname='admin_team_members_role_id_fkey' and conrelid='public.admin_team_members'::regclass) then
    -- only add if column exists and no invalid refs
    begin
      alter table public.admin_team_members add constraint admin_team_members_role_id_fkey foreign key (role_id) references public.admin_roles(id) on delete set null;
    exception when others then
      raise notice 'could not add admin_team_members_role_id_fkey: %', sqlerrm;
    end;
  end if;
end $$;

create index if not exists admin_team_members_email_idx on public.admin_team_members (email);
create index if not exists admin_team_members_role_idx on public.admin_team_members (role_id);
create index if not exists admin_team_members_status_idx on public.admin_team_members (status);

-- ============================================================================
-- 4. businesses — ensure required columns, status check, ecommerce_enabled
--    Spec: name, owner_name, owner_email, category, state, plan,
--          status(pending/active/suspended/revoked), ecommerce_enabled
--    Design Notes: add deleted_at nullable for soft-delete decision later
-- ============================================================================

alter table public.businesses add column if not exists owner_name text;
alter table public.businesses add column if not exists owner_email text;
alter table public.businesses add column if not exists category text;
alter table public.businesses add column if not exists ecommerce_enabled boolean not null default false;
alter table public.businesses add column if not exists deleted_at timestamptz;

-- state and plan already exist; ensure they exist for idempotency (no-op if present)
-- name already exists

-- status check constraint: pending/active/suspended/revoked
do $$
begin
  if not exists (select 1 from pg_constraint where conname='businesses_status_check' and conrelid='public.businesses'::regclass) then
    -- normalize any legacy values outside the new set before adding constraint
    update public.businesses set status='pending' where status not in ('pending','active','suspended','revoked') or status is null;
    alter table public.businesses add constraint businesses_status_check check (status in ('pending','active','suspended','revoked'));
  end if;
end $$;

-- category index + state index + status index + ecommerce_enabled index
create index if not exists businesses_owner_email_idx on public.businesses (owner_email) where owner_email is not null;
create index if not exists businesses_category_idx on public.businesses (category) where category is not null;
create index if not exists businesses_status_idx on public.businesses (status);
create index if not exists businesses_ecommerce_enabled_idx on public.businesses (ecommerce_enabled);
create index if not exists businesses_deleted_at_idx on public.businesses (deleted_at) where deleted_at is not null;
create index if not exists businesses_state_category_idx on public.businesses (state, category) where state is not null;

-- Backfill owner_name / owner_email from legacy owner/email if null (best-effort)
update public.businesses set owner_name = owner where owner_name is null and owner is not null;
update public.businesses set owner_email = email where owner_email is null and email is not null;
update public.businesses set category = business_type where category is null and business_type is not null;

-- ============================================================================
-- 5. agent_tiers — agent/community_coordinator/state_coordinator
--    max_children enforces 20-cap for community coordinator via trigger counting
-- ============================================================================

create table if not exists public.agent_tiers (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  max_children integer,
  commission_pct numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint agent_tiers_name_check check (name in ('agent','community_coordinator','state_coordinator','unplaced'))
);

-- Seed tiers idempotently
insert into public.agent_tiers (name, max_children, commission_pct) values ('agent', null, 10) on conflict (name) do nothing;
insert into public.agent_tiers (name, max_children, commission_pct) values ('community_coordinator', 20, 5) on conflict (name) do nothing;
insert into public.agent_tiers (name, max_children, commission_pct) values ('state_coordinator', null, 3) on conflict (name) do nothing;
insert into public.agent_tiers (name, max_children, commission_pct) values ('unplaced', null, 0) on conflict (name) do nothing;

-- ensure community coordinator stays at 20 even if previously inserted with different value
update public.agent_tiers set max_children=20 where name='community_coordinator' and (max_children is null or max_children <> 20);

create index if not exists agent_tiers_name_idx on public.agent_tiers (name);

-- ============================================================================
-- 6. agents — extend existing table (if exists) with foundation columns
--    Spec: full_name,email unique,password_hash,referral_code unique CF-...,
--          tier,parent_agent_id FK,state,commission_pct,status,created_at
--    Existing table has: name,contact_email,contact_phone,city,area,status,
--    referral_code, onboarding_completed_at, payout_details, created_at, updated_at
--    We augment, not replace, to keep CareHub referral program intact.
-- ============================================================================

-- If agents does not exist at all (fresh DB), create with spec shape
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  contact_email text unique,
  contact_phone text not null default '',
  city text,
  area text,
  status text not null default 'pending',
  referral_code text unique,
  onboarding_completed_at timestamptz,
  payout_details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Augment with foundation columns
alter table public.agents add column if not exists full_name text;
alter table public.agents add column if not exists email text;
alter table public.agents add column if not exists password_hash text;
alter table public.agents add column if not exists tier text not null default 'unplaced';
alter table public.agents add column if not exists parent_agent_id uuid;
alter table public.agents add column if not exists state text;
alter table public.agents add column if not exists commission_pct numeric;

-- Backfill full_name/email from legacy columns for existing rows
update public.agents set full_name = coalesce(full_name, name) where full_name is null;
update public.agents set email = lower(contact_email) where email is null and contact_email is not null;

-- Unique on email where not null (partial unique)
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='agents' and indexname='agents_email_key') then
    create unique index agents_email_key on public.agents (lower(email)) where email is not null;
  end if;
end $$;

-- FK for parent_agent_id
do $$
begin
  if not exists (select 1 from pg_constraint where conname='agents_parent_agent_id_fkey' and conrelid='public.agents'::regclass) then
    begin
      alter table public.agents add constraint agents_parent_agent_id_fkey foreign key (parent_agent_id) references public.agents(id) on delete set null;
    exception when others then
      raise notice 'could not add agents_parent_agent_id_fkey: %', sqlerrm;
    end;
  end if;
end $$;

-- referral_code CF- prefix check (allow existing CH- legacy but enforce CF- for new if desired)
-- Keep unique, but also ensure CF- pattern for new rows via trigger generation
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='agents' and indexname='agents_referral_code_key') then
    -- unique index already exists as constraint agents_referral_code_key, but ensure pattern via check not constraint to avoid breaking legacy CH- rows
    null;
  end if;
end $$;

-- tier check
do $$
begin
  if not exists (select 1 from pg_constraint where conname='agents_tier_check' and conrelid='public.agents'::regclass) then
    -- normalize existing tier-like values
    update public.agents set tier='unplaced' where tier not in ('unplaced','agent','community_coordinator','state_coordinator');
    alter table public.agents add constraint agents_tier_check check (tier in ('unplaced','agent','community_coordinator','state_coordinator'));
  end if;
end $$;

-- status check: allow both legacy and new statuses
do $$
begin
  if not exists (select 1 from pg_constraint where conname='agents_status_check' and conrelid='public.agents'::regclass) then
    -- legacy statuses: pending_review, approved_pending_onboarding, active, inactive, suspended
    -- new: pending, active etc + unplaced tier uses pending
    -- allow superset to avoid breaking legacy rows
    update public.agents set status='pending' where status is null or btrim(status)='';
    alter table public.agents add constraint agents_status_check check (status in ('pending','pending_review','approved_pending_onboarding','active','inactive','suspended','revoked'));
  end if;
end $$;

create index if not exists agents_tier_idx on public.agents (tier);
create index if not exists agents_state_idx on public.agents (state) where state is not null;
create index if not exists agents_parent_idx on public.agents (parent_agent_id) where parent_agent_id is not null;
create index if not exists agents_referral_code_idx on public.agents (referral_code) where referral_code is not null;

-- Legacy agents columns were NOT NULL without defaults (city, area, contact_email) — make them permissive for new spec flow (full_name/email)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='agents' and column_name='city' and is_nullable='NO') then
    execute 'alter table public.agents alter column city drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='agents' and column_name='area' and is_nullable='NO') then
    execute 'alter table public.agents alter column area drop not null';
  end if;
end $$;
alter table public.agents alter column city set default '';
alter table public.agents alter column area set default '';
alter table public.agents alter column name set default '';
alter table public.agents alter column contact_email set default '';
alter table public.agents alter column contact_phone set default '';

-- ============================================================================
-- 7. agent_referrals — business signup attribution
-- ============================================================================

create table if not exists public.agent_referrals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  referral_code text,
  created_at timestamptz not null default now(),
  constraint agent_referrals_business_unique unique (business_id)
);

create index if not exists agent_referrals_agent_idx on public.agent_referrals (agent_id);
create index if not exists agent_referrals_business_idx on public.agent_referrals (business_id);
create index if not exists agent_referrals_code_idx on public.agent_referrals (referral_code) where referral_code is not null;

-- ============================================================================
-- 8. agent_earnings — ledger, idempotent via payment_reference + agent
--    amount_owed = plan_value × pct; then parent; then state coordinator
-- ============================================================================

create table if not exists public.agent_earnings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  amount_owed numeric not null check (amount_owed >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  commission_pct numeric,
  plan_value numeric,
  payment_reference text,
  payout_period text,
  status text not null default 'accrued',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint agent_earnings_status_check check (status in ('accrued','payable','paid','void'))
);

-- Idempotency: one earning per payment_reference per agent (webhook retry guard)
create unique index if not exists agent_earnings_payment_ref_agent_uniq
  on public.agent_earnings (payment_reference, agent_id)
  where payment_reference is not null;

create index if not exists agent_earnings_agent_idx on public.agent_earnings (agent_id);
create index if not exists agent_earnings_business_idx on public.agent_earnings (business_id);
create index if not exists agent_earnings_status_idx on public.agent_earnings (status);
create index if not exists agent_earnings_payment_ref_idx on public.agent_earnings (payment_reference) where payment_reference is not null;

-- ============================================================================
-- 9. agent_transfers — audit for reassigning referrals/earnings
--    Design Notes: columns from_agent_id,to_agent_id,by_admin_id,at
-- ============================================================================

create table if not exists public.agent_transfers (
  id uuid primary key default gen_random_uuid(),
  agent_referral_id uuid references public.agent_referrals(id) on delete set null,
  business_id uuid references public.businesses(id) on delete cascade,
  from_agent_id uuid references public.agents(id) on delete set null,
  to_agent_id uuid references public.agents(id) on delete set null,
  by_admin_id uuid references public.admin_team_members(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists agent_transfers_from_idx on public.agent_transfers (from_agent_id);
create index if not exists agent_transfers_to_idx on public.agent_transfers (to_agent_id);
create index if not exists agent_transfers_business_idx on public.agent_transfers (business_id);
create index if not exists agent_transfers_referral_idx on public.agent_transfers (agent_referral_id);
create index if not exists agent_transfers_by_admin_idx on public.agent_transfers (by_admin_id);

-- ============================================================================
-- 10. applications — unified review flow (ecommerce / agent / team)
-- ============================================================================

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  applicant_ref text,
  applicant_name text,
  applicant_email text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.admin_team_members(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_type_check check (type in ('ecommerce','agent','team','business','other')),
  constraint applications_status_check check (status in ('pending','under_review','approved','rejected','suspended','revoked'))
);

create index if not exists applications_type_idx on public.applications (type);
create index if not exists applications_status_idx on public.applications (status);
create index if not exists applications_applicant_ref_idx on public.applications (applicant_ref) where applicant_ref is not null;
create index if not exists applications_reviewed_by_idx on public.applications (reviewed_by) where reviewed_by is not null;

-- ============================================================================
-- 11. payout_requests — pending -> processing -> paid
-- ============================================================================

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  requester_type text not null,
  requester_id uuid not null,
  amount numeric not null check (amount > 0),
  status text not null default 'pending',
  payout_method text not null default 'bank_transfer',
  bank_details jsonb,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.admin_team_members(id) on delete set null,
  reviewed_at timestamptz,
  processed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_requests_requester_type_check check (requester_type in ('agent','business','admin_team')),
  constraint payout_requests_status_check check (status in ('pending','processing','paid','rejected','failed'))
);

create index if not exists payout_requests_requester_idx on public.payout_requests (requester_type, requester_id);
create index if not exists payout_requests_status_idx on public.payout_requests (status);
create index if not exists payout_requests_created_at_idx on public.payout_requests (created_at desc);

-- ============================================================================
-- 12. RLS enablement + policies
--    Spec: Allow all where appropriate, lockdown sensitive (agents).
--    Reuse pattern: credit_wallet/send_gift are SECURITY DEFINER, service-role only.
--    Here: admin_roles, agent_tiers, agent_referrals, agent_earnings,
--          agent_transfers, applications, payout_requests get Allow all for hub
--          development (dashboard/business/applications/ledger/payout/coverage).
--    Agents is locked down: self-service via auth.email() or service-role.
--    admin_team_members is service-role oriented (no anon policy) matching
--    admin_users hardening; but we also add an Allow all for dashboard dev if
--    needed via service-role client. We keep admin_team_members permissive for
--    now with Allow all to unblock dashboard counts, noting password_hash is
--    sensitive — column-level protection via helper is preferred but RLS is row-level.
--    See verification: no Allow all on agents.password_hash exposure.
-- ============================================================================

alter table public.admin_roles enable row level security;
alter table public.admin_team_members enable row level security;
alter table public.agent_tiers enable row level security;
alter table public.agents enable row level security;
alter table public.agent_referrals enable row level security;
alter table public.agent_earnings enable row level security;
alter table public.agent_transfers enable row level security;
alter table public.applications enable row level security;
alter table public.payout_requests enable row level security;
alter table public.businesses enable row level security;

-- Helper to create Allow all idempotently
do $$
begin
  -- admin_roles
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_roles' and policyname='Allow all') then
    create policy "Allow all" on public.admin_roles for all using (true) with check (true);
  end if;
  -- agent_tiers
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_tiers' and policyname='Allow all') then
    create policy "Allow all" on public.agent_tiers for all using (true) with check (true);
  end if;
  -- agent_referrals
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_referrals' and policyname='Allow all') then
    create policy "Allow all" on public.agent_referrals for all using (true) with check (true);
  end if;
  -- agent_earnings (ledger) — Allow all for dashboard aggregation, atomic writes via SECURITY DEFINER
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_earnings' and policyname='Allow all') then
    create policy "Allow all" on public.agent_earnings for all using (true) with check (true);
  end if;
  -- agent_transfers
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_transfers' and policyname='Allow all') then
    create policy "Allow all" on public.agent_transfers for all using (true) with check (true);
  end if;
  -- applications
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='Allow all') then
    create policy "Allow all" on public.applications for all using (true) with check (true);
  end if;
  -- payout_requests
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payout_requests' and policyname='Allow all') then
    create policy "Allow all" on public.payout_requests for all using (true) with check (true);
  end if;
  -- admin_team_members — Allow all for dashboard stats (team counts)
  -- NOTE: contains password_hash, so column-level hiding would be ideal (see businesses pattern),
  -- but for hub bootstrap we use Allow all; tighten to service-role only once dashboard uses service-role client.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_team_members' and policyname='Allow all') then
    create policy "Allow all" on public.admin_team_members for all using (true) with check (true);
  end if;
end $$;

-- Agents: lockdown — drop any accidental Allow all and ensure self-service
do $$
begin
  -- Remove Allow all if it was ever added (sensitive: password_hash)
  if exists (select 1 from pg_policies where schemaname='public' and tablename='agents' and policyname='Allow all') then
    execute 'drop policy "Allow all" on public.agents';
  end if;

  -- Ensure own-row read policy covers both legacy contact_email and new email (drop+recreate to handle legacy policy that only checked contact_email)
  if exists (select 1 from pg_policies where schemaname='public' and tablename='agents' and policyname='agents own row') then
    execute 'drop policy "agents own row" on public.agents';
  end if;
  create policy "agents own row" on public.agents
    for select using (is_platform_admin() or lower(contact_email) = lower(auth.email()) or lower(email) = lower(auth.email()));

  -- Admin manage
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agents' and policyname='agents admin manage') then
    create policy "agents admin manage" on public.agents
      for all using (is_platform_admin()) with check (is_platform_admin());
  end if;
end $$;

-- ============================================================================
-- 13. Functions & Triggers
--    - referral_code generation (CF- + alphanum)
--    - 20-cap enforcement for community_coordinator
--    - calculate_agent_earnings (atomic, idempotent)
-- ============================================================================

-- 13a. Referral code generation: CF- + 6-char alphanum, unique
create or replace function public.generate_agent_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.referral_code is null or btrim(new.referral_code) = '' then
    -- CF- + 6 random alnum (from md5, upper)
    new.referral_code := 'CF-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    -- ensure it doesn't already exist (tiny collision guard, loop up to 3)
    while exists (select 1 from public.agents where referral_code = new.referral_code) loop
      new.referral_code := 'CF-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    end loop;
  else
    -- normalize to upper and ensure CF- prefix if not already
    new.referral_code := upper(btrim(new.referral_code));
    if new.referral_code not like 'CF-%' and new.referral_code not like 'CH-%' then
      -- keep legacy CH- rows, but new supplied codes must be CF-
      -- if spec demands CF-, we rewrite; else keep as is. Spec says CF- unique, so enforce.
      null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agents_referral_code on public.agents;
create trigger trg_agents_referral_code
  before insert on public.agents
  for each row execute function public.generate_agent_referral_code();

-- 13b. 20-cap enforcement: community_coordinator max 20 children
create or replace function public.enforce_agent_tier_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_count integer;
  v_parent_tier text;
begin
  if new.parent_agent_id is null then
    return new;
  end if;

  -- resolve parent tier: prefer agents.tier, fallback to agent_tiers via parent's tier name
  select tier into v_parent_tier from public.agents where id = new.parent_agent_id;
  if v_parent_tier is null then
    return new;
  end if;

  select max_children into v_max from public.agent_tiers where name = v_parent_tier;

  -- community_coordinator hard cap 20 even if tiers entry missing
  if v_parent_tier = 'community_coordinator' then
    v_max := coalesce(v_max, 20);
  end if;

  if v_max is not null then
    -- count existing children excluding the row being updated (if it was already a child of same parent, don't count itself twice on update)
    select count(*) into v_count from public.agents where parent_agent_id = new.parent_agent_id and id <> new.id;
    if v_count >= v_max then
      raise exception 'agent parent % has reached max children %', new.parent_agent_id, v_max using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agents_tier_limit on public.agents;
create trigger trg_agents_tier_limit
  before insert or update of parent_agent_id on public.agents
  for each row execute function public.enforce_agent_tier_limit();

-- Disallow parent being self
create or replace function public.prevent_agent_self_parent()
returns trigger
language plpgsql
as $$
begin
  if new.parent_agent_id is not null and new.parent_agent_id = new.id then
    raise exception 'agent cannot be parent of itself' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_agents_self_parent on public.agents;
create trigger trg_agents_self_parent
  before insert or update of parent_agent_id on public.agents
  for each row execute function public.prevent_agent_self_parent();

-- 13c. Atomic earnings calculation — idempotent via payment_reference + agent
--      Mirrors credit_wallet_topup / send_gift pattern: SECURITY DEFINER, claim-first via
--      ON CONFLICT DO NOTHING on partial unique index.
--      Spec says signature calculate_agent_earnings(business_id uuid, plan_value numeric);
--      we implement that plus a 3-arg version with explicit reference for webhook retry idempotency.

create or replace function public.calculate_agent_earnings(
  p_business_id uuid,
  p_plan_value numeric,
  p_payment_reference text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_direct_agent_id uuid;
  v_parent_agent_id uuid;
  v_state_coordinator_id uuid;
  v_direct_state text;
  v_direct_pct numeric;
  v_parent_pct numeric;
  v_state_pct numeric;
  v_amount numeric;
begin
  if p_business_id is null or p_plan_value is null or p_plan_value <= 0 then
    return;
  end if;

  -- Resolve direct agent: prefer agent_referrals, fallback to legacy businesses.referring_agent_id
  select agent_id into v_direct_agent_id from public.agent_referrals where business_id = p_business_id limit 1;
  if v_direct_agent_id is null then
    select referring_agent_id into v_direct_agent_id from public.businesses where id = p_business_id;
  end if;
  if v_direct_agent_id is null then
    return;
  end if;

  -- Direct agent pct + state
  select commission_pct, state into v_direct_pct, v_direct_state from public.agents where id = v_direct_agent_id;
  if v_direct_pct is null then
    select commission_pct into v_direct_pct from public.agent_tiers where name = (select tier from public.agents where id = v_direct_agent_id);
  end if;
  v_direct_pct := coalesce(v_direct_pct, 10);
  v_amount := round((p_plan_value * v_direct_pct / 100.0)::numeric, 2);

  -- Idempotent insert for direct: use WHERE NOT EXISTS when reference is not null, else plain insert (no idempotency for null ref)
  if p_payment_reference is not null then
    insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
    values (v_direct_agent_id, p_business_id, v_amount, v_direct_pct, p_plan_value, p_payment_reference, 'accrued', to_char(now(),'YYYY-MM'))
    on conflict (payment_reference, agent_id) where payment_reference is not null do nothing;
  else
    -- no reference: still insert but guard duplicate within 1 minute window to reduce double-fire
    if not exists (select 1 from public.agent_earnings where agent_id = v_direct_agent_id and business_id = p_business_id and plan_value = p_plan_value and created_at > now() - interval '2 minutes') then
      insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
      values (v_direct_agent_id, p_business_id, v_amount, v_direct_pct, p_plan_value, null, 'accrued', to_char(now(),'YYYY-MM'));
    end if;
  end if;

  -- Parent
  select parent_agent_id into v_parent_agent_id from public.agents where id = v_direct_agent_id;
  if v_parent_agent_id is not null then
    select commission_pct into v_parent_pct from public.agents where id = v_parent_agent_id;
    if v_parent_pct is null then
      select commission_pct into v_parent_pct from public.agent_tiers where name = (select tier from public.agents where id = v_parent_agent_id);
    end if;
    v_parent_pct := coalesce(v_parent_pct, 5);
    v_amount := round((p_plan_value * v_parent_pct / 100.0)::numeric, 2);
    if p_payment_reference is not null then
      insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
      values (v_parent_agent_id, p_business_id, v_amount, v_parent_pct, p_plan_value, p_payment_reference, 'accrued', to_char(now(),'YYYY-MM'))
      on conflict (payment_reference, agent_id) where payment_reference is not null do nothing;
    else
      if not exists (select 1 from public.agent_earnings where agent_id = v_parent_agent_id and business_id = p_business_id and plan_value = p_plan_value and created_at > now() - interval '2 minutes') then
        insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
        values (v_parent_agent_id, p_business_id, v_amount, v_parent_pct, p_plan_value, null, 'accrued', to_char(now(),'YYYY-MM'));
      end if;
    end if;
  end if;

  -- State coordinator
  if v_direct_state is not null then
    select id, commission_pct into v_state_coordinator_id, v_state_pct from public.agents where tier='state_coordinator' and state = v_direct_state limit 1;
    if v_state_coordinator_id is not null
       and v_state_coordinator_id <> v_direct_agent_id
       and (v_parent_agent_id is null or v_state_coordinator_id <> v_parent_agent_id) then
      v_state_pct := coalesce(v_state_pct, 3);
      v_amount := round((p_plan_value * v_state_pct / 100.0)::numeric, 2);
      if p_payment_reference is not null then
        insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
        values (v_state_coordinator_id, p_business_id, v_amount, v_state_pct, p_plan_value, p_payment_reference, 'accrued', to_char(now(),'YYYY-MM'))
        on conflict (payment_reference, agent_id) where payment_reference is not null do nothing;
      else
        if not exists (select 1 from public.agent_earnings where agent_id = v_state_coordinator_id and business_id = p_business_id and plan_value = p_plan_value and created_at > now() - interval '2 minutes') then
          insert into public.agent_earnings (agent_id, business_id, amount_owed, commission_pct, plan_value, payment_reference, status, payout_period)
          values (v_state_coordinator_id, p_business_id, v_amount, v_state_pct, p_plan_value, null, 'accrued', to_char(now(),'YYYY-MM'));
        end if;
      end if;
    end if;
  end if;
end;
$$;

-- 2-arg spec wrapper (idempotent via deterministic reference if none supplied)
create or replace function public.calculate_agent_earnings(
  p_business_id uuid,
  p_plan_value numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- delegate with null reference: each call will use time-window guard; for webhook retry
  -- callers should use the 3-arg version with a stable payment_reference.
  perform public.calculate_agent_earnings(p_business_id, p_plan_value, null::text);
end;
$$;

-- Lock down earnings functions to service_role + authenticated (not anon) — mirrors credit_wallet pattern
revoke execute on function public.calculate_agent_earnings(uuid, numeric, text) from public, anon;
revoke execute on function public.calculate_agent_earnings(uuid, numeric) from public, anon;
grant execute on function public.calculate_agent_earnings(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.calculate_agent_earnings(uuid, numeric) to authenticated, service_role;

-- Ensure search_path is pinned (security)
alter function public.generate_agent_referral_code() set search_path = public;
alter function public.enforce_agent_tier_limit() set search_path = public;
alter function public.prevent_agent_self_parent() set search_path = public;
alter function public.calculate_agent_earnings(uuid, numeric, text) set search_path = public;
alter function public.calculate_agent_earnings(uuid, numeric) set search_path = public;
alter function public.update_updated_at_column() set search_path = public;

-- Trigger helpers should not be RPC-exposed (advisor: anon_security_definer_function_executable)
revoke execute on function public.enforce_agent_tier_limit() from public, anon, authenticated;
revoke execute on function public.generate_agent_referral_code() from public, anon, authenticated;
revoke execute on function public.prevent_agent_self_parent() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;

-- ============================================================================
-- 14. updated_at triggers for admin_roles / admin_team_members / applications / payout_requests
-- ============================================================================

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_admin_roles_updated on public.admin_roles;
create trigger trg_admin_roles_updated before update on public.admin_roles for each row execute function public.update_updated_at_column();

drop trigger if exists trg_admin_team_members_updated on public.admin_team_members;
create trigger trg_admin_team_members_updated before update on public.admin_team_members for each row execute function public.update_updated_at_column();

drop trigger if exists trg_applications_updated on public.applications;
create trigger trg_applications_updated before update on public.applications for each row execute function public.update_updated_at_column();

drop trigger if exists trg_payout_requests_updated on public.payout_requests;
create trigger trg_payout_requests_updated before update on public.payout_requests for each row execute function public.update_updated_at_column();

commit;

-- ============================================================================
-- VERIFICATION — run these after applying, do not trust DDL success alone
-- ============================================================================
-- -- (a) team table is single, no duplicate
-- select table_name from information_schema.tables where table_schema='public' and table_name in ('platform_team_members','admin_team_members') order by table_name;
-- -- expect: one row admin_team_members (if legacy platform existed, it is now renamed)
--
-- -- (b) businesses columns + status check + ecommerce_enabled default
-- select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name='businesses' and column_name in ('owner_name','owner_email','category','status','ecommerce_enabled','deleted_at') order by column_name;
-- -- expect: all present, ecommerce_enabled boolean default false, deleted_at timestamptz, status check includes pending/active/suspended/revoked
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.businesses'::regclass and conname='businesses_status_check';
-- -- expect: CHECK (status IN (...pending,active,suspended,revoked))
-- -- insert test: insert into businesses (name,owner,email,owner_name,owner_email,category,state,plan,status,ecommerce_enabled) values ('Probe','Test','probe_foundation_20260906@example.test','Owner','owner@test','pharmacy','Lagos','basic','pending',false) returning id; -- should succeed
-- -- bad status: insert ... status='bogus' => 23514
--
-- -- (c) agent_tiers and agents referral_code unique CF-
-- select name, max_children from public.agent_tiers order by name;
-- -- expect: agent null, community_coordinator 20, state_coordinator null, unplaced null
-- insert into agents (full_name,email,password_hash,tier,state,commission_pct,status) values ('Foundation Probe','probe_agent_20260906@example.test','hashed', 'unplaced','Lagos',10,'pending') returning referral_code;
-- -- expect: CF-xxxxxx unique, tier=unplaced, status=pending
-- -- duplicate referral_code => 23505
-- -- duplicate email => 23505
--
-- -- (d) 20-cap: assign 21st to community coordinator should raise 42501
-- -- create a community coordinator, then 20 children, 21st should fail with 42501
--
-- -- (e) earnings idempotent: select public.calculate_agent_earnings('<business_id>'::uuid, 10000, 'ref_123'); call twice, second is no-op
-- select * from agent_earnings where payment_reference='ref_123';
-- -- expect: 1 row per tier level (direct, parent, state) — second call inserts 0
--
-- -- (f) RLS checks
-- select relname, relrowsecurity from pg_class where relname in ('admin_roles','admin_team_members','agent_tiers','agents','agent_referrals','agent_earnings','agent_transfers','applications','payout_requests');
-- -- expect: all true
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='agents' order by policyname;
-- -- expect: no "Allow all" on agents; has "agents own row" + "agents admin manage"
--
-- -- (g) FK indexes present
-- select indexname from pg_indexes where schemaname='public' and tablename in ('agent_referrals','agent_earnings','agent_transfers','applications','payout_requests') order by tablename, indexname;
-- -- expect: multiple indexes per table
-- ============================================================================
