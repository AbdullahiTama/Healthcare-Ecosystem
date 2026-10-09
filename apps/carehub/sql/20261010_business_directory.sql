-- ============================================================================
-- Business Directory (Phase 1) + field-activity business link (Phase 3 hook)
--
-- Status: APPLIED to production project `carehub` (szdybxmgmhndoytqanfb) 2026-10-09,
-- in parts (the MCP migration call timed out on CREATE/DROP TRIGGER; the statements
-- were run individually and verified). Part 1 is recorded as
-- `carehub_business_directory_1_tables`; the rest ran via execute_sql.
-- Depends on: sql/20261009_staff_invitations_and_role_governance.sql
--             (is_staff_owner_level) and phase2_rls_pilot.sql
--             (current_business_ids, is_platform_admin). Re-runnable.
--
-- WHY `directory_*` AND NOT `businesses`
--   The specification suggests a table called `businesses`. In CareHub that
--   name is the TENANT table (login, plan, branches). Reusing it would collide
--   with, and endanger, authentication. The directory tables are therefore
--   prefixed. The spec's logical tables map as follows:
--     businesses            -> directory_businesses
--     business_locations    -> columns on directory_businesses (1:1)
--     business_contacts     -> columns on directory_businesses (1:1)
--     business_verification -> verification_* columns on directory_businesses
--     business_sources      -> data_source / source_detail + import_batch_id
--     business_categories   -> directory_categories
--     business_subcategories-> directory_subcategories
--     business_import_batches / _errors -> directory_import_batches / _errors
--   Splitting strictly 1:1 data across tables would add joins to every search
--   without any integrity gain; the column groups stay separable if a future
--   one-to-many need (several contacts per business) appears.
--
-- TENANCY
--   A directory belongs to a CareHub business (an enterprise team's own
--   prospect/territory database). Every row carries business_id and is scoped
--   exactly like every other tenant table. Reading is open to any member of the
--   business (reps run Discovery); writing needs can_manage_directory().
--
-- DEMO DATA RULE
--   data_source = 'demo' marks prototype records. The UI labels them
--   "DEMO DATA". This migration seeds NO businesses.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Permission helper
-- ----------------------------------------------------------------------------
-- Does a custom role grant canManageDirectory? Mirrors role_grants_staff_management.
-- Presets never grant it; only Owner-level actors and custom roles that the
-- Owner explicitly configured.
create or replace function public.role_grants_directory_management(p_business_id uuid, p_role text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (r.permissions ->> 'canManageDirectory') = 'true'
       from public.roles r
      where r.business_id = p_business_id and r.name = p_role
      limit 1),
    false)
$$;

