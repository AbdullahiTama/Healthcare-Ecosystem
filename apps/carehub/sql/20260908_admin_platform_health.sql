-- 20260908_admin_platform_health.sql
-- Platform Health Owner Console — P0 slice (H1 banner + H7 audit + feature flags)
-- Follow-up: H2 error inbox (Sentry/dead_letters), H3 migration tracker, H4 jobs, H5 abuse/storage, H1 health_checks polling
-- All tables service-role only (deny-all for anon/authenticated), append-only audit.

-- ── admin_incidents ──────────────────────────────────────────────────────────
create table if not exists admin_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null check (severity in ('amber','red')),
  is_maintenance boolean not null default false,
  pause_signups boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table admin_incidents enable row level security;
-- deny-all: drop any existing policies then leave zero, then add platform-admin-only
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='admin_incidents' loop execute format('drop policy %I on admin_incidents', r.policyname); end loop; end $$;
-- platform admin (is_platform_admin) can read/write; anon/auth non-admin get 0 (deny-all effectively)
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "admin_incidents_platform_admin" on admin_incidents for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

-- ── admin_health_checks ─────────────────────────────────────────────────────
create table if not exists admin_health_checks (
  id bigserial primary key,
  target text not null check (target in ('api','db','storage','paystack')),
  status text not null check (status in ('up','degraded','down')),
  latency_ms int,
  checked_at timestamptz not null default now()
);
alter table admin_health_checks enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='admin_health_checks' loop execute format('drop policy %I on admin_health_checks', r.policyname); end loop; end $$;
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "admin_health_checks_platform_admin" on admin_health_checks for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

-- ── admin_audit_log (append-only) ───────────────────────────────────────────
create table if not exists admin_audit_log (
  id bigserial primary key,
  actor_admin_id uuid,
  action text not null,
  target_table text not null,
  target_id text,
  before jsonb,
  after jsonb,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='admin_audit_log' loop execute format('drop policy %I on admin_audit_log', r.policyname); end loop; end $$;
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "admin_audit_log_platform_admin" on admin_audit_log for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

-- ── feature_flags ───────────────────────────────────────────────────────────
create table if not exists feature_flags (
  key text primary key check (key in ('ecommerce_enabled','booking_enabled','visible_on_carefind','maintenance_mode')),
  enabled boolean not null default true,
  rollout_pct int not null default 100 check (rollout_pct between 0 and 100),
  allowlist text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table feature_flags enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='feature_flags' loop execute format('drop policy %I on feature_flags', r.policyname); end loop; end $$;
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "feature_flags_platform_admin" on feature_flags for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

insert into feature_flags(key, enabled) values
  ('ecommerce_enabled', true),
  ('booking_enabled', true),
  ('visible_on_carefind', true),
  ('maintenance_mode', false)
on conflict (key) do nothing;

-- ── export_logs ─────────────────────────────────────────────────────────────
create table if not exists export_logs (
  id bigserial primary key,
  actor_admin_id uuid,
  export_type text not null,
  row_count int not null,
  reason text not null,
  watermark text not null,
  created_at timestamptz not null default now()
);
alter table export_logs enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='export_logs' loop execute format('drop policy %I on export_logs', r.policyname); end loop; end $$;
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "export_logs_platform_admin" on export_logs for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

-- ── dead_letters ────────────────────────────────────────────────────────────
create table if not exists dead_letters (
  id bigserial primary key,
  queue text not null check (queue in ('notifications','webhooks','payout_mismatch')),
  payload jsonb not null,
  error text not null,
  retries int not null default 0,
  status text not null default 'open' check (status in ('open','retried','dismissed')),
  created_at timestamptz not null default now()
);
alter table dead_letters enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='dead_letters' loop execute format('drop policy %I on dead_letters', r.policyname); end loop; end $$;
do $$ begin
  if exists (select 1 from pg_proc where proname='is_platform_admin') then
    execute 'create policy "dead_letters_platform_admin" on dead_letters for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  end if;
end $$;

-- helper: updated_at trigger for feature_flags
create or replace function update_updated_at_column() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_feature_flags_updated_at on feature_flags;
create trigger trg_feature_flags_updated_at before update on feature_flags for each row execute function update_updated_at_column();

-- indexes
create index if not exists idx_admin_incidents_created_at on admin_incidents(created_at desc);
create index if not exists idx_admin_audit_created_at on admin_audit_log(created_at desc);
create index if not exists idx_admin_health_checked_at on admin_health_checks(checked_at desc);
create index if not exists idx_export_logs_created_at on export_logs(created_at desc);
create index if not exists idx_dead_letters_queue on dead_letters(queue, status);

-- verification helper (behavioral): run after apply
-- select 'admin_incidents policies', count(*) from pg_policies where tablename='admin_incidents'; -- expect 0
-- select 'admin_audit_log rls', relrowsecurity from pg_class where relname='admin_audit_log'; -- expect true
