-- ============================================================================
-- Business Directory: management is Platform Super Admin only.
--
-- Status: APPLIED to production (szdybxmgmhndoytqanfb) on 2026-10-21 as a tracked migration, with owner approval.
--         Catalog verified (one overload each, no anon EXECUTE) and behaviour verified in rolled-back transactions.
--
-- Owner decision (2026-10-21): all directory_* writes become platform-admin-only.
-- Before this, a company owner (and any custom role the owner ticked "Manage
-- business directory") could insert/update/delete directory rows scoped to their
-- own company through can_manage_directory(), straight against the API.
--
-- What changes
--   1. Every write policy on directory_* is platform-admin-only
--      (is_platform_admin(), which reads the caller's verified JWT e-mail and
--      businesses.is_platform_admin; nothing the client sends is trusted).
--   2. Reading is unchanged: members still read their company's rows and
--      everyone signed in still reads the verified platform registry, so Business
--      Discovery, Territory Intelligence and the Live Activity "nearby business"
--      picker keep working.
--   3. directory_reports: members can still SUBMIT "incorrect information" feedback;
--      reading and resolving reports is for the platform team (and a reporter sees
--      their own).
--   4. The two things the company-facing modules legitimately wrote are re-homed as
--      narrow, audited SECURITY DEFINER RPCs that keep today's authorisation
--      (can_manage_directory on that company) but expose ONLY that operation:
--        adopt_platform_directory_listing()  Business Discovery "Add to my directory"
--        assign_directory_territory()        Territory Intelligence bulk assignment
--      Neither can edit, verify, delete or import anything.
--   5. TRUNCATE / REFERENCES / TRIGGER are revoked from authenticated on the
--      directory tables (never reachable through PostgREST; removed anyway).
--
-- can_manage_directory() itself is NOT changed: caller_sees_all_activity() (live
-- field-activity visibility, carehub_20261131) depends on it.
--
-- Traps handled (memory: reference-supabase-carehub-gotchas):
--   * policies are dropped by NAME and then the catalog is re-read; the migration
--     raises if any directory write policy still admits a non-platform caller.
--   * new functions get an explicit REVOKE from anon and a proacl re-check.
-- Existing directory rows are not touched.
-- ============================================================================

-- 1. directory_businesses ----------------------------------------------------
drop policy if exists dir_businesses_write on public.directory_businesses;
drop policy if exists dir_businesses_platform_write on public.directory_businesses;
create policy dir_businesses_platform_write on public.directory_businesses for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 2. categories / subcategories ------------------------------------------------
drop policy if exists dir_categories_insert on public.directory_categories;
drop policy if exists dir_categories_update on public.directory_categories;
drop policy if exists dir_categories_delete on public.directory_categories;
drop policy if exists dir_categories_platform_write on public.directory_categories;
create policy dir_categories_platform_write on public.directory_categories for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists dir_subcategories_write on public.directory_subcategories;
drop policy if exists dir_subcategories_platform_write on public.directory_subcategories;
create policy dir_subcategories_platform_write on public.directory_subcategories for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 3. import batches / errors / duplicate dismissals ----------------------------
drop policy if exists dir_import_batches_manage on public.directory_import_batches;
create policy dir_import_batches_platform on public.directory_import_batches for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists dir_import_errors_manage on public.directory_import_errors;
create policy dir_import_errors_platform on public.directory_import_errors for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists dir_dismissals_manage on public.directory_duplicate_dismissals;
create policy dir_dismissals_platform on public.directory_duplicate_dismissals for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- 4. reports of incorrect information ------------------------------------------
-- dir_reports_insert (members submit feedback) is deliberately left as is.
drop policy if exists dir_reports_read on public.directory_reports;
create policy dir_reports_read on public.directory_reports for select to authenticated
  using (public.is_platform_admin() or reported_by = auth.email());

drop policy if exists dir_reports_update on public.directory_reports;
create policy dir_reports_update on public.directory_reports for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

revoke truncate, references, trigger on
  public.directory_categories, public.directory_subcategories, public.directory_businesses,
  public.directory_import_batches, public.directory_import_errors,
  public.directory_reports, public.directory_duplicate_dismissals
  from anon, authenticated;

-- 5. Narrow replacements for the two company-facing writes ----------------------
-- Business Discovery: copy a VERIFIED platform listing into the company's own
-- (private, unverified) list. Idempotent per (company, platform listing).
create or replace function public.adopt_platform_directory_listing(p_business_id uuid, p_platform_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_src public.directory_businesses%rowtype;
  v_existing uuid;
  v_new uuid;
begin
  if auth.uid() is null or not public.can_manage_directory(p_business_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_src from public.directory_businesses
   where id = p_platform_id and business_id is null
     and is_active and verification_status = 'verified' and data_source <> 'demo';
  if not found then
    raise exception 'That platform listing is not available' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_platform_id::text, 0));

  select id into v_existing from public.directory_businesses
   where business_id = p_business_id and source_detail = 'platform:' || p_platform_id::text limit 1;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'already_had', true);
  end if;

  insert into public.directory_businesses (
    business_id, name, name_normalized, category_id, subcategory_id, business_type, address, address_normalized,
    state, lga, city, latitude, longitude, phone, phone_normalized, email, website, website_host,
    contact_person, opening_hours, description, data_source, source_detail, verification_status, created_by)
  values (
    p_business_id, v_src.name, v_src.name_normalized, v_src.category_id, v_src.subcategory_id, v_src.business_type,
    v_src.address, v_src.address_normalized, v_src.state, v_src.lga, v_src.city, v_src.latitude, v_src.longitude,
    v_src.phone, v_src.phone_normalized, v_src.email, v_src.website, v_src.website_host,
    v_src.contact_person, v_src.opening_hours, v_src.description,
    'external', 'platform:' || p_platform_id::text, 'unverified', auth.email())
  returning id into v_new;

  return jsonb_build_object('id', v_new, 'already_had', false);
