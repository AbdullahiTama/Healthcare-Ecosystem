-- 20260908_admin_money.sql — Money Control Plane Slice 1 (M2+M3)
-- Adds plan_catalog, business_subscriptions, paystack_events, invoices, dunning_jobs
-- All platform-admin RLS (like 20260908_admin_platform_health). Tenant reads via security_invoker view.

-- ── plan_catalog ─────────────────────────────────────────────────────────
create table if not exists plan_catalog (
  key text primary key check (char_length(key) between 1 and 64),
  name text not null,
  price_kobo int not null check (price_kobo >= 0),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly','lifetime')),
  trial_days int not null default 0 check (trial_days >= 0),
  entitlements jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table plan_catalog enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='plan_catalog' loop execute format('drop policy %I on plan_catalog', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "plan_catalog_platform_admin" on plan_catalog for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;

-- ── business_subscriptions ───────────────────────────────────────────────
create table if not exists business_subscriptions (
  business_id uuid primary key references businesses(id) on delete cascade,
  plan_key text not null references plan_catalog(key),
  status text not null check (status in ('trialing','active','past_due','suspended','canceled')),
  current_period_start date not null,
  current_period_end date not null,
  grace_until date,
  renew_attempts int not null default 0,
  last_payment_reference text
);
alter table business_subscriptions enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='business_subscriptions' loop execute format('drop policy %I on business_subscriptions', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "business_subscriptions_platform_admin" on business_subscriptions for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;

-- view: tenant's own entitlements (security_invoker so RLS still scopes)
create or replace view business_entitlements with (security_invoker = true) as
  select bs.business_id, pc.entitlements, pc.key as plan_key, pc.name as plan_name
  from business_subscriptions bs join plan_catalog pc on pc.key = bs.plan_key;

-- ── paystack_events (webhook mirror) ─────────────────────────────────────
create table if not exists paystack_events (
  id bigserial primary key,
  reference text unique not null,
  event_type text not null,
  amount_kobo int not null check (amount_kobo >= 0),
  currency text not null default 'NGN',
  status text not null,
  business_id uuid references businesses(id),
  raw jsonb not null,
  received_at timestamptz not null default now()
);
alter table paystack_events enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='paystack_events' loop execute format('drop policy %I on paystack_events', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "paystack_events_platform_admin" on paystack_events for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;
create index if not exists idx_paystack_reference on paystack_events(reference);
create index if not exists idx_paystack_received_at on paystack_events(received_at desc);

-- ── invoices (append-only, credit_note refunds) ──────────────────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  type text not null check (type in ('invoice','credit_note')),
  reference text unique not null,
  amount_kobo int not null,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table invoices enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='invoices' loop execute format('drop policy %I on invoices', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "invoices_platform_admin" on invoices for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;
create index if not exists idx_invoices_business on invoices(business_id, created_at desc);

-- ── dunning_jobs ─────────────────────────────────────────────────────────
create table if not exists dunning_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  attempt int not null default 0,
  next_attempt_at timestamptz not null,
  status text not null check (status in ('open','retrying','failed','recovered')),
  last_error text,
  created_at timestamptz not null default now()
);
alter table dunning_jobs enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='dunning_jobs' loop execute format('drop policy %I on dunning_jobs', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "dunning_jobs_platform_admin" on dunning_jobs for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;
create index if not exists idx_dunning_next on dunning_jobs(next_attempt_at) where status in ('open','retrying');

-- helper updated_at
create or replace function update_updated_at_column() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_plan_catalog_updated_at on plan_catalog;
create trigger trg_plan_catalog_updated_at before update on plan_catalog for each row execute function update_updated_at_column();

-- seed
insert into plan_catalog(key,name,price_kobo,billing_cycle,entitlements) values
  ('basic','Basic',0,'monthly','{}'),
  ('pro','Pro',1500000,'monthly','{"pharmacy":true,"ecommerce":true,"branches":3}'),
  ('enterprise','Enterprise',5000000,'monthly','{"pharmacy":true,"hospital":true,"lab":true,"ecommerce":true,"branches":99}')
on conflict (key) do nothing;

-- indexes
create index if not exists idx_business_subscriptions_end on business_subscriptions(current_period_end);
