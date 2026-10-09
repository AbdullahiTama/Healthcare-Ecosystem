-- ============================================================================
-- Territory Intelligence (Business Directory Phase 4) — read-only analytics
--
-- Status: APPLIED to production project `carehub` 2026-10-09 (run statement-by-statement
-- via execute_sql, as the MCP migration call times out on DDL against this project).
-- Depends on 20261010_business_directory.sql.
--
-- WHAT "VISITED" MEANS
--   A directory business counts as covered in a window only when a SUBMITTED
--   field activity carries its id in field_activities.directory_business_id,
--   which the Live Field Report sets only when the representative explicitly
--   confirmed that business. GPS proximity never counts. Activities logged
--   without a confirmed business are invisible to coverage; directory_visit_totals
--   reports how many there are so managers can see the blind spot.
--
-- SECURITY
--   Every function is SECURITY INVOKER: the caller's row-level security on
--   directory_businesses, field_activities, territories and staff decides what
--   they can see, exactly as for a direct query. Nothing here can widen access.
--   EXECUTE is granted to authenticated only. All are STABLE and read-only.
-- ============================================================================

-- Supports "linked activities in a window" without scanning the whole table.
create index if not exists idx_field_activities_directory_visits
  on public.field_activities (business_id, created_at desc, directory_business_id)
  where directory_business_id is not null;

-- ----------------------------------------------------------------------------
-- 1. Coverage by territory / state / lga / category
-- ----------------------------------------------------------------------------
create or replace function public.directory_coverage_summary(
  p_business_id uuid,
  p_since timestamptz,
  p_group text,
  p_category_id uuid default null,
  p_state text default null,
  p_unassigned_only boolean default false
)
returns table (group_key text, group_label text, total bigint, visited bigint)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
begin
  if p_group not in ('territory', 'state', 'lga', 'category') then
    raise exception 'Unknown grouping: %', p_group;
  end if;
  return query
  with v as (
    select fa.directory_business_id as id
      from public.field_activities fa
     where fa.business_id = p_business_id
       and fa.directory_business_id is not null
       and fa.created_at >= p_since
     group by fa.directory_business_id
  )
  select
    case p_group
      when 'territory' then coalesce(d.territory_id::text, '')
      when 'state'     then coalesce(nullif(btrim(d.state), ''), '')
      when 'lga'       then coalesce(nullif(btrim(d.lga), ''), '')
      else                  coalesce(d.category_id::text, '')
    end as group_key,
    case p_group
      when 'territory' then coalesce(t.name, '')
      when 'state'     then coalesce(nullif(btrim(d.state), ''), '')
      when 'lga'       then coalesce(nullif(btrim(d.lga), ''), '')
      else                  coalesce(c.name, '')
    end as group_label,
    count(*)::bigint as total,
    count(v.id)::bigint as visited
  from public.directory_businesses d
  left join v on v.id = d.id
  left join public.territories t on t.id = d.territory_id
  left join public.directory_categories c on c.id = d.category_id
  where d.business_id = p_business_id
    and d.is_active
    and (p_category_id is null or d.category_id = p_category_id)
    and (p_state is null or d.state = p_state)
    and (not p_unassigned_only or d.territory_id is null)
  group by 1, 2;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Businesses NOT visited in the window (never, or last visit before p_since)
-- ----------------------------------------------------------------------------
create or replace function public.directory_unvisited(
  p_business_id uuid,
  p_since timestamptz,
  p_territory_id uuid default null,
  p_unassigned_only boolean default false,
  p_state text default null,
  p_category_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, name text, category_id uuid, address text, state text, lga text, city text, phone text,
  latitude double precision, longitude double precision, territory_id uuid,
  verification_status text, data_source text, last_visit_at timestamptz, total_count bigint
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with lv as (
    select fa.directory_business_id as id, max(fa.created_at) as last_visit_at
      from public.field_activities fa
     where fa.business_id = p_business_id and fa.directory_business_id is not null
     group by fa.directory_business_id
  )
  select d.id, d.name, d.category_id, d.address, d.state, d.lga, d.city, d.phone,
         d.latitude, d.longitude, d.territory_id, d.verification_status, d.data_source,
         lv.last_visit_at, count(*) over () as total_count
    from public.directory_businesses d
    left join lv on lv.id = d.id
   where d.business_id = p_business_id
     and d.is_active
     and (lv.last_visit_at is null or lv.last_visit_at < p_since)
     and (p_territory_id is null or d.territory_id = p_territory_id)
     and (not p_unassigned_only or d.territory_id is null)
     and (p_state is null or d.state = p_state)
     and (p_category_id is null or d.category_id = p_category_id)
   order by lv.last_visit_at asc nulls first, d.name_normalized asc, d.id asc
   limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)
$$;

-- ----------------------------------------------------------------------------
-- 3. Headline numbers, including how many activities carry no confirmed business
-- ----------------------------------------------------------------------------
create or replace function public.directory_visit_totals(p_business_id uuid, p_since timestamptz)
returns table (activities_total bigint, activities_linked bigint, businesses_visited bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select count(*)::bigint,
         count(fa.directory_business_id)::bigint,
         count(distinct fa.directory_business_id)::bigint
    from public.field_activities fa
   where fa.business_id = p_business_id and fa.created_at >= p_since
$$;

-- ----------------------------------------------------------------------------
-- 4. Per-representative activity (confirmed businesses only)
-- ----------------------------------------------------------------------------
create or replace function public.directory_rep_activity(p_business_id uuid, p_since timestamptz)
returns table (staff_id uuid, rep_name text, activities bigint, linked_activities bigint, businesses bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select fa.staff_id, max(fa.rep_name), count(*)::bigint,
         count(fa.directory_business_id)::bigint,
         count(distinct fa.directory_business_id)::bigint
    from public.field_activities fa
   where fa.business_id = p_business_id and fa.created_at >= p_since
   group by fa.staff_id
   order by 5 desc, 3 desc
$$;

-- Supabase grants EXECUTE directly to anon/authenticated on new functions;
-- REVOKE FROM PUBLIC does not remove those. Authenticated only.
revoke all on function public.directory_coverage_summary(uuid, timestamptz, text, uuid, text, boolean) from public, anon;
revoke all on function public.directory_unvisited(uuid, timestamptz, uuid, boolean, text, uuid, integer, integer) from public, anon;
revoke all on function public.directory_visit_totals(uuid, timestamptz) from public, anon;
revoke all on function public.directory_rep_activity(uuid, timestamptz) from public, anon;
grant execute on function public.directory_coverage_summary(uuid, timestamptz, text, uuid, text, boolean) to authenticated;
grant execute on function public.directory_unvisited(uuid, timestamptz, uuid, boolean, text, uuid, integer, integer) to authenticated;
grant execute on function public.directory_visit_totals(uuid, timestamptz) to authenticated;
grant execute on function public.directory_rep_activity(uuid, timestamptz) to authenticated;