end;
$$;

-- Territory Intelligence: give a territory to ACTIVE, still-unassigned businesses
-- of this company (optionally one state). Never overwrites an assignment.
create or replace function public.assign_directory_territory(p_business_id uuid, p_territory_id uuid, p_state text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if auth.uid() is null or not public.can_manage_directory(p_business_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.territories t where t.id = p_territory_id and t.business_id = p_business_id) then
    raise exception 'Territory does not belong to this business' using errcode = '22023';
  end if;
  update public.directory_businesses d
     set territory_id = p_territory_id
   where d.business_id = p_business_id and d.is_active and d.territory_id is null
     and (p_state is null or d.state = p_state);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.adopt_platform_directory_listing(uuid, uuid) from public, anon;
revoke all on function public.assign_directory_territory(uuid, uuid, text) from public, anon;
grant execute on function public.adopt_platform_directory_listing(uuid, uuid) to authenticated, service_role;
grant execute on function public.assign_directory_territory(uuid, uuid, text) to authenticated, service_role;

-- 6. Verification: raise if anything still lets a non-platform caller write. -----
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename like 'directory\_%'
     and cmd in ('ALL', 'UPDATE', 'DELETE')
     and coalesce(qual, '') not like '%is_platform_admin()%';
  if bad is not null then raise exception 'directory write policy still open to non-platform callers: %', bad; end if;

  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename like 'directory\_%' and cmd = 'INSERT'
     and coalesce(with_check, '') not like '%is_platform_admin()%'
     and policyname <> 'dir_reports_insert';
  if bad is not null then raise exception 'directory insert policy still open to non-platform callers: %', bad; end if;

  if (select count(*) from pg_proc where proname in ('adopt_platform_directory_listing', 'assign_directory_territory')) <> 2 then
    raise exception 'directory RPCs missing or duplicated';
  end if;
end $$;
