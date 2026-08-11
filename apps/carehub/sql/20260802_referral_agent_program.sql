-- ============================================================================
-- CareHub Referral Agent Program
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql after the
-- code in this feature ships (verify-plan-payment.js writes plan_payments
-- with is_first_payment, so that column must exist first).
--
-- Implements planning/20260802_referral_agent_program_plan.md §3:
--   • agents                    — the referral representative ("area owner")
--   • agent_applications        — public application form (anon INSERT only)
--   • commissions               — the ledger; UNIQUE(payment_id) = idempotency guard
--   • commission_review_flags   — payments flagged when an agent is not active
--   • payouts                   — batch payout records (money transfer stays manual at v1)
--   • agent_support_logs        — per-business followup/training/feedback trail
--   • businesses += referring_agent_id, referral_code_used (attribution, immutable after signup)
--   • plan_payments += is_first_payment (computed once, server-side)
--   • BEFORE INSERT trigger on businesses — resolves referral codes server-side,
--     blocks self-referral (agent's own email), never trusts a client-supplied agent id
--   • get_agent_portfolio()     — SECURITY DEFINER RPC giving an agent their
--     BUSINESS portfolio WITHOUT exposing businesses rows (plaintext password
--     columns live there; row-level SELECT to agents would leak them)
--
-- RLS everywhere, using the live helpers current_business_ids() /
-- is_platform_admin() from sql/phase2_rls_pilot.sql (NOT redefined here).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text not null unique,
  contact_phone text not null default '',
  city text not null,
  area text not null,
  status text not null default 'pending_review',
    -- pending_review | approved_pending_onboarding | active | inactive | suspended
  referral_code text unique,              -- generated on approval; usable once active
  onboarding_completed_at timestamptz,
  payout_details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null,
  contact_email text not null,
  contact_phone text not null default '',
  requested_city text not null,
  requested_area text not null,
  applicant_details jsonb not null default '{}',  -- experience, references, motivation
  status text not null default 'submitted',
    -- submitted|under_review|approved|rejected
  reviewed_by uuid,            -- admin_team.id
  review_notes text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null unique references public.plan_payments(id),
  type text not null,          -- referral_bonus|residual
  amount numeric not null,
  rate numeric not null,
  status text not null default 'accrued',  -- accrued|payable|paid|void
  created_at timestamptz not null default now()
);

