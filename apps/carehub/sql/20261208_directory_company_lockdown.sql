-- ============================================================================
-- Business Directory: platform-admin only, ALSO for reads. Live Field Activity
-- keeps a narrow "nearby business" suggestion instead of table access.
--
-- Status: DRAFT, NOT APPLIED. Apply only with explicit owner approval.
--
-- Owner decision (2026-10-22): the Business Directory belongs to the platform
-- admin console only; companies do not get it on their dashboard. 20261202 made
-- WRITES platform-only but deliberately left READS open (every signed-in company
-- could read its own rows plus the verified platform registry, phone and e-mail
-- included) so Business Discovery, Territory Intelligence and the Live Activity
-- nearby picker kept working. Those company screens are removed, so the reads go.
--
-- What changes
--   1. directory_businesses / directory_categories / directory_subcategories
--      SELECT is platform-admin only. (Writes were already; reports keep their own
--      rule: a reporter sees their own, the platform sees all.)
--   2. nearby_directory_businesses(lat, lng, radius_km, limit): the ONLY directory
--      access a company keeps. SECURITY DEFINER, signed-in company staff only,
--      verified active non-demo PLATFORM rows only, radius capped at 1 km, at most
--      10 rows, and it returns name / address / type / verification / distance and
--      nothing else (no phone, e-mail, contact person, website or coordinates).
--   3. field_activities_directory_link_guard() becomes SECURITY DEFINER and also
--      accepts a verified active platform listing. It used to demand a row in the
--      company's OWN directory (reached by "Add to my directory", now gone) and it
--      ran as the caller, so under (1) it would reject every link.
--   4. Company-facing functions are revoked from API roles: the adopt / assign
--      writes and the four Territory Intelligence readers. service_role keeps them.
--
-- Security implications
--   * Company accounts can no longer read directory rows through the API at all.
--   * The nearby function still lets any signed-in company user list up to 10
--     verified businesses per call near any coordinates they supply. That is the
--     same information the picker needs; it is bounded per call but not rate
--     limited, so a patient scraper could walk the map. Accepted for now.
--   * Existing visits that already link a directory business keep their link.
--
-- Traps handled (memory: reference-supabase-carehub-gotchas): old policies are
-- dropped by name and the catalog is re-read by PREDICATE; new functions get an
-- explicit REVOKE from anon and the ACLs are verified in the closing block.
-- Re-read pg_proc.proacl after applying.
-- ============================================================================

-- 1. Reads are platform-only ---------------------------------------------------
drop policy if exists dir_businesses_read on public.directory_businesses;
drop policy if exists dir_businesses_platform_read on public.directory_businesses;
create policy dir_businesses_platform_read on public.directory_businesses for select to authenticated
  using (public.is_platform_admin());

drop policy if exists dir_categories_read on public.directory_categories;
drop policy if exists dir_categories_platform_read on public.directory_categories;
create policy dir_categories_platform_read on public.directory_categories for select to authenticated
  using (public.is_platform_admin());

drop policy if exists dir_subcategories_read on public.directory_subcategories;
drop policy if exists dir_subcategories_platform_read on public.directory_subcategories;
create policy dir_subcategories_platform_read on public.directory_subcategories for select to authenticated
  using (public.is_platform_admin());

-- 2. The one thing a company keeps: a bounded nearby suggestion ------------------
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
  if auth.uid() is null or not exists (select 1 from public.current_business_ids()) then
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
       and d.verification_status = 'verified' and d.data_source <> 'demo'
       and d.latitude  between p_lat - v_dlat and p_lat + v_dlat
       and d.longitude between p_lng - v_dlng and p_lng + v_dlng
       and x.dist <= v_radius
     order by x.dist, d.name
     limit v_limit;
end;
$$;

comment on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) is
  'Live Field Report suggestion: up to 10 verified platform-registry businesses within 1 km. Returns no contact details. Signed-in company staff only.';

revoke all on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.nearby_directory_businesses(double precision, double precision, double precision, integer) to authenticated, service_role;

-- 3. A visit may link a verified platform listing (and, for old data, the company's own) -
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
                   and d.verification_status = 'verified' and d.data_source <> 'demo'))) then
    raise exception 'Selected business is not available to this business account';
  end if;
  return NEW;
end;
$$;
revoke all on function public.field_activities_directory_link_guard() from public, anon, authenticated;

-- 4. Company-facing directory functions: no longer callable through the API -------
revoke all on function public.adopt_platform_directory_listing(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assign_directory_territory(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.directory_coverage_summary(uuid, timestamptz, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.directory_unvisited(uuid, timestamptz, uuid, boolean, text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.directory_visit_totals(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.directory_rep_activity(uuid, timestamptz) from public, anon, authenticated;

-- 5. Verify; raise if anything still lets a company reach the directory ------------
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename like 'directory\_%'
     and cmd in ('SELECT', 'ALL')
     and (coalesce(qual, '') ilike '%current_business_ids%' or coalesce(qual, '') ilike '%business_id is null%'
          or coalesce(qual, '') not like '%is_platform_admin()%');
  if bad is not null then raise exception 'directory read policy still open to companies: %', bad; end if;

  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('adopt_platform_directory_listing','assign_directory_territory','directory_coverage_summary',
                       'directory_unvisited','directory_visit_totals','directory_rep_activity')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  if bad is not null then raise exception 'company directory function still executable: %', bad; end if;

  if (select count(*) from pg_proc where proname = 'nearby_directory_businesses' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'nearby_directory_businesses missing or duplicated';
  end if;
  if exists (select 1 from pg_proc p where p.proname = 'nearby_directory_businesses' and p.pronamespace = 'public'::regnamespace
              and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'nearby_directory_businesses is executable by anon';
  end if;
end $$;
