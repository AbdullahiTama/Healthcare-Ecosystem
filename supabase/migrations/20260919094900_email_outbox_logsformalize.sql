-- Migration: Create email_outbox and email_logs tables with proper RLS
-- These tables were previously created via manual SQL scripts but had no migration file.
-- This migration formalizes them and tightens RLS to service-role only.

-- 1. Create tables (IF NOT EXISTS for idempotency)
create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  from_email text not null default 'CareHub <support@carehub.ng>',
  subject text not null,
  template_key text not null,
  payload jsonb not null default '{}',
  status text not null check (status in ('pending','sent','failed','bounced','complained','dead')) default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  provider_id text,
  opened_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  sent_at timestamptz,
  next_retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_logs (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references email_outbox(id) on delete cascade,
  event_type text not null check (event_type in ('enqueued','sent','delivered','opened','bounced','complained','failed','dead')),
  detail text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

-- 2. Indexes
create index if not exists idx_outbox_status on email_outbox(status, next_retry_at);
create index if not exists idx_outbox_template on email_outbox(template_key);
create index if not exists idx_outbox_created on email_outbox(created_at);
create index if not exists idx_logs_outbox on email_logs(outbox_id);
create index if not exists idx_logs_event on email_logs(event_type, created_at);

-- 3. Enable RLS
alter table email_outbox enable row level security;
alter table email_logs enable row level security;

-- 4. Drop any existing overly-permissive policies
do $$ declare r record; begin
  for r in select policyname from pg_policies where tablename='email_outbox' loop
    execute format('drop policy %I on email_outbox', r.policyname);
  end loop;
  for r in select policyname from pg_policies where tablename='email_logs' loop
    execute format('drop policy %I on email_logs', r.policyname);
  end loop;
end $$;

-- 5. No policies for anon/authenticated = blocked by RLS.
--    service_role bypasses RLS, so it retains full access.
--    This ensures only the API handlers (which use service-role) can touch these tables.

-- 6. Updated_at trigger
create or replace function update_email_outbox_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_email_outbox_updated_at on email_outbox;
create trigger trg_email_outbox_updated_at before update on email_outbox
  for each row execute function update_email_outbox_updated_at();