create table if not exists public.commission_review_flags (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.plan_payments(id),
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  commission_ids jsonb not null default '[]',
  total_amount numeric not null,
  method text not null default 'bank_transfer',  -- bank_transfer|wallet|mobile_money|other
  status text not null default 'pending',        -- pending|processed|failed
  notes text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_support_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  business_id uuid not null references public.businesses(id),
  kind text not null default 'followup',  -- followup|training|feedback
  details text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Existing-table additions
-- ---------------------------------------------------------------------------
alter table public.businesses add column if not exists referring_agent_id uuid references public.agents(id);
alter table public.businesses add column if not exists referral_code_used text;

alter table public.plan_payments add column if not exists is_first_payment boolean default false;

-- ---------------------------------------------------------------------------
-- 3. Referral attribution trigger — server-authoritative, fires for every INSERT.
--
-- The client may only ever submit referral_code_used (a code string, harmless).
-- referring_agent_id is derived here from the code + status + self-referral rule,
-- so a malicious client can never attach a business to an agent (or itself) by
-- writing the id directly.
-- ---------------------------------------------------------------------------
create or replace function public.apply_referring_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.agents%rowtype;
begin
  if new.referral_code_used is not null and btrim(new.referral_code_used) <> '' then
    select * into v_agent
      from public.agents
      where lower(referral_code) = lower(btrim(new.referral_code_used))
        and status = 'active'
      limit 1;

    -- No matching active agent, or the "agent" is the business owner themself
    -- (self-referral) → attribution fails closed, never guesses.
    if v_agent.id is not null
       and lower(v_agent.contact_email) <> lower(new.email) then
      new.referring_agent_id := v_agent.id;
    else
      new.referring_agent_id := null;
      new.referral_code_used := null;
    end if;
  else
    new.referring_agent_id := null;
  end if;
  return new;
end $$;

drop trigger if exists resolve_referring_agent on public.businesses;
create trigger resolve_referring_agent
  before insert on public.businesses
  for each row execute function public.apply_referring_agent();

-- ---------------------------------------------------------------------------
-- 4. Agent portfolio RPC — the ONLY way an agent reads their businesses.
-- Views as a safe column subset of their referred businesses so the plaintext
-- `businesses.password` column is never reachable through an agent session.
-- ---------------------------------------------------------------------------
create or replace function public.get_agent_portfolio()
returns table (
  id uuid,
  name text,
  business_type text,
  state text,
  plan text,
  plan_expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.business_type, b.state, b.plan, b.plan_expires_at, b.created_at
  from public.businesses b
  join public.agents a on a.id = b.referring_agent_id
  where lower(a.contact_email) = lower(auth.email())
$$;

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
create index if not exists agents_status_idx on public.agents (status);
create index if not exists agents_city_area_idx on public.agents (city, area);
create index if not exists agent_applications_status_idx on public.agent_applications (status);
create index if not exists commissions_agent_status_idx on public.commissions (agent_id, status);
create index if not exists commissions_business_idx on public.commissions (business_id);
create index if not exists payouts_agent_idx on public.payouts (agent_id);
create index if not exists agent_support_logs_agent_business_idx on public.agent_support_logs (agent_id, business_id);
create index if not exists businesses_referring_agent_idx on public.businesses (referring_agent_id);

-- ---------------------------------------------------------------------------
-- 6. RLS — all new tables
-- ---------------------------------------------------------------------------
alter table public.agents enable row level security;
alter table public.agent_applications enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_review_flags enable row level security;
alter table public.payouts enable row level security;
alter table public.agent_support_logs enable row level security;

-- agents: an agent reads their own row; everything else is platform admin.
drop policy if exists "agents own row" on public.agents;
create policy "agents own row" on public.agents
  for select using (is_platform_admin() or lower(contact_email) = lower(auth.email()));
drop policy if exists "agents admin manage" on public.agents;
create policy "agents admin manage" on public.agents
  for all using (is_platform_admin()) with check (is_platform_admin());

-- agent_applications: anon can submit (public form); only admin reviews.
drop policy if exists "agent_applications anon submit" on public.agent_applications;
create policy "agent_applications anon submit" on public.agent_applications
  for insert with check (true);
drop policy if exists "agent_applications admin manage" on public.agent_applications;
create policy "agent_applications admin manage" on public.agent_applications
  for all using (is_platform_admin()) with check (is_platform_admin());

-- commissions: no client INSERT/UPDATE ever (server function only). An agent
-- reads their own ledger; admin sees everything.
drop policy if exists "commissions own agent" on public.commissions;
create policy "commissions own agent" on public.commissions
  for select using (is_platform_admin() or agent_id in (
    select id from public.agents where lower(contact_email) = lower(auth.email())
  ));
drop policy if exists "commissions admin update" on public.commissions;
create policy "commissions admin update" on public.commissions
  for update using (is_platform_admin()) with check (is_platform_admin());

-- commission_review_flags: admin only views; written only by the server job.
drop policy if exists "commission_review_flags admin manage" on public.commission_review_flags;
create policy "commission_review_flags admin manage" on public.commission_review_flags
  for all using (is_platform_admin()) with check (is_platform_admin());

-- payouts: agent reads own batch history; admin manages.
drop policy if exists "payouts own agent" on public.payouts;
create policy "payouts own agent" on public.payouts
  for select using (is_platform_admin() or agent_id in (
    select id from public.agents where lower(contact_email) = lower(auth.email())
  ));
drop policy if exists "payouts admin manage" on public.payouts;
create policy "payouts admin manage" on public.payouts
  for all using (is_platform_admin()) with check (is_platform_admin());

-- agent_support_logs: agent reads + writes their own; admin manages.
drop policy if exists "agent_support_logs own agent" on public.agent_support_logs;
create policy "agent_support_logs own agent" on public.agent_support_logs
  for select using (is_platform_admin() or agent_id in (
    select id from public.agents where lower(contact_email) = lower(auth.email())
  ));
drop policy if exists "agent_support_logs own agent insert" on public.agent_support_logs;
create policy "agent_support_logs own agent insert" on public.agent_support_logs
  for insert with check (agent_id in (
    select id from public.agents where lower(contact_email) = lower(auth.email())
  ));
drop policy if exists "agent_support_logs admin manage" on public.agent_support_logs;
create policy "agent_support_logs admin manage" on public.agent_support_logs
  for update using (is_platform_admin()) with check (is_platform_admin());