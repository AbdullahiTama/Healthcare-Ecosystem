-- ============================================================================
-- Imported directory listings reach the Field Report and Facility Discovery.
--
-- Status: APPLIED 2026-11-18 with owner approval to szdybxmgmhndoytqanfb as version 20261118114804.
--   Post-apply probe (as a real Manufacturer / Importer owner; the one report insert rolled back): field
--   suggestion at the first import 4 rows incl. it; nationwide 216; 'pharmacy' 124; 'hospital' 95; by name
--   found; within 5 km 48; report link to an import accepted; direct table read 0 rows; pharmacy owner
--   Not authorized. Grants: both functions authenticated only (not anon); link guard not executable by API roles.
--
-- Before applying: tested on PGlite
-- (apps/carefind/src/test/directory/directoryListingsVisibility.db.test.js, 34 tests) and by a
-- rolled-back live probe against the 215 imported listings.
--
-- Live probe 2026-11-18 (this file applied inside BEGIN ... ROLLBACK, called as a real
-- Manufacturer / Importer owner; production confirmed unchanged afterwards):
--   nearby_directory_businesses at the first import's coordinates, 1 km .... 4 rows, includes it
--   discover_directory_listings() nationwide ................................ 216 (215 imports + 1 verified OSM listing)
--   keyword 'pharmacy' / 'hospital' ......................................... 124 / 95
--   by its state (Lagos) / within 5 km of it ................................ 216 / 48, nearest first is it
--   by the first word of its name ........................................... found
--   row fields: address, business_type, category, city, data_source, distance_km, id, latitude, lga,
--               longitude, name, phone, state, subcategory, verification_status
--   field report linking that import: before .. refused ("not available to this business account")
--                                     after ... accepted
--   direct SELECT on directory_businesses as the company ..................... 0 rows
--   a pharmacy owner calling discover_directory_listings ..................... Not authorized
--
-- Problem (verified live 2026-11-18)
--   215 businesses (124 pharmacies, 91 hospitals) were bulk-uploaded by the platform
--   admin into the platform Business Directory (directory_businesses, business_id
--   NULL, data_source 'import', verification_status 'unverified'), every one with
--   address, state, LGA, city and Nigerian coordinates. Manufacturer / Importer and
--   Wholesale companies see none of them:
--     1. Field Report (Live Field Activity > "Possible nearby businesses") calls
--        nearby_directory_businesses(), which returns VERIFIED listings only. An
--        import is never verified on arrival, so the 215 are invisible.
--     2. Even if a rep could pick one, field_activities_directory_link_guard()
--        refuses to link an unverified listing to a report.
--     3. Facility Discovery (the companies' business directory screen) never reads
--        directory_businesses at all: its internal source is
--        discover_facilities_cursor(), which reads `businesses` (registered
--        accounts) only. Since carehub_20261208 companies cannot read directory
--        tables, so there was no path for them to appear.
--   Registered businesses, by contrast, appear in Discovery with no verification
--   gate (discover_facilities_cursor: account_kind = 'business', not deleted).
--
-- Fix: one definition of an ELIGIBLE platform listing, used in all three places:
--      business_id IS NULL (platform registry), is_active, data_source <> 'demo',
--      verification_status <> 'rejected'.
--   (verification_status is unverified | verified | rejected.) An unverified listing
--   is eligible and keeps its status, which the screens show as a badge; a rejected
--   listing stays hidden everywhere. Verifying stays a platform-admin action.
--   1. nearby_directory_businesses(): eligible listings (was: verified only). Same
--      signature, columns, 1 km radius cap and 10-row cap. Callers must now belong
--      to a Manufacturer / Importer or Wholesale business (or be platform staff):
--      the Field module is only offered to those types.
--   2. field_activities_directory_link_guard(): accepts an eligible listing.
--   3. discover_directory_listings(): NEW, read-only, SECURITY DEFINER. Search by
--      text (name, address, city, LGA, state, category, subcategory, type), by
--      state / LGA / city, and by radius around a point. Same caller rule as (1).
--      Capped at 500 rows per call, radius 0.1-100 km.
--
-- Security implications (owner request 2026-11-18: "eligible bulk-uploaded
-- businesses receive the same visibility as businesses registered directly")
--   * WIDENS company access to the platform directory, which carehub_20261208 had
--     narrowed to "verified listings within 1 km, no contact details". Enterprise
--     companies can now list every eligible listing across Nigeria with
--     name, category, address, state/LGA/city, coordinates, business PHONE and
--     verification status. That is the same set of fields Discovery already shows
--     for registered businesses.
--   * NOT exposed: e-mail, website, contact person, opening hours, description,
--     notes, who created / verified it, import batch. Directory tables stay
--     platform-admin only (no policy changes); companies read listings only
--     through these two functions.
--   * TIGHTENS who may call nearby_directory_businesses(): any business member
--     before, Manufacturer / Importer / Wholesale members (and platform staff)
--     now. Pharmacies, hospitals etc. have no Field module, so no screen loses
--     anything.
--   * Bounded per call (500 rows) but not rate limited: a signed-in enterprise user
--     could page the whole registry. Accepted: that is what the directory is for.
--   * anon cannot execute either function.
--
-- Rollback: re-run sections 1-3 of carehub_20261208_directory_company_lockdown.sql
--   (nearby_directory_businesses and field_activities_directory_link_guard), then
--   drop function public.discover_directory_listings(text,text,text,text,double precision,double precision,double precision,integer,integer);
--   Reports already linked to an unverified listing keep their link (the guard only
--   runs on insert / update of the link).
-- ============================================================================

-- 1. Field Report suggestion: eligible listings, enterprise callers ------------------
create or replace function public.nearby_directory_businesses(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 0.5,
  p_limit integer default 5
)
returns table (id uuid, name text, address text, business_type text, verification_status text, distance_km double precision)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_radius double precision;
  v_limit integer;
  v_dlat double precision;
  v_dlng double precision;
begin
  if auth.uid() is null or not (
       public.is_platform_admin()
       or exists (select 1 from public.businesses b
                   where b.id in (select public.current_business_ids())
                     and b.business_type in ('manufacturer_importer', 'wholesale'))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid position' using errcode = '22023';
  end if;

  v_radius := least(greatest(coalesce(p_radius_km, 0.5), 0.05), 1.0);
  v_limit  := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_dlat   := v_radius / 111.0;
  v_dlng   := v_radius / (111.0 * greatest(cos(radians(p_lat)), 0.01));

  return query
    select d.id, d.name::text, d.address::text, d.business_type::text, d.verification_status::text, x.dist
      from public.directory_businesses d
     cross join lateral (
       select 6371.0 * 2 * asin(sqrt(least(1.0,
                power(sin(radians(d.latitude::double precision - p_lat) / 2), 2)
              + cos(radians(p_lat)) * cos(radians(d.latitude::double precision))
              * power(sin(radians(d.longitude::double precision - p_lng) / 2), 2)))) as dist
     ) x
     where d.business_id is null and d.is_active
       and d.verification_status <> 'rejected' and d.data_source <> 'demo'
       and d.latitude  between p_lat - v_dlat and p_lat + v_dlat
       and d.longitude between p_lng - v_dlng and p_lng + v_dlng
       and x.dist <= v_radius
     order by x.dist, d.name
     limit v_limit;
end;
$$;

comment on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) is
  'Live Field Report suggestion: up to 10 eligible platform-registry businesses (active, not demo, not rejected) within 1 km. No contact details. Manufacturer/Importer and Wholesale members, and platform staff, only.';

revoke all on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) to authenticated, service_role;

-- 2. A report may link any eligible platform listing (and, for old data, the company's own)
create or replace function public.field_activities_directory_link_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.directory_business_id is not null and not exists (
       select 1 from public.directory_businesses d
        where d.id = NEW.directory_business_id
          and (d.business_id = NEW.business_id
               or (d.business_id is null and d.is_active
                   and d.verification_status <> 'rejected' and d.data_source <> 'demo'))) then
    raise exception 'Selected business is not available to this business account';
  end if;
  return NEW;
end;
$$;
revoke all on function public.field_activities_directory_link_guard() from public, anon, authenticated;

-- 3. Facility Discovery: search eligible listings by text, place and radius -----------
create or replace function public.discover_directory_listings(
  p_keyword   text default null,
  p_state     text default null,
  p_lga       text default null,
  p_city      text default null,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_radius_km double precision default null,
  p_limit     integer default 200,
  p_offset    integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_point  boolean := p_lat is not null and p_lng is not null;
  v_radius double precision;
  v_dlat   double precision;
  v_dlng   double precision;
  -- User text is matched literally: LIKE wildcards and the escape character are escaped.
  v_kw     text := nullif(btrim(coalesce(p_keyword, '')), '');
  v_state  text := nullif(btrim(coalesce(p_state, '')), '');
  v_lga    text := nullif(btrim(coalesce(p_lga, '')), '');
  v_city   text := nullif(btrim(coalesce(p_city, '')), '');
  v_total  integer;
  v_rows   jsonb;
begin
  if auth.uid() is null or not (
       public.is_platform_admin()
       or exists (select 1 from public.businesses b
                   where b.id in (select public.current_business_ids())
                     and b.business_type in ('manufacturer_importer', 'wholesale'))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or (v_point and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'Invalid position' using errcode = '22023';
  end if;

  v_kw    := replace(replace(replace(v_kw,    '\', '\\'), '%', '\%'), '_', '\_');
  v_state := replace(replace(replace(v_state, '\', '\\'), '%', '\%'), '_', '\_');
  v_lga   := replace(replace(replace(v_lga,   '\', '\\'), '%', '\%'), '_', '\_');
  v_city  := replace(replace(replace(v_city,  '\', '\\'), '%', '\%'), '_', '\_');

  if v_point then
    v_radius := least(greatest(coalesce(p_radius_km, 10), 0.1), 100);
    v_dlat   := v_radius / 111.0;
    v_dlng   := v_radius / (111.0 * greatest(cos(radians(p_lat)), 0.01));
  end if;

  with hits as (
    select d.id, d.name, d.business_type, c.name as category, s.name as subcategory,
           d.address, d.state, d.lga, d.city, d.latitude, d.longitude, d.phone,
           d.verification_status, d.data_source, d.created_at,
           case when v_point and d.latitude is not null and d.longitude is not null then
             6371.0 * 2 * asin(sqrt(least(1.0,
                 power(sin(radians(d.latitude - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(d.latitude))
               * power(sin(radians(d.longitude - p_lng) / 2), 2))))
           end as distance_km
      from public.directory_businesses d
      left join public.directory_categories c on c.id = d.category_id
      left join public.directory_subcategories s on s.id = d.subcategory_id
     where d.business_id is null and d.is_active
       and d.verification_status <> 'rejected' and d.data_source <> 'demo'
       and (v_state is null or d.state ilike '%' || v_state || '%')
       and (v_lga   is null or d.lga   ilike '%' || v_lga   || '%')
       and (v_city  is null or d.city  ilike '%' || v_city  || '%' or d.address ilike '%' || v_city || '%')
       and (v_kw is null
            or d.name ilike '%' || v_kw || '%' or d.address ilike '%' || v_kw || '%'
            or d.city ilike '%' || v_kw || '%' or d.lga ilike '%' || v_kw || '%' or d.state ilike '%' || v_kw || '%'
            or d.business_type ilike '%' || v_kw || '%'
            or c.name ilike '%' || v_kw || '%' or s.name ilike '%' || v_kw || '%')
       and (not v_point or (d.latitude  between p_lat - v_dlat and p_lat + v_dlat
                        and d.longitude between p_lng - v_dlng and p_lng + v_dlng))
  ), within as (
    select * from hits where not v_point or distance_km <= v_radius
  )
  select (select count(*) from within),
         coalesce((select jsonb_agg(to_jsonb(t) - 'created_at')
                     from (select * from within
                            order by distance_km nulls last, name, id
                            limit v_limit offset v_offset) t), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'hasMore', v_offset + v_limit < v_total,
    'radiusKm', v_radius
  );
end;
$$;

comment on function public.discover_directory_listings(text, text, text, text, double precision, double precision, double precision, integer, integer) is
  'Facility Discovery: eligible platform-registry listings (active, not demo, not rejected) by text, state/LGA/city and radius. Returns name, category, address, place, coordinates, business phone and verification; no e-mail, contact person or notes. Manufacturer/Importer and Wholesale members, and platform staff, only.';

revoke all on function public.discover_directory_listings(text, text, text, text, double precision, double precision, double precision, integer, integer) from public, anon;
grant execute on function public.discover_directory_listings(text, text, text, text, double precision, double precision, double precision, integer, integer) to authenticated, service_role;

-- 4. Verify ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('nearby_directory_businesses', 'discover_directory_listings')
              and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'a directory listing function is executable by anon';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('nearby_directory_businesses', 'discover_directory_listings')) <> 2 then
    raise exception 'directory listing functions missing or overloaded';
  end if;
  if has_function_privilege('authenticated', 'public.field_activities_directory_link_guard()', 'execute') then
    raise exception 'field_activities_directory_link_guard is executable by authenticated';
  end if;
  -- The directory tables themselves stay platform-admin only for reads.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename like 'directory\_%' and cmd in ('SELECT', 'ALL')
                and coalesce(qual, '') not like '%is_platform_admin()%'
                and tablename in ('directory_businesses', 'directory_categories', 'directory_subcategories')) then
    raise exception 'a directory table read policy is open to companies';
  end if;
end $$;
