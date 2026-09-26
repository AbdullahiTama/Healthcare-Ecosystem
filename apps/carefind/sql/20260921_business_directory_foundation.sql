-- ============================================================================
-- 20260921_business_directory_foundation.sql
--
-- Business Directory foundation for CareFind Hub.
-- Creates 7 tables, RLS policies, PostGIS proximity search RPC,
-- stats RPC, and seeds 28 healthcare categories.
-- ============================================================================

begin;

-- 1. Enable PostGIS
create extension if not exists postgis with schema extensions;

-- 2. business_categories
create table if not exists public.business_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  slug        text unique not null,
  description text,
  icon        text,
  color       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists business_categories_slug_idx on public.business_categories (slug);
create index if not exists business_categories_active_idx on public.business_categories (is_active) where is_active = true;

-- 3. business_subcategories
create table if not exists public.business_subcategories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.business_categories(id) on delete cascade,
  name        text not null,
  slug        text not null,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(category_id, slug)
);

create index if not exists business_subcategories_cat_idx on public.business_subcategories (category_id);

-- 4. business_directory — central business registry
create table if not exists public.business_directory (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  normalized_name     text not null,
  category_id         uuid references public.business_categories(id) on delete set null,
  subcategory_id      uuid references public.business_subcategories(id) on delete set null,
  business_type       text,
  address             text,
  state               text,
  lga                 text,
  city                text,
  area                text,
  latitude            double precision,
  longitude           double precision,
  location            geography(Point, 4326),
  phone               text,
  email               text,
  website             text,
  whatsapp            text,
  contact_person      text,
  opening_hours       jsonb,
  description         text,
  logo_url            text,
  cover_url           text,
  verification_status text not null default 'unverified',
  verified_at         timestamptz,
  verified_by         uuid,
  data_source         text not null default 'manual',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists business_directory_category_idx on public.business_directory (category_id);
create index if not exists business_directory_state_idx on public.business_directory (state);
create index if not exists business_directory_lga_idx on public.business_directory (lga);
create index if not exists business_directory_active_idx on public.business_directory (is_active) where is_active = true;
create index if not exists business_directory_normalized_name_idx on public.business_directory (normalized_name);
create index if not exists business_directory_location_idx on public.business_directory using gist (location);
create index if not exists business_directory_verification_idx on public.business_directory (verification_status);

-- Trigger to auto-populate location from lat/lng
create or replace function public.update_business_location()
returns trigger
language plpgsql
as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.location := st_point(new.longitude, new.latitude)::geography;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_update_business_location on public.business_directory;
create trigger trg_update_business_location
  before insert or update on public.business_directory
  for each row execute function public.update_business_location();

-- 5. business_verification — audit trail
create table if not exists public.business_verification (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_directory(id) on delete cascade,
  verifier_id uuid,
  status      text not null,
  notes       text,
  evidence_url text,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists business_verification_biz_idx on public.business_verification (business_id);

-- 6. business_import_batches
create table if not exists public.business_import_batches (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  file_url       text,
  total_records  integer not null default 0,
  imported_count integer not null default 0,
  error_count    integer not null default 0,
  duplicate_count integer not null default 0,
  status         text not null default 'pending',
  imported_by    uuid,
  error_summary  jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 7. business_import_errors
create table if not exists public.business_import_errors (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.business_import_batches(id) on delete cascade,
  row_number    integer not null,
  error_type    text not null,
  error_message text not null,
  raw_data      jsonb,
  field_name    text,
  created_at    timestamptz not null default now()
);

create index if not exists business_import_errors_batch_idx on public.business_import_errors (batch_id);

-- 8. business_sources
create table if not exists public.business_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  type        text not null default 'internal',
  url         text,
  api_key_env text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- RLS — Admin-only management, public read for active businesses
-- ============================================================================

alter table public.business_categories enable row level security;
alter table public.business_subcategories enable row level security;
alter table public.business_directory enable row level security;
alter table public.business_verification enable row level security;
alter table public.business_import_batches enable row level security;
alter table public.business_import_errors enable row level security;
alter table public.business_sources enable row level security;

-- business_categories: public read active, admin manage
drop policy if exists "categories_public_read" on public.business_categories;
create policy "categories_public_read" on public.business_categories
  for select using (is_active = true);

drop policy if exists "categories_admin_all" on public.business_categories;
create policy "categories_admin_all" on public.business_categories
  for all using (is_platform_admin());

-- business_subcategories: public read active, admin manage
drop policy if exists "subcategories_public_read" on public.business_subcategories;
create policy "subcategories_public_read" on public.business_subcategories
  for select using (is_active = true);

drop policy if exists "subcategories_admin_all" on public.business_subcategories;
create policy "subcategories_admin_all" on public.business_subcategories
  for all using (is_platform_admin());

-- business_directory: public read active, admin full access
drop policy if exists "directory_public_read" on public.business_directory;
create policy "directory_public_read" on public.business_directory
  for select using (is_active = true);

drop policy if exists "directory_admin_all" on public.business_directory;
create policy "directory_admin_all" on public.business_directory
  for all using (is_platform_admin());

-- business_verification: admin only
drop policy if exists "verification_admin_all" on public.business_verification;
create policy "verification_admin_all" on public.business_verification
  for all using (is_platform_admin());

-- business_import_batches: admin only
drop policy if exists "import_batches_admin_all" on public.business_import_batches;
create policy "import_batches_admin_all" on public.business_import_batches
  for all using (is_platform_admin());

-- business_import_errors: admin only
drop policy if exists "import_errors_admin_all" on public.business_import_errors;
create policy "import_errors_admin_all" on public.business_import_errors
  for all using (is_platform_admin());

-- business_sources: admin only
drop policy if exists "sources_admin_all" on public.business_sources;
create policy "sources_admin_all" on public.business_sources
  for all using (is_platform_admin());

-- ============================================================================
-- RPCs
-- ============================================================================

-- search_nearby_businesses: PostGIS proximity search
create or replace function public.search_nearby_businesses(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 10,
  p_category_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  name text,
  address text,
  phone text,
  email text,
  category_name text,
  latitude double precision,
  longitude double precision,
  distance_km double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    bd.id,
    bd.name,
    bd.address,
    bd.phone,
    bd.email,
    bc.name as category_name,
    bd.latitude,
    bd.longitude,
    round((st_distance(bd.location, st_point(p_longitude, p_latitude)::geography) / 1000)::numeric, 2)::double precision as distance_km
  from public.business_directory bd
  left join public.business_categories bc on bc.id = bd.category_id
  where bd.is_active = true
    and bd.location is not null
    and st_dwithin(bd.location, st_point(p_longitude, p_latitude)::geography, p_radius_km * 1000)
    and (p_category_id is null or bd.category_id = p_category_id)
  order by bd.location <-> st_point(p_longitude, p_latitude)::geography
  limit p_limit;
$$;

revoke all on function public.search_nearby_businesses(double precision, double precision, double precision, uuid, integer) from public;
grant execute on function public.search_nearby_businesses(double precision, double precision, double precision, uuid, integer) to authenticated;

-- get_business_stats: directory statistics
create or replace function public.get_business_stats()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select json_build_object(
    'total', (select count(*) from public.business_directory where is_active = true),
    'verified', (select count(*) from public.business_directory where is_active = true and verification_status = 'verified'),
    'unverified', (select count(*) from public.business_directory where is_active = true and verification_status = 'unverified'),
    'categories', (select count(*) from public.business_categories where is_active = true),
    'states', (select count(distinct state) from public.business_directory where is_active = true and state is not null)
  );
$$;

revoke all on function public.get_business_stats() from public;
grant execute on function public.get_business_stats() to authenticated;

-- ============================================================================
-- Seed 28 healthcare categories
-- ============================================================================

insert into public.business_categories (name, slug, icon, color, sort_order) values
  ('Pharmacy', 'pharmacy', 'pill', '#10b981', 1),
  ('Hospital', 'hospital', 'building-2', '#3b82f6', 2),
  ('Clinic', 'clinic', 'stethoscope', '#8b5cf6', 3),
  ('Medical Centre', 'medical-centre', 'heart-pulse', '#ef4444', 4),
  ('Specialist Hospital', 'specialist-hospital', 'badge-check', '#f59e0b', 5),
  ('Primary Healthcare Centre', 'primary-healthcare-centre', 'home', '#06b6d4', 6),
  ('Maternity', 'maternity', 'baby', '#ec4899', 7),
  ('Paediatric Centre', 'paediatric-centre', 'heart', '#f97316', 8),
  ('Cardiology Centre', 'cardiology-centre', 'heart-pulse', '#dc2626', 9),
  ('Fertility/IVF Centre', 'fertility-ivf-centre', 'sparkles', '#a855f7', 10),
  ('Gynecology Centre', 'gynecology-centre', 'user-round', '#d946ef', 11),
  ('Physiotherapy/Rehabilitation', 'physiotherapy-rehabilitation', 'activity', '#14b8a6', 12),
  ('Dermatology', 'dermatology', 'scan-face', '#f472b6', 13),
  ('Dental Clinic', 'dental-clinic', 'smile', '#fbbf24', 14),
  ('Eye Clinic/Optometry', 'eye-clinic-optometry', 'eye', '#60a5fa', 15),
  ('Diagnostic Centre', 'diagnostic-centre', 'flask-conical', '#34d399', 16),
  ('Medical Laboratory', 'medical-laboratory', 'test-tubes', '#818cf8', 17),
  ('Imaging/Radiology Centre', 'imaging-radiology-centre', 'scan', '#fb923c', 18),
  ('Aesthetic/Cosmetic Centre', 'aesthetic-cosmetic-centre', 'sparkles', '#f472b6', 19),
  ('Pharmaceutical Manufacturer', 'pharmaceutical-manufacturer', 'factory', '#6366f1', 20),
  ('Pharmaceutical Importer', 'pharmaceutical-importer', 'ship', '#0ea5e9', 21),
  ('Pharmaceutical Distributor', 'pharmaceutical-distributor', 'truck', '#22c55e', 22),
  ('Pharmaceutical Wholesaler', 'pharmaceutical-wholesaler', 'warehouse', '#84cc16', 23),
  ('Medical Equipment Company', 'medical-equipment-company', 'settings', '#a78bfa', 24),
  ('Medical Equipment Supplier', 'medical-equipment-supplier', 'package', '#c084fc', 25),
  ('Healthcare Supplier', 'healthcare-supplier', 'boxes-stacked', '#e879f9', 26),
  ('Cosmetics Business', 'cosmetics-business', 'palette', '#fb7185', 27),
  ('Other Healthcare-related Business', 'other-healthcare-related-business', 'plus-circle', '#94a3b8', 28)
on conflict (name) do nothing;

-- ============================================================================
-- updated_at trigger for tables that need it
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_business_categories_updated on public.business_categories;
create trigger trg_business_categories_updated
  before update on public.business_categories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_business_subcategories_updated on public.business_subcategories;
create trigger trg_business_subcategories_updated
  before update on public.business_subcategories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_import_batches_updated on public.business_import_batches;
create trigger trg_import_batches_updated
  before update on public.business_import_batches
  for each row execute function public.set_updated_at();

commit;
