-- 20260909_admin_ops_compliance.sql — Ops + Compliance P0
-- support_tickets + support_messages, compliance_requests, 1yr audit retention policy (doc)

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  user_id uuid,
  subject text not null,
  body text not null,
  status text not null check (status in ('open','triaged','waiting','resolved','closed')) default 'open',
  priority text not null check (priority in ('low','medium','high','urgent')) default 'medium',
  assignee_admin_id uuid references admin_team_members(id),
  sla_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_admin_id uuid references admin_team_members(id),
  body text not null,
  created_at timestamptz not null default now()
);
alter table support_tickets enable row level security;
alter table support_messages enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='support_tickets' loop execute format('drop policy %I on support_tickets', r.policyname); end loop; end $$;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='support_messages' loop execute format('drop policy %I on support_messages', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then
  execute 'create policy "support_tickets_platform_admin" on support_tickets for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
  execute 'create policy "support_messages_platform_admin" on support_messages for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
end if; end $$;
create index if not exists idx_tickets_status on support_tickets(status);
create index if not exists idx_tickets_assignee on support_tickets(assignee_admin_id);
create index if not exists idx_tickets_sla on support_tickets(sla_due_at) where status not in ('resolved','closed');
create or replace function update_updated_at_column() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_support_tickets_updated_at on support_tickets;
create trigger trg_support_tickets_updated_at before update on support_tickets for each row execute function update_updated_at_column();

create table if not exists compliance_requests (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('business','profile')),
  subject_id uuid not null,
  request_type text not null check (request_type in ('export','delete')),
  reason text not null,
  status text not null check (status in ('open','approved','rejected','completed')) default 'open',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table compliance_requests enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='compliance_requests' loop execute format('drop policy %I on compliance_requests', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then
  execute 'create policy "compliance_requests_platform_admin" on compliance_requests for all to authenticated using (is_platform_admin()) with check (is_platform_admin())';
end if; end $$;
create index if not exists idx_compliance_status on compliance_requests(status);
