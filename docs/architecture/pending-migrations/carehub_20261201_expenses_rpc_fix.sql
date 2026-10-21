-- ============================================================================
-- Expenses: repair get_expenses_page and make the period filter use the date
-- the user recorded.
--
-- Status: DRAFT, NOT APPLIED. Needs owner approval before it goes to production.
--
-- Root cause (verified live on szdybxmgmhndoytqanfb, 2026-10-21, by calling the
-- RPCs as a business owner inside a rolled-back DO block):
--   get_expenses_page  -> ERROR "structure of query does not match function result type"
--   get_expense_totals -> ok       get_expense_summary -> ok
-- expenses.created_at is `timestamp without time zone`, but the function (added in
-- carefind_20261019_red_team_fixes) declares it `timestamp with time zone`.
-- plpgsql RETURN QUERY demands an exact type match, so every call fails. The
-- Expenses page loads page + totals + categories with Promise.all and an empty
-- catch, so one failure discards all three: the list stays empty and the total
-- stays at zero even though rows exist (12 rows, 194,600 live).
--
-- Second defect: all three RPCs filtered the month on created_at (when the row
-- was typed in), not on `date` (the transaction date the user entered). An
-- expense back-dated into last month counted in this month. Reports filters the
-- same way in the client; both now use expense_effective_date().
--
-- Defence in depth: a non-positive amount is refused by a CHECK (NOT VALID, so
-- existing rows are left alone), and (business_id, date) is indexed.
--
-- CREATE OR REPLACE keeps the three signatures unchanged, so no sibling
-- overload is left behind (see memory: reference-supabase-carehub-gotchas #1).
-- Re-read pg_proc.proacl after applying (gotcha #2).
-- ============================================================================

-- The calendar date an expense belongs to: the date the user recorded when it is
-- a valid YYYY-MM-DD, otherwise the day the row was created.
create or replace function public.expense_effective_date(p_date text, p_created_at timestamp without time zone)
returns date
language plpgsql immutable set search_path = public
as $$
begin
  if p_date ~ '^\d{4}-\d{2}-\d{2}$' then
    return p_date::date;
  end if;
  return p_created_at::date;
exception when others then
  return p_created_at::date;   -- e.g. 2026-02-31 matches the shape but is not a date
end;
$$;
revoke all on function public.expense_effective_date(text, timestamp without time zone) from public, anon;
grant execute on function public.expense_effective_date(text, timestamp without time zone) to authenticated, service_role;

-- Month bounds shared by the three readers. NULL/'' means all time.
create or replace function public.expense_month_start(p_month text)
returns date
language plpgsql immutable set search_path = public
as $$
begin
  if p_month is null or p_month = '' then return null; end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'p_month must be YYYY-MM' using errcode = '22023';
  end if;
  return (p_month || '-01')::date;
end;
$$;
revoke all on function public.expense_month_start(text) from public, anon;
grant execute on function public.expense_month_start(text) to authenticated, service_role;

create or replace function public.get_expense_totals(p_business_id uuid, p_month text default null)
returns table (total_amount numeric, transaction_count bigint)
language plpgsql stable security definer set search_path = public
as $$
declare v_start date := public.expense_month_start(p_month);
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select coalesce(sum(e.amount), 0)::numeric, count(*)::bigint
    from expenses e
   where e.business_id = p_business_id
     and (v_start is null
          or (public.expense_effective_date(e.date, e.created_at) >= v_start
              and public.expense_effective_date(e.date, e.created_at) < (v_start + interval '1 month')::date));
end;
$$;

create or replace function public.get_expense_summary(p_business_id uuid, p_month text default null)
returns table (total_amount numeric, transaction_count bigint, category text, category_amount numeric, category_count bigint)
language plpgsql stable security definer set search_path = public
as $$
declare v_start date := public.expense_month_start(p_month);
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select coalesce(sum(e.amount) over (), 0), count(*) over (), e.category, e.amount, 1::bigint
    from expenses e
   where e.business_id = p_business_id
     and (v_start is null
          or (public.expense_effective_date(e.date, e.created_at) >= v_start
              and public.expense_effective_date(e.date, e.created_at) < (v_start + interval '1 month')::date))
   order by e.amount desc;
end;
$$;

create or replace function public.get_expenses_page(p_business_id uuid, p_month text default null, p_offset integer default 0, p_limit integer default 50)
returns table (id uuid, category text, description text, amount numeric, date text, staff_name text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path = public
as $$
declare v_start date := public.expense_month_start(p_month);
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select e.id, e.category, e.description, e.amount, e.date, e.staff_name,
         e.created_at::timestamptz   -- the column is timestamp WITHOUT time zone; this cast was the missing piece
    from expenses e
   where e.business_id = p_business_id
     and (v_start is null
          or (public.expense_effective_date(e.date, e.created_at) >= v_start
              and public.expense_effective_date(e.date, e.created_at) < (v_start + interval '1 month')::date))
   order by public.expense_effective_date(e.date, e.created_at) desc, e.created_at desc, e.id
   offset p_offset limit p_limit;
end;
$$;

-- CREATE OR REPLACE does not reset privileges, but a first-time create on
-- Supabase re-grants to anon; restate the intended ACL.
revoke all on function public.get_expense_totals(uuid, text), public.get_expense_summary(uuid, text), public.get_expenses_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.get_expense_totals(uuid, text), public.get_expense_summary(uuid, text), public.get_expenses_page(uuid, text, integer, integer) to authenticated, service_role;

-- Money recorded as an expense is positive. NOT VALID: enforced for new/updated
-- rows, existing rows are not scanned or rejected.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_positive' and conrelid = 'public.expenses'::regclass) then
    alter table public.expenses add constraint expenses_amount_positive check (amount is not null and amount > 0) not valid;
  end if;
end $$;

create index if not exists expenses_business_date_idx on public.expenses (business_id, date);
