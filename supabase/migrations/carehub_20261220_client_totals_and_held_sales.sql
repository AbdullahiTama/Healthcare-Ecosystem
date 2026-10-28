-- Client totals that add up, and held sales that close properly once charged.
--
-- Written against the LIVE schema read on 2026-10-28:
--   * clients.total_spend (numeric) and clients.visit_count (integer) are shown on the Clients page, but nothing ever
--     wrote them after the client was created: all 13 clients read 0 visits, while 5 have completed sales.
--   * 375 sales carry a customer name but no client_id. 345 are "Walk-in"; 19 name exactly one client of their business.
--   * Charging a held sale inserts a new completed sale with resumed_from = the held row, and
--     sales_close_resumed_hold() (carehub_20261216) marks the held row status 'converted', but leaves it
--     is_on_hold = true with its whole total as balance: 24 rows read as still held and unpaid.
--   * 19 older held rows (HLD..., payment method 'On Hold', nothing paid) were flipped to status 'completed' by the
--     till before carehub_20261216. Each was charged as its own paid sale, so these rows double-count revenue and read
--     as unpaid sales.
--
-- WHAT THIS DOES
--   1. refresh_client_totals(client ids): visits = completed sales, spend = their total less refunds. A trigger on
--      sales keeps every affected client current on insert, update and delete. All clients are recomputed once.
--   2. Links the unlinked sales whose customer name matches exactly one client of the same business (case and
--      surrounding spaces ignored; "Walk-in" never).
--   3. A charged held row is closed: is_on_hold = false, balance = 0, status 'converted'. The existing 24 are closed.
--   4. The 19 legacy 'completed' held rows become 'resumed', the status the till already used for a held row that
--      was reopened and charged as a new sale. Nothing paid, no stock and no debts are attached to them.
--
-- A "completed sale" here is the app's own rule (salesReport.isCompletedSale): not on hold, and status empty or
-- 'completed'. Deleted, converted and resumed rows never count.
--
-- SECURITY: no permission is widened. The trigger function is SECURITY DEFINER only to write the two total columns of
-- clients of the sale's own business; it cannot be called directly. The close-held change keeps the function's
-- existing checks (same business, still held, not already closed).
--
-- ROLLBACK: drop trigger sales_refresh_client_totals and functions sales_refresh_client_totals() and
-- refresh_client_totals(uuid[]); re-create sales_close_resumed_hold() from carehub_20261216. Data changes are
-- recorded in the notes below and are reversible by status ('converted'/'resumed' rows keep their totals).

-- ── 1. Client totals ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.refresh_client_totals(p_client_ids uuid[])
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.clients c
     set visit_count = coalesce(t.visits, 0),
         total_spend = coalesce(t.spend, 0)
    from (select c2.id,
                 count(s.id) as visits,
                 sum(coalesce(s.total, 0) - coalesce(s.refunded_amount, 0)) as spend
            from public.clients c2
            left join public.sales s
              on s.client_id = c2.id
             and s.business_id = c2.business_id
             and coalesce(s.is_on_hold, false) = false
             and (s.status is null or s.status = 'completed')
             and s.deleted_at is null
           where c2.id = any(p_client_ids)
           group by c2.id) t
   where c.id = t.id
     and (c.visit_count is distinct from coalesce(t.visits, 0) or c.total_spend is distinct from coalesce(t.spend, 0))
$$;

create or replace function public.sales_refresh_client_totals()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.client_id is not null then perform public.refresh_client_totals(array[new.client_id]); end if;
  elsif tg_op = 'DELETE' then
    if old.client_id is not null then perform public.refresh_client_totals(array[old.client_id]); end if;
  else
    if coalesce(new.client_id, old.client_id) is not null then
      perform public.refresh_client_totals(array_remove(array[new.client_id, old.client_id], null));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists sales_refresh_client_totals on public.sales;
create trigger sales_refresh_client_totals
  after insert or delete or update of client_id, total, refunded_amount, status, is_on_hold, deleted_at on public.sales
  for each row execute function public.sales_refresh_client_totals();

-- ── 2. Link named sales to their client ──────────────────────────────────────────────────────────────────────────────
update public.sales s
   set client_id = m.client_id
  from (select s2.id as sale_id, min(c.id::text)::uuid as client_id
          from public.sales s2
          join public.clients c
            on c.business_id = s2.business_id
           and lower(btrim(c.full_name)) = lower(btrim(s2.client_name))
         where s2.client_id is null
           and nullif(btrim(s2.client_name), '') is not null
           and lower(btrim(s2.client_name)) <> 'walk-in'
         group by s2.id
        having count(*) = 1) m
 where s.id = m.sale_id;

-- ── 3. A charged held sale is closed, not left on hold ───────────────────────────────────────────────────────────────
create or replace function public.sales_close_resumed_hold()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rows integer;
begin
  if new.resumed_from is null or coalesce(new.is_on_hold, false) then return new; end if;
  update public.sales
     set status = 'converted',
         is_on_hold = false,
         balance = 0
   where id = new.resumed_from and business_id = new.business_id
     and coalesce(is_on_hold, false) and status is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This held sale was already completed or no longer exists' using errcode = '22023';
  end if;
  return new;
end $$;

update public.sales set is_on_hold = false, balance = 0
 where status = 'converted' and (coalesce(is_on_hold, false) or coalesce(balance, 0) <> 0);

-- ── 4. Legacy held rows wrongly marked completed ─────────────────────────────────────────────────────────────────────
update public.sales set status = 'resumed'
 where status = 'completed'
   and coalesce(is_on_hold, false) = false
   and payment_method = 'On Hold'
   and coalesce(amount_paid, 0) = 0
   and txn_no like 'HLD%';

-- ── Recompute every client once ──────────────────────────────────────────────────────────────────────────────────────
select public.refresh_client_totals(array(select id from public.clients));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.refresh_client_totals(uuid[]) from public, anon, authenticated;
revoke all on function public.sales_refresh_client_totals() from public, anon, authenticated;
revoke all on function public.sales_close_resumed_hold() from public, anon, authenticated;