create or replace function public.can_manage_directory(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_staff_owner_level(auth.email(), p_business_id)
      or exists (
        select 1 from public.staff s
         where s.business_id = p_business_id
           and lower(s.email) = lower(trim(auth.email()))
           and s.status = 'active'
           and public.role_grants_directory_management(s.business_id, s.role)
      )
$$;

-- Supabase grants EXECUTE directly to anon/authenticated on new functions, which
-- REVOKE FROM PUBLIC does not remove. Only can_manage_directory must stay callable
-- by authenticated (RLS policies evaluate it as the signed-in user).
revoke all on function public.role_grants_directory_management(uuid, text) from public, anon, authenticated;
revoke all on function public.can_manage_directory(uuid) from public, anon;
grant execute on function public.can_manage_directory(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Categories and subcategories
-- ----------------------------------------------------------------------------
-- business_id NULL = built-in category shared by every tenant (read-only to
-- tenants). A tenant may add its own and deactivate its own.
create table if not exists public.directory_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'facility' check (kind in ('facility', 'supplier', 'other')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_directory_categories_name
  on public.directory_categories (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

create table if not exists public.directory_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.directory_categories(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_directory_subcategories_name
  on public.directory_subcategories (category_id, lower(btrim(name)));

-- Built-in categories (spec §7). Idempotent via the unique index above.
insert into public.directory_categories (business_id, name, kind, sort_order)
select null, v.name, v.kind, v.ord
from (values
  ('Pharmacy', 'facility', 10), ('Hospital', 'facility', 20), ('Clinic', 'facility', 30),
  ('Medical Centre', 'facility', 40), ('Specialist Hospital', 'facility', 50),
  ('Primary Healthcare Centre', 'facility', 60), ('Maternity', 'facility', 70),
  ('Paediatric Centre', 'facility', 80), ('Cardiology Centre', 'facility', 90),
  ('Fertility/IVF Centre', 'facility', 100), ('Gynecology Centre', 'facility', 110),
  ('Physiotherapy/Rehabilitation', 'facility', 120), ('Dermatology', 'facility', 130),
  ('Dental Clinic', 'facility', 140), ('Eye Clinic/Optometry', 'facility', 150),
  ('Diagnostic Centre', 'facility', 160), ('Medical Laboratory', 'facility', 170),
  ('Imaging/Radiology Centre', 'facility', 180), ('Aesthetic/Cosmetic Centre', 'facility', 190),
  ('Pharmaceutical Manufacturer', 'supplier', 200), ('Pharmaceutical Importer', 'supplier', 210),
  ('Pharmaceutical Distributor', 'supplier', 220), ('Pharmaceutical Wholesaler', 'supplier', 230),
  ('Medical Equipment Company', 'supplier', 240), ('Medical Equipment Supplier', 'supplier', 250),
  ('Healthcare Supplier', 'supplier', 260), ('Cosmetics Business', 'other', 270),
  ('Other Healthcare-related Business', 'other', 280)
) as v(name, kind, ord)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. Import batches / errors
-- ----------------------------------------------------------------------------
create table if not exists public.directory_import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  file_name text,
  total_rows integer not null default 0,
  new_count integer not null default 0,
  possible_duplicate_count integer not null default 0,
  confirmed_duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  review_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  status text not null default 'importing'
    check (status in ('importing', 'completed', 'failed', 'cancelled')),
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_directory_import_batches_business
  on public.directory_import_batches (business_id, created_at desc);

create table if not exists public.directory_import_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.directory_import_batches(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  row_number integer,
  field text,
  message text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_directory_import_errors_batch on public.directory_import_errors (batch_id);

-- ----------------------------------------------------------------------------
-- 4. The directory itself
-- ----------------------------------------------------------------------------
create table if not exists public.directory_businesses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),
  name_normalized text not null check (length(name_normalized) > 0),
  category_id uuid references public.directory_categories(id) on delete set null,
  subcategory_id uuid references public.directory_subcategories(id) on delete set null,
  business_type text,

  address text,
  address_normalized text,
  state text,
  lga text,
  city text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  constraint directory_businesses_coords_pair check ((latitude is null) = (longitude is null)),

  phone text,
  phone_normalized text,
  email text,
  website text,
  website_host text,
  contact_person text,
  opening_hours text,
  description text,

  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by text,
  data_source text not null default 'manual'
    check (data_source in ('manual', 'import', 'external', 'demo')),
  source_detail text,
  import_batch_id uuid references public.directory_import_batches(id) on delete set null,

  -- Territory intelligence (Phase 4): a business can be pinned to one of the
  -- tenant's territories. Nullable; state/lga above are the coarse fallback.
  territory_id uuid references public.territories(id) on delete set null,

  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate-detection blocking keys and search paths. Every index leads with
-- business_id: no query is ever tenant-unscoped.
create index if not exists idx_dirbiz_tenant_active   on public.directory_businesses (business_id, is_active);
create index if not exists idx_dirbiz_name_norm       on public.directory_businesses (business_id, name_normalized);
create index if not exists idx_dirbiz_phone_norm      on public.directory_businesses (business_id, phone_normalized) where phone_normalized is not null;
create index if not exists idx_dirbiz_website_host    on public.directory_businesses (business_id, website_host) where website_host is not null;
create index if not exists idx_dirbiz_geo             on public.directory_businesses (business_id, latitude, longitude) where latitude is not null;
create index if not exists idx_dirbiz_recent         on public.directory_businesses (business_id, created_at desc, id);
create index if not exists idx_dirbiz_category        on public.directory_businesses (business_id, category_id);
create index if not exists idx_dirbiz_state_lga       on public.directory_businesses (business_id, state, lga);
create index if not exists idx_dirbiz_territory       on public.directory_businesses (territory_id) where territory_id is not null;
create index if not exists idx_dirbiz_batch           on public.directory_businesses (import_batch_id) where import_batch_id is not null;

-- Reports of incorrect information, raised from a business profile.
create table if not exists public.directory_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  directory_business_id uuid not null references public.directory_businesses(id) on delete cascade,
  reported_by text,
  message text not null check (length(btrim(message)) > 0),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_directory_reports_business on public.directory_reports (business_id, status);

-- Pairs an administrator has reviewed and decided are NOT the same business, so
-- the duplicate review does not offer them again. Ids are stored ordered
-- (a_id < b_id) so a pair has exactly one row.
create table if not exists public.directory_duplicate_dismissals (
  business_id uuid not null references public.businesses(id) on delete cascade,
  a_id uuid not null references public.directory_businesses(id) on delete cascade,
  b_id uuid not null references public.directory_businesses(id) on delete cascade,
  dismissed_by text,
  created_at timestamptz not null default now(),
  primary key (a_id, b_id),
  check (a_id < b_id)
);
create index if not exists idx_directory_dismissals_business on public.directory_duplicate_dismissals (business_id);

-- ----------------------------------------------------------------------------
-- 5. Integrity triggers
-- ----------------------------------------------------------------------------
create or replace function public.directory_businesses_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  NEW.updated_at := now();
  if tg_op = 'UPDATE' and NEW.business_id is distinct from OLD.business_id then
    raise exception 'A directory record cannot be moved to another business';
  end if;
  -- A category/subcategory must be visible to the owning tenant (built-in or its own),
  -- and a subcategory must belong to the chosen category.
  if NEW.category_id is not null and not exists (
       select 1 from public.directory_categories c
        where c.id = NEW.category_id and (c.business_id is null or c.business_id = NEW.business_id)) then
    raise exception 'Category does not belong to this business';
  end if;
  if NEW.subcategory_id is not null and not exists (
       select 1 from public.directory_subcategories s
        where s.id = NEW.subcategory_id and s.category_id = NEW.category_id) then
    raise exception 'Subcategory does not belong to the selected category';
  end if;
  if NEW.territory_id is not null and not exists (
       select 1 from public.territories t
        where t.id = NEW.territory_id and t.business_id = NEW.business_id) then
    raise exception 'Territory does not belong to this business';
  end if;
  -- verified_at/by are system-owned.
  if NEW.verification_status = 'verified' and (tg_op = 'INSERT' or OLD.verification_status is distinct from 'verified') then
    NEW.verified_at := now();
    NEW.verified_by := coalesce(auth.email(), NEW.verified_by);
  elsif NEW.verification_status <> 'verified' then
    NEW.verified_at := null;
    NEW.verified_by := null;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_directory_businesses_guard on public.directory_businesses;
create trigger trg_directory_businesses_guard
  before insert or update on public.directory_businesses
  for each row execute function public.directory_businesses_guard();

create or replace function public.directory_touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin NEW.updated_at := now(); return NEW; end $$;
drop trigger if exists trg_directory_categories_touch on public.directory_categories;
create trigger trg_directory_categories_touch before update on public.directory_categories
  for each row execute function public.directory_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Row-level security
-- ----------------------------------------------------------------------------
alter table public.directory_categories     enable row level security;
alter table public.directory_subcategories  enable row level security;
alter table public.directory_businesses     enable row level security;
alter table public.directory_import_batches enable row level security;
alter table public.directory_import_errors  enable row level security;
alter table public.directory_reports        enable row level security;
alter table public.directory_duplicate_dismissals enable row level security;

revoke all on public.directory_categories, public.directory_subcategories, public.directory_businesses,
              public.directory_import_batches, public.directory_import_errors, public.directory_reports,
              public.directory_duplicate_dismissals
  from anon;

do $$
declare
  p record;
begin
  -- Drop our own policies so the migration is re-runnable.
  for p in select schemaname, tablename, policyname from pg_policies
            where schemaname = 'public' and policyname like 'dir\_%' escape '\'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Categories: built-ins readable by every signed-in tenant; tenant rows scoped.
create policy dir_categories_read on public.directory_categories for select to authenticated
  using (business_id is null or business_id in (select current_business_ids()) or is_platform_admin());
create policy dir_categories_insert on public.directory_categories for insert to authenticated
  with check (business_id is not null and public.can_manage_directory(business_id));
create policy dir_categories_update on public.directory_categories for update to authenticated
  using (business_id is not null and public.can_manage_directory(business_id))
  with check (business_id is not null and public.can_manage_directory(business_id));
create policy dir_categories_delete on public.directory_categories for delete to authenticated
  using (business_id is not null and public.can_manage_directory(business_id));
-- Built-in rows are changed by the platform admin only.
create policy dir_categories_platform_write on public.directory_categories for all to authenticated
  using (business_id is null and is_platform_admin())
  with check (business_id is null and is_platform_admin());

create policy dir_subcategories_read on public.directory_subcategories for select to authenticated
  using (business_id is null or business_id in (select current_business_ids()) or is_platform_admin());
create policy dir_subcategories_write on public.directory_subcategories for all to authenticated
  using (business_id is not null and public.can_manage_directory(business_id))
  with check (business_id is not null and public.can_manage_directory(business_id));

create policy dir_businesses_read on public.directory_businesses for select to authenticated
  using (business_id in (select current_business_ids()) or is_platform_admin());
create policy dir_businesses_write on public.directory_businesses for all to authenticated
  using (public.can_manage_directory(business_id))
  with check (public.can_manage_directory(business_id));

create policy dir_import_batches_manage on public.directory_import_batches for all to authenticated
  using (public.can_manage_directory(business_id))
  with check (public.can_manage_directory(business_id));
create policy dir_import_errors_manage on public.directory_import_errors for all to authenticated
  using (public.can_manage_directory(business_id))
  with check (public.can_manage_directory(business_id));

create policy dir_dismissals_manage on public.directory_duplicate_dismissals for all to authenticated
  using (public.can_manage_directory(business_id))
  with check (public.can_manage_directory(business_id)
              and exists (select 1 from public.directory_businesses d where d.id = a_id and d.business_id = directory_duplicate_dismissals.business_id)
              and exists (select 1 from public.directory_businesses d where d.id = b_id and d.business_id = directory_duplicate_dismissals.business_id));

-- Any member may flag incorrect information; only managers triage.
create policy dir_reports_insert on public.directory_reports for insert to authenticated
  with check (business_id in (select current_business_ids())
              and exists (select 1 from public.directory_businesses d
                           where d.id = directory_business_id and d.business_id = directory_reports.business_id));
create policy dir_reports_read on public.directory_reports for select to authenticated
  using (public.can_manage_directory(business_id) or reported_by = auth.email());
create policy dir_reports_update on public.directory_reports for update to authenticated
  using (public.can_manage_directory(business_id))
  with check (public.can_manage_directory(business_id));

-- ----------------------------------------------------------------------------
-- 7. Live Field Activity link (Phase 3)
-- ----------------------------------------------------------------------------
-- Additive and nullable: existing activities and the existing insert path are
-- untouched. The name is a snapshot because a field activity is an audit
-- record that must survive a directory record being edited or removed.
-- A value is set ONLY when the representative explicitly confirms a business
-- in the logger; GPS proximity alone never writes these columns.
alter table public.field_activities
  add column if not exists directory_business_id uuid references public.directory_businesses(id) on delete set null,
  add column if not exists directory_business_name text;
create index if not exists idx_field_activities_directory_business
  on public.field_activities (directory_business_id) where directory_business_id is not null;

create or replace function public.field_activities_directory_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.directory_business_id is not null and not exists (
       select 1 from public.directory_businesses d
        where d.id = NEW.directory_business_id and d.business_id = NEW.business_id) then
    raise exception 'Selected business does not belong to this business account';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_field_activities_directory_link on public.field_activities;
create trigger trg_field_activities_directory_link
  before insert or update of directory_business_id on public.field_activities
  for each row execute function public.field_activities_directory_link_guard();

-- Trigger functions are never called directly; remove the default direct grants.
revoke all on function public.directory_businesses_guard() from public, anon, authenticated;
revoke all on function public.directory_touch_updated_at() from public, anon, authenticated;
revoke all on function public.field_activities_directory_link_guard() from public, anon, authenticated;
