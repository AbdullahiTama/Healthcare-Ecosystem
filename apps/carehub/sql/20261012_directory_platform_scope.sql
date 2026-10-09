-- ============================================================================
-- Business Directory: platform scope (one schema, two scopes)
--
-- Status: APPLIED to production project `carehub` 2026-10-09, statement by statement via
-- execute_sql (DROP POLICY hangs through the MCP connector, so the existing policies were
-- changed in place with ALTER POLICY instead). Verified live in a rolled-back block.
-- Depends on 20261010_business_directory.sql.
--
-- WHY
--   Production also carried a separate, empty CareFind-side directory
--   (business_directory / business_categories / ...), platform-administered and
--   readable by every signed-in user. Rather than keep two schemas, the CareHub
--   directory now has two scopes in ONE set of tables:
--
--     tenant scope    business_id = <company>   private to that company (unchanged)
--     platform scope  business_id IS NULL       owned by the platform, curated by
--                                               platform admins, readable by every
--                                               signed-in user ONLY when it is
--                                               active, VERIFIED and not demo data
--
--   Companies search their own list plus the platform's verified businesses, and
--   may copy a platform business into their own list (provenance kept in
--   source_detail = 'platform:<id>'). A copy is a separate private record: the
--   company can edit it freely and it never changes the platform record.
--
-- WHAT STAYS TRUE
--   * Tenant isolation is untouched: no company can read another company's rows.
--   * Platform rows carry no territory (territories are company-private) and may
--     only use built-in categories.
--   * Field activity links stay tenant-only (field_activities_directory_link_guard
--     is unchanged): to log against a platform business, a manager first adds it
--     to their own directory.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Allow platform-owned rows
-- ----------------------------------------------------------------------------
alter table public.directory_businesses alter column business_id drop not null;

alter table public.directory_businesses drop constraint if exists directory_businesses_platform_shape;
alter table public.directory_businesses
  add constraint directory_businesses_platform_shape check (business_id is not null or territory_id is null);

-- Provenance lookups ("is this platform business already in my list?").
create index if not exists idx_dirbiz_source_detail
  on public.directory_businesses (business_id, source_detail) where source_detail is not null;
-- Platform-scope listing and radius search (business_id IS NULL).
create index if not exists idx_dirbiz_platform_geo
  on public.directory_businesses (latitude, longitude) where business_id is null and latitude is not null;

-- ----------------------------------------------------------------------------
-- 2. Guard trigger: platform rows may use built-in categories only
-- ----------------------------------------------------------------------------
-- (The existing checks already reject a tenant category/territory for a NULL
-- business_id because `c.business_id = NULL` / `t.business_id = NULL` are never
-- true; this restates the intent with an explicit, readable message.)
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
  if NEW.category_id is not null and not exists (
       select 1 from public.directory_categories c
        where c.id = NEW.category_id and (c.business_id is null or c.business_id = NEW.business_id)) then
    raise exception 'Category does not belong to this business';
  end if;
  if NEW.subcategory_id is not null and not exists (
       select 1 from public.directory_subcategories s
        where s.id = NEW.subcategory_id and s.category_id = NEW.category_id
          and (s.business_id is null or s.business_id = NEW.business_id)) then
    raise exception 'Subcategory does not belong to the selected category';
  end if;
  if NEW.territory_id is not null and not exists (
       select 1 from public.territories t
        where t.id = NEW.territory_id and t.business_id = NEW.business_id) then
    raise exception 'Territory does not belong to this business';
  end if;
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

-- ----------------------------------------------------------------------------
-- 3. Row-level security for the platform scope
-- ----------------------------------------------------------------------------
drop policy if exists dir_businesses_read on public.directory_businesses;
create policy dir_businesses_read on public.directory_businesses for select to authenticated
  using (
    business_id in (select current_business_ids())
    or is_platform_admin()
    -- platform registry: only what is safe to show every company
    or (business_id is null and is_active and verification_status = 'verified' and data_source <> 'demo')
  );

-- Platform rows are written by platform admins only. (can_manage_directory(NULL)
-- already admits platform admins via is_staff_owner_level; this makes it explicit
-- and independent of that helper's internals.)
drop policy if exists dir_businesses_platform_write on public.directory_businesses;
create policy dir_businesses_platform_write on public.directory_businesses for all to authenticated
  using (business_id is null and is_platform_admin())
  with check (business_id is null and is_platform_admin());

-- Platform admins curate the shared subcategory list (business_id NULL), as they
-- already can for categories (dir_categories_platform_write).
drop policy if exists dir_subcategories_platform_write on public.directory_subcategories;
create policy dir_subcategories_platform_write on public.directory_subcategories for all to authenticated
  using (business_id is null and is_platform_admin())
  with check (business_id is null and is_platform_admin());

-- Any member may report incorrect information on their own records OR on a
-- visible platform record. The report is filed under the reporter's business.
drop policy if exists dir_reports_insert on public.directory_reports;
create policy dir_reports_insert on public.directory_reports for insert to authenticated
  with check (
    business_id in (select current_business_ids())
    and exists (
      select 1 from public.directory_businesses d
       where d.id = directory_business_id
         and (d.business_id = directory_reports.business_id
              or (d.business_id is null and d.is_active and d.verification_status = 'verified' and d.data_source <> 'demo'))
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Carry the CareFind-side subcategories into the shared built-in set
--    (skipped automatically once those tables are retired)
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.business_subcategories') is not null and to_regclass('public.business_categories') is not null then
    insert into public.directory_subcategories (category_id, business_id, name, is_active)
    select dc.id, null, btrim(bs.name), coalesce(bs.is_active, true)
      from public.business_subcategories bs
      join public.business_categories bc on bc.id = bs.category_id
      join public.directory_categories dc
        on dc.business_id is null and lower(btrim(dc.name)) = lower(btrim(bc.name))
     where length(btrim(bs.name)) > 0
    on conflict do nothing;
  end if;
end $$;
