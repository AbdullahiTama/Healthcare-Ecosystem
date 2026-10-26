-- get_purchases_page: return types did not match the live purchases columns.
--
-- Written against the LIVE schema read on 2026-10-26:
--   * purchases.expiry     is DATE                         (the function declares TEXT)
--   * purchases.created_at is TIMESTAMP WITHOUT TIME ZONE  (the function declares TIMESTAMPTZ), default now(),
--     and the database time zone is UTC, so stored values are UTC wall-clock times.
--
-- RETURN QUERY requires the query's column types to match RETURNS TABLE exactly, so EVERY call failed with
-- "structure of query does not match function result type" (HTTP 400 from PostgREST). The Purchases page
-- swallowed the error: every business saw an empty purchase list and zero totals. The red-team test did not
-- catch it because its fixture declared the two columns with the function's types instead of the live ones.
--
-- WHAT THIS DOES
--   Re-creates the function with the SAME signature, result shape, ownership check (carefind_20261019,
--   F-41) and grants. Only the two columns are converted in the select list:
--     expiry::text                      -> 'YYYY-MM-DD' (what the page's fmtDate already parses)
--     created_at at time zone 'UTC'     -> timestamptz for the stored UTC instant
--   Converting in the function, not altering the columns, keeps every other reader of purchases unchanged.
--
-- SECURITY: unchanged. SECURITY DEFINER with the caller check first: service_role, a platform admin, or a
-- member of the business (current_business_ids()). anon has no EXECUTE.
--
-- ROLLBACK: re-run the get_purchases_page definition in carefind_20261019_red_team_fixes.sql (it fails on
-- the live column types, as before).

create or replace function public.get_purchases_page(p_business_id uuid, p_search text default null, p_month text default null, p_year text default null, p_offset integer default 0, p_limit integer default 50)
returns table (id uuid, supplier_name text, product_name text, quantity integer, cost_price numeric, total_cost numeric, amount_paid numeric, balance numeric,
               supply_date text, due_date text, expiry text, batch text, status text, notes text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select p.id, p.supplier_name, p.product_name, p.quantity, p.cost_price, p.total_cost, p.amount_paid, p.balance, p.supply_date, p.due_date,
         p.expiry::text, p.batch, p.status, p.notes, (p.created_at at time zone 'UTC')::timestamptz
    from purchases p
   where p.business_id = p_business_id
     and (p_search is null or p_search = '' or p.supplier_name ilike '%' || p_search || '%' or p.product_name ilike '%' || p_search || '%')
     and (p_month is null or p_month = '' or p.created_at >= (p_month || '-01')::date)
     and (p_month is null or p_month = '' or p.created_at < ((p_month || '-01')::date + interval '1 month'))
     and (p_year is null or p_year = '' or p.created_at >= (p_year || '-01-01')::date)
     and (p_year is null or p_year = '' or p.created_at < ((p_year || '-01-01')::date + interval '1 year'))
   order by p.created_at desc
   offset p_offset limit p_limit;
end;
$$;

revoke all on function public.get_purchases_page(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.get_purchases_page(uuid, text, text, text, integer, integer) to authenticated, service_role;
