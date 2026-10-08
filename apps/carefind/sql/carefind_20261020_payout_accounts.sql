-- Saved payout accounts for CareFind users and CareHub businesses (Phase 16 candidate).
-- One row per bank account; `is_default` marks the account used for withdrawals.
-- Status: pending_review -> verified (admin approved) / failed. Money never moves
-- based on this table alone — it is a convenience + trust signal on top of the
-- existing withdrawal engine, whose bank-name verification still runs at payout time.

create table if not exists public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  owner_business_id uuid,
  bank_code text not null,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'verified', 'failed')),
  bvn_last4 text,
  nin_last4 text,
  verified_at timestamptz,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  check (owner_user_id is not null or owner_business_id is not null)
);

-- Audit rows must outlive the account they describe: `remove` snapshots the
-- account identity into `meta` before deleting, and the FK nulls the link
-- (`on delete set null`) instead of cascading the history away.
create table if not exists public.payout_account_events (
  id bigint generated always as identity primary key,
  payout_account_id uuid references public.payout_accounts(id) on delete set null,
  actor uuid,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- at most one default per owner
create unique index if not exists payout_accounts_default_user_uniq
  on public.payout_accounts (owner_user_id) where is_default and owner_user_id is not null;
create unique index if not exists payout_accounts_default_business_uniq
  on public.payout_accounts (owner_business_id) where is_default and owner_business_id is not null;

alter table public.payout_accounts enable row level security;
alter table public.payout_account_events enable row level security;

revoke all on public.payout_accounts from public, anon, authenticated;
revoke all on public.payout_account_events from public, anon, authenticated;
grant select, insert, update on public.payout_accounts to service_role;
grant select, insert on public.payout_account_events to service_role;
