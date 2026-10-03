-- 20260908_admin_trust.sql — Trust queue slice 1 (T1 read-only + foundation)
-- Adds moderation_actions, appeals, is_quarantined flags. All platform-admin RLS.

create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','product','review','verification','claim','report')),
  target_id uuid not null,
  action text not null check (action in ('quarantine','restore','approve','reject','delete')),
  reason text not null,
  actor_admin_id uuid references admin_team_members(id),
  created_at timestamptz not null default now()
);
alter table moderation_actions enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='moderation_actions' loop execute format('drop policy %I on moderation_actions', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "moderation_actions_platform_admin" on moderation_actions for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;

alter table posts add column if not exists is_quarantined boolean not null default false;
alter table products add column if not exists is_quarantined boolean not null default false;

create table if not exists moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  moderation_action_id uuid not null references moderation_actions(id) on delete cascade,
  appellant_id uuid not null,
  reason text not null,
  status text not null check (status in ('open','upheld','denied')) default 'open',
  created_at timestamptz not null default now()
);
alter table moderation_appeals enable row level security;
do $$ declare r record; begin for r in select policyname from pg_policies where tablename='moderation_appeals' loop execute format('drop policy %I on moderation_appeals', r.policyname); end loop; end $$;
do $$ begin if exists (select 1 from pg_proc where proname='is_platform_admin') then execute 'create policy "moderation_appeals_platform_admin" on moderation_appeals for all to authenticated using (is_platform_admin()) with check (is_platform_admin())'; end if; end $$;

create index if not exists idx_moderation_target on moderation_actions(target_type, target_id);
create index if not exists idx_appeals_status on moderation_appeals(status);
create index if not exists idx_posts_quarantined on posts(is_quarantined) where is_quarantined = true;
create index if not exists idx_products_quarantined on products(is_quarantined) where is_quarantined = true;
