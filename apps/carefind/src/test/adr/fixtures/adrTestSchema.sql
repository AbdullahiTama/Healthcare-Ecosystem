-- Minimal production-shaped stubs the ADR migrations need but do not create.
-- Conventions follow apps/carefind/src/test/payments/fixtures/liveSchemaSubset.sql:
-- auth.uid()/auth.role()/auth.email() read request JWT claims; tests set them
-- with set_config(). is_platform_admin() is copied VERBATIM from
-- supabase/seeds/carehub_phase2_rls_pilot.sql:99-110 (it lives in seeds, not
-- in any migration, so it cannot be replayed — any drift from the live
-- definition must be reconciled here, and this comment is the marker).
-- current_business_ids() is REPLAYED from its real migration
-- (carehub_20260810_recursive_business_ids.sql), not stubbed, because route
-- visibility tests depend on its exact membership semantics.
-- Column lists mirror what the ADR migrations actually reference.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function auth.email() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
create table auth.users (id uuid primary key);

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(text) returns text[] language sql immutable as
  $$ select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1) - 1] $$;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  email text,
  owner text,
  is_platform_admin boolean default false,
  status text,
  business_type text,
  phone text,
  name text,
  city text,
  state text,
  parent_business_id uuid,
  branch_depth_limit integer default 5
);
alter table public.businesses enable row level security;

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  email text,
  status text,
  role text,
  auth_user_id uuid,
  full_name text
);
alter table public.staff enable row level security;

-- Custom business roles (mirrors the live `roles` table columns the ADR
-- recipient rule reads: business_id, name, permissions).
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  name text,
  permissions jsonb
);

create table public.admin_audit_log (
  id bigint primary key generated always as identity,
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
alter table public.admin_audit_log enable row level security;

create table public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  staff_id uuid,
  is_owner boolean,
  kind text,
  title text,
  body text,
  link text,
  created_at timestamptz not null default now()
);
alter table public.staff_notifications enable row level security;

-- VERBATIM from supabase/seeds/carehub_phase2_rls_pilot.sql:99-110.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  SELECT COALESCE(
    (SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())),
    false
  )
$$;
