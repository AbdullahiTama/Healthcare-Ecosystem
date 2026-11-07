-- Centralised: a supply on credit takes the goods out of the company's stock (owner's decision, 2026-11-07).
-- 2027-01-06 (sequence date). Design: docs/architecture/Importer-Operating-Models.md §2 decision 2.
--
-- Status: APPLIED to the live carehub project 2026-11-07 in two parts (carehub_20270106_centralised_supply_takes_stock_1_entries:
-- constraint, conversion, rep_entry_apply_stock, reverse_rep_entry; _2_switching: reconciliation, preview, switch), on
-- the owner's decision. Live before applying: no custody in any Centralised company, so the conversion moved nothing;
-- the five live function bodies matched carehub_20270102 (md5) before, and match this file after; grants unchanged.
-- Rolled-back probe as the QA importer's owner (Decentralised, Ada's account holding 12): switch to Centralised
-- (company 184 unchanged, custody 12, reconciled 599 = 599); supply 4 (company 180, custody 16, 'custody_out'); good
-- return 1 (company 181, custody 15); switch to Decentralised (company 181 unchanged, account 15, reconciled). Nothing
-- kept. PGlite: apps/carefind/src/test/operating-models/centralisedSupplyStock.db.test.js and the updated
-- operatingModels.db.test.js (57 operating-model checks in all).
--
-- WHY
--   carehub_20270102 kept goods supplied to a Centralised representative inside the company's stock (custody only),
--   on the assumption that the representative rings the sale up on the company POS. The owner decided otherwise:
--   representatives take the goods to customers and sell them in the field, so the goods leave the company's stock
--   when they are handed over, as a credit supply normally does.
--
-- WHAT (Centralised only; Decentralised is unchanged)
--   * Supply: company stock -qty (stock ledger, 'transfer', source rep_supply) and +qty in the rep's custody.
--   * Accepted return: -qty custody; good condition goes back into company stock ('return_restock'); damaged or
--     expired only leaves custody (it never comes back into sellable stock, so there is nothing to write off).
--   * Transfer between reps: custody moves (no company stock change), as before.
--   * New entries carry stock_effect 'custody_out'. An entry recorded under the earlier rule ('custody') is not
--     reversed automatically (its stock was never taken out); reverse_rep_entry says to record an adjustment.
--   * Switching: to Decentralised, custody becomes stock in the rep's account without touching company stock, and any
--     quantity the owner chooses not to move goes back into company stock. To Centralised, stock in a rep account
--     that the company carries becomes custody without being added to company stock.
--   * operating_model_reconciliation counts custody with company and rep-account stock, so a switch still reconciles.
--   * One-time conversion: custody that a Centralised company holds under the earlier rule (counted inside its stock)
--     is taken out of its stock. Live at writing: no custody anywhere, so nothing moves. Idempotent per custody row.
--
-- SECURITY
--   No grant or policy changes. CREATE OR REPLACE keeps each function's grants. Every stock change still goes through
--   apply_stock_change inside the existing SECURITY DEFINER functions.
--
-- ROLLBACK
--   Re-run the five functions from carehub_20270102_importer_operating_models.sql. Entries recorded meanwhile keep
--   stock_effect 'custody_out'; their stock was taken out at supply, so correct them with adjustments if needed.

alter table public.rep_ledger_entries drop constraint if exists rep_ledger_entries_stock_effect_check;
alter table public.rep_ledger_entries add constraint rep_ledger_entries_stock_effect_check
  check (stock_effect in ('none', 'custody', 'custody_out', 'moved'));

-- One-time conversion of custody recorded under the earlier rule in Centralised companies.
do $$
declare k record; v_take integer;
begin
  for k in select c.id, c.company_id, c.company_product_id, c.quantity, p.stock, p.tracking_mode
             from public.rep_custody c
             join public.businesses b on b.id = c.company_id and b.operating_model = 'centralised'
             join public.products p on p.id = c.company_product_id and p.business_id = c.company_id
            where c.quantity > 0 loop
    v_take := least(k.quantity, greatest(coalesce(k.stock, 0), 0));
    if v_take > 0 and k.tracking_mode = 'none' then
      perform public.apply_stock_change(k.company_id, k.company_product_id, -v_take, 'transfer', null, 'rep_custody_rule_change',
        k.id::text, null, 'Goods in a representative''s custody leave company stock (rule change)', 'custody-rule:' || k.id, null);
    end if;
  end loop;
end $$;

create or replace function public.rep_entry_apply_stock(p_entry_id uuid, p_sign integer)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.rep_ledger_entries%rowtype; l public.rep_ledger_lines%rowtype; cp public.products%rowtype;
  v_rep public.company_representatives%rowtype; v_other public.company_representatives%rowtype;
  v_rep_prod uuid; v_other_prod uuid; v_q integer; v_tag text; v_mt text; v_src text; v_effect text := 'none';
begin
  select * into e from public.rep_ledger_entries where id = p_entry_id;
  if e.entry_type not in ('supply', 'return', 'transfer_out') then return 'none'; end if;
  select * into v_rep from public.company_representatives where id = e.representative_id;
  if e.entry_type = 'transfer_out' then
    select * into v_other from public.company_representatives where id = e.counterparty_representative_id;
  end if;
  v_tag := case when p_sign = 1 then '' else ':rev' end;
  v_src := 'rep_' || case e.entry_type when 'transfer_out' then 'transfer' else e.entry_type end || case when p_sign = 1 then '' else '_reversal' end;

  for l in select * from public.rep_ledger_lines where entry_id = e.id order by created_at, id loop
    v_q := l.quantity * p_sign;
    select * into cp from public.products where id = l.company_product_id and business_id = e.company_id;
    if not found then
      raise exception '% is no longer in the company''s products, so its stock cannot move. Record an adjustment instead.', l.product_name
        using errcode = '22023';
    end if;
    if cp.tracking_mode <> 'none' then
      raise exception '% is tracked by batch, so it cannot move to or from a representative yet.', cp.name using errcode = '22023';
    end if;

    if e.operating_model = 'decentralised' then
      v_effect := 'moved';
      if v_rep.rep_account_id is null or (e.entry_type = 'transfer_out' and v_other.rep_account_id is null) then
        raise exception 'This representative has no account yet.' using errcode = '22023';
      end if;
      v_mt := case when p_sign = 1 then 'transfer' else 'correction' end;
      if e.entry_type = 'supply' then
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        perform public.apply_stock_change(e.company_id, cp.id, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'To ' || v_rep.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'From the company · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':rep' || v_tag, null);
      elsif e.entry_type = 'return' then
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'Returned to the company (' || e.return_condition || ') · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':rep' || v_tag, null);
        if e.return_condition = 'good' then
          perform public.apply_stock_change(e.company_id, cp.id, v_q, case when p_sign = 1 then 'return_restock' else 'correction' end,
            null, v_src, e.id::text, l.id::text, 'Returned by ' || v_rep.full_name || ' · ' || e.entry_no,
            'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        end if;
      else
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        v_other_prod := public.rep_account_product(v_other.rep_account_id, cp.id);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'To ' || v_other.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':sender' || v_tag, null);
        perform public.apply_stock_change(v_other.rep_account_id, v_other_prod, v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'From ' || v_rep.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':receiver' || v_tag, null);
      end if;
      if p_sign = 1 and l.rep_product_id is null then
        perform set_config('carehub.rep_ledger_authority', 'on', true);
        update public.rep_ledger_lines set rep_product_id = v_rep_prod where id = l.id;
        perform set_config('carehub.rep_ledger_authority', '', true);
      end if;
    else
      -- Centralised (carehub_20270106): goods handed to a representative leave the company's stock and are held in
      -- their custody until they are sold in the field or returned. Good returns go back into company stock; damaged
      -- or expired returns only leave custody (they never come back into sellable stock).
      v_effect := 'custody_out';
      v_mt := case when p_sign = 1 then 'transfer' else 'correction' end;
      if e.entry_type = 'supply' then
        perform public.apply_stock_change(e.company_id, cp.id, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'To ' || v_rep.full_name || '''s custody · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, v_q);
      elsif e.entry_type = 'return' then
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, -v_q);
        if e.return_condition = 'good' then
          perform public.apply_stock_change(e.company_id, cp.id, v_q, case when p_sign = 1 then 'return_restock' else 'correction' end,
            null, v_src, e.id::text, l.id::text, 'Returned by ' || v_rep.full_name || ' · ' || e.entry_no,
            'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        end if;
      else
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, -v_q);
        perform public.rep_custody_add(e.company_id, v_other.id, cp.id, cp.name, v_q);
      end if;
    end if;
  end loop;
  return v_effect;
end $$;

create or replace function public.reverse_rep_entry(p_entry_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.rep_ledger_entries%rowtype; x public.rep_ledger_entries%rowtype; v_model text; v_id uuid; v_first uuid; v_no text; v_replay jsonb;
  l public.rep_ledger_lines%rowtype;
begin
  select * into e from public.rep_ledger_entries where id = p_entry_id for update;
  if not found then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  v_model := public.rep_ledger_require(e.company_id, 'manage');
  v_replay := public.rep_ledger_replay(e.company_id, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Give a reason for the reversal.' using errcode = '22023'; end if;
  if e.status <> 'posted' then raise exception 'Only a posted entry can be reversed.' using errcode = '22023'; end if;
  if e.entry_type = 'reversal' then raise exception 'A reversal cannot itself be reversed. Record an adjustment instead.' using errcode = '22023'; end if;
  if exists (select 1 from public.rep_ledger_entries where reverses_entry_id = e.id) then
    raise exception 'This entry has already been reversed.' using errcode = '22023';
  end if;
  if e.stock_effect = 'custody' then
    raise exception 'This entry was recorded under the earlier stock rule for Centralised supplies, so its stock cannot be undone automatically. Record an adjustment instead.'
      using errcode = '22023';
  end if;
  if e.stock_effect <> 'none' and e.operating_model <> v_model then
    raise exception 'The company changed operating model after this entry, so its stock cannot be undone automatically. Record an adjustment instead.'
      using errcode = '22023';
  end if;
  v_no := public.rep_ledger_new_entry_no();
  for x in select * from public.rep_ledger_entries
            where id = e.id or (e.transfer_group is not null and transfer_group = e.transfer_group) order by entry_type desc loop
    insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, debit, credit,
      description, reference, reason, counterparty_representative_id, reverses_entry_id, operating_model, stock_effect, idempotency_key,
      created_by, created_by_name, decided_by, decided_at)
    values (x.company_id, x.representative_id, v_no || case when x.entry_type = 'transfer_in' then '-IN' else '' end, 'reversal', 'posted',
      public.rep_ledger_check_date(null), x.credit, x.debit, 'Reversal of ' || x.entry_no, x.entry_no, btrim(p_reason),
      x.counterparty_representative_id, x.id, v_model, x.stock_effect,
      case when v_first is null then p_idempotency_key end,
      auth.uid(), public.rep_ledger_actor_name(x.company_id), auth.uid(), now())
    returning id into v_id;
    v_first := coalesce(v_first, v_id);
    for l in select * from public.rep_ledger_lines where entry_id = x.id loop
      insert into public.rep_ledger_lines (entry_id, company_product_id, master_product_id, rep_product_id, product_name, quantity, unit_value, line_value)
      values (v_id, l.company_product_id, l.master_product_id, l.rep_product_id, l.product_name, l.quantity, l.unit_value, l.line_value);
    end loop;
    if x.entry_type in ('supply', 'return', 'transfer_out') and x.stock_effect <> 'none' then
      perform public.rep_entry_apply_stock(x.id, -1);
    end if;
  end loop;
  perform public.rep_ledger_audit(e.company_id, 'rep_ledger.reversed', e.id, jsonb_build_object('entry_no', e.entry_no, 'reversal_no', v_no, 'reason', btrim(p_reason)));
  return jsonb_build_object('id', v_first, 'entry_no', v_no, 'status', 'posted', 'balance', public.rep_balance(e.representative_id));
end $$;

create or replace function public.operating_model_reconciliation(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with accounts as (
    select p_company as id
    union select r.rep_account_id from public.company_representatives r where r.company_id = p_company and r.rep_account_id is not null),
  -- Every unit the company is accountable for: its own stock, its representatives' accounts, and goods in custody
  -- (carehub_20270106: custody is outside company stock under Centralised).
  held as (
    select coalesce(p.master_product_id, p.id) as item, coalesce(p.stock, 0)::bigint as qty
      from public.products p where p.business_id in (select id from accounts)
    union all
    select coalesce(p.master_product_id, k.company_product_id), k.quantity::bigint
      from public.rep_custody k left join public.products p on p.id = k.company_product_id
     where k.company_id = p_company and k.quantity <> 0),
  units as (select item, sum(qty)::bigint as qty from held group by 1),
  cost as (
    select distinct on (coalesce(p.master_product_id, p.id)) coalesce(p.master_product_id, p.id) as item, coalesce(p.cost_price, 0) as unit_cost
      from public.products p where p.business_id = p_company order by coalesce(p.master_product_id, p.id), coalesce(p.stock, 0) desc, p.id)
  select jsonb_build_object(
    'ledger_entries', (select count(*) from public.rep_ledger_entries where company_id = p_company),
    'pending_entries', (select count(*) from public.rep_ledger_entries where company_id = p_company and status = 'pending'),
    'total_balance', (select coalesce(sum(debit - credit), 0) from public.rep_ledger_entries where company_id = p_company and status = 'posted'),
    'balances', (select coalesce(jsonb_object_agg(r.id, public.rep_balance(r.id)), '{}'::jsonb)
                   from public.company_representatives r where r.company_id = p_company),
    'stock_units', (select coalesce(sum(qty), 0) from units),
    'stock_value', (select round(coalesce(sum(u.qty * c.unit_cost), 0), 2) from units u join cost c on c.item = u.item),
    'custody_units', (select coalesce(sum(quantity), 0) from public.rep_custody where company_id = p_company),
    'items', (select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb) from units))
$$;

create or replace function public.operating_model_preview(p_company uuid, p_target text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_model text; v_reps jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  r record; v_stock jsonb; v_held integer; v_transit integer; v_pending integer; v_staff public.staff%rowtype;
  v_orders integer; v_credit_count integer; v_credit_total numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.' using errcode = '42501'; end if;
  v_model := public.operating_company_model(p_company);
  if not (public.is_platform_admin() or public.is_business_owner_email(auth.email(), p_company)) then
    raise exception 'Only the company owner can change the operating model.' using errcode = '42501';
  end if;
  if p_target not in ('centralised', 'decentralised') then
    raise exception 'Choose Centralised or Decentralised.' using errcode = '22023';
  end if;
  if p_target = v_model then
    raise exception 'The company already runs the % model.', v_model using errcode = '22023';
  end if;

  select count(*) into v_pending from public.rep_ledger_entries where company_id = p_company and status = 'pending';
  if v_pending > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'pending_entries', 'count', v_pending,
      'message', v_pending || ' return(s) or transfer(s) are awaiting approval. Approve or reject them first.');
  end if;

  for r in select * from public.company_representatives where company_id = p_company order by full_name loop
    v_staff := null;
    select * into v_staff from public.staff where id = r.staff_id;
    if p_target = 'decentralised' then
      select coalesce(jsonb_agg(jsonb_build_object('company_product_id', k.company_product_id, 'product_name', k.product_name,
               'custody', k.quantity, 'company_stock', coalesce(p.stock, 0), 'carry', k.quantity)
               order by k.product_name), '[]'::jsonb)
        into v_stock from public.rep_custody k left join public.products p on p.id = k.company_product_id
       where k.representative_id = r.id and k.quantity > 0;
      if r.status = 'active' and (v_staff.id is null or v_staff.status <> 'active') then
        v_blockers := v_blockers || jsonb_build_object('code', 'rep_without_login', 'representative_id', r.id,
          'message', r.full_name || ' has no active login. Wait for them to accept their invitation, or make them inactive.');
      end if;
      select count(*) into v_held from public.sales
       where business_id = p_company and cashier_staff_id = r.staff_id and is_on_hold
         and coalesce(status, '') not in ('resumed', 'converted', 'deleted') and deleted_at is null;
      if v_held > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'held_sales_stay', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_held || ' held sale(s) on the company POS. They stay company sales.');
      end if;
      -- Field orders the rep raised on the company account are the company's orders: company staff finish them.
      select count(*) into v_orders from public.orders
       where business_id = p_company and created_by_staff_id = r.staff_id and status in ('submitted', 'approved', 'processing', 'dispatched');
      if v_orders > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'open_orders_stay', 'representative_id', r.id, 'count', v_orders,
          'message', r.full_name || ' has ' || v_orders || ' open order(s) on the company account. They stay company orders; company staff approve, dispatch and deliver them.');
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('rep_product_id', p.id, 'product_name', p.name, 'stock', p.stock,
               'company_product_id', cp.id, 'returns_to_company', cp.id is not null) order by p.name), '[]'::jsonb)
        into v_stock
        from public.products p
        left join lateral (select c2.id from public.products c2 where c2.business_id = p_company and c2.master_product_id = p.master_product_id
                            and p.master_product_id is not null order by coalesce(c2.stock, 0) desc, c2.id limit 1) cp on true
       where p.business_id = r.rep_account_id and coalesce(p.stock, 0) > 0 and r.rep_account_id is not null;
      if exists (select 1 from jsonb_array_elements(v_stock) x where not (x ->> 'returns_to_company')::boolean) then
        v_warnings := v_warnings || jsonb_build_object('code', 'unlinked_stock', 'representative_id', r.id,
          'message', r.full_name || ' holds products the company does not carry. They stay in ' || r.full_name || '''s archived account.');
      end if;
      select count(*) into v_held from public.sales
       where business_id = r.rep_account_id and is_on_hold and coalesce(status, '') not in ('resumed', 'converted', 'deleted') and deleted_at is null;
      if v_held > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'held_sales', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_held || ' held sale(s) in their own account. Complete or delete them first.');
      end if;
      select count(*) into v_transit from public.stock_transfers
       where status = 'in_transit' and (from_branch_id = r.rep_account_id or to_branch_id = r.rep_account_id);
      if v_transit > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'transfers_in_transit', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_transit || ' stock transfer(s) in transit. Receive or cancel them first.');
      end if;
      -- Open orders in the rep's own account: a rep loses access to the account, so they must be finished first
      -- (otherwise nobody who knows them could deliver them, and they would be raised a second time centrally).
      select count(*) into v_orders from public.orders
       where business_id = r.rep_account_id and status in ('submitted', 'approved', 'processing', 'dispatched');
      if v_orders > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'open_orders', 'representative_id', r.id, 'count', v_orders,
          'message', r.full_name || ' has ' || v_orders || ' open order(s) in their own account. Deliver, reject or cancel them first.');
      end if;
      -- Customers who owe the rep for credit sales: the sales stay in the archived account, where the company owner
      -- can still collect them (Locations); nothing is moved or written off.
      select count(*), coalesce(sum(balance), 0) into v_credit_count, v_credit_total from public.sales
       where business_id = r.rep_account_id and coalesce(is_credit, false) and coalesce(balance, 0) > 0 and deleted_at is null
         and coalesce(status, '') not in ('deleted', 'refunded');
      if v_credit_count > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'customer_credit_in_account', 'representative_id', r.id,
          'count', v_credit_count, 'amount', round(v_credit_total, 2),
          'message', r.full_name || '''s customers owe ₦' || to_char(round(v_credit_total, 2), 'FM999,999,999,990.00') || ' on '
            || v_credit_count || ' credit sale(s). They stay in ' || r.full_name || '''s archived account, where the owner can still collect them.');
      end if;
    end if;
    v_reps := v_reps || jsonb_build_object('id', r.id, 'full_name', r.full_name, 'rep_code', r.rep_code, 'status', r.status,
      'has_login', v_staff.id is not null and v_staff.status = 'active', 'rep_account_id', r.rep_account_id,
      'reuses_account', r.rep_account_id is not null, 'balance', public.rep_balance(r.id),
      'converts', case when p_target = 'centralised' then r.rep_account_id is not null or (v_staff.id is not null and v_staff.business_id <> p_company)
                       else r.status = 'active' and v_staff.id is not null and v_staff.status = 'active' end,
      'stock', v_stock);
  end loop;

  return jsonb_build_object('company_id', p_company, 'from', v_model, 'to', p_target,
    'token', public.operating_model_state_token(p_company), 'representatives', v_reps,
    'blockers', v_blockers, 'warnings', v_warnings,
    'total_balance', (select coalesce(sum(debit - credit), 0) from public.rep_ledger_entries where company_id = p_company and status = 'posted'),
    'changes', case when p_target = 'decentralised' then jsonb_build_array(
        'Each active representative gets their own account with their own POS, stock, selling prices, sales and records.',
        'Representatives stop selling through the company account; only company staff do.',
        'Goods in each representative''s custody become stock in their own account; any you choose not to move go back into the company''s stock.',
        'Balances and ledger history carry over unchanged.')
      else jsonb_build_array(
        'Representatives return to the company account as staff and sell through the company POS and stock.',
        'Stock in their accounts that the company carries is recorded as goods in their custody (outside the company''s stock).',
        'Their own accounts are kept, read-only in practice, with all sales and records.',
        'Balances and ledger history carry over unchanged.') end);
end $$;

create or replace function public.switch_operating_model(p_company uuid, p_target text, p_token text,
  p_stock_plan jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_preview jsonb; v_from text; r public.company_representatives%rowtype; k public.rep_custody%rowtype; p public.products%rowtype;
  v_account uuid; v_rep_prod uuid; v_qty integer; v_plan jsonb; v_cp uuid; v_moved jsonb := '[]'::jsonb; v_exceptions jsonb := '[]'::jsonb;
  v_change uuid := gen_random_uuid(); v_converted integer := 0; v_stock integer; v_found boolean; v_result jsonb;
  v_before jsonb; v_after jsonb; v_mismatch text;
begin
  perform 1 from public.businesses where id = p_company for update;
  v_preview := public.operating_model_preview(p_company, p_target);
  v_from := v_preview ->> 'from';
  if p_token is null or p_token <> v_preview ->> 'token' then
    raise exception 'Something changed since you reviewed the summary. Review it again before confirming.' using errcode = '40001';
  end if;
  if jsonb_array_length(v_preview -> 'blockers') > 0 then
    raise exception 'Resolve the items listed before switching: %', (v_preview -> 'blockers' -> 0 ->> 'message') using errcode = '22023';
  end if;
  v_before := public.operating_model_reconciliation(p_company);

  if p_target = 'decentralised' then
    -- Active representatives get (or get back) their own account; inactive ones stay company-side.
    for r in select * from public.company_representatives where company_id = p_company and status = 'active' order by full_name loop
      v_account := public.rep_move_to_account(r.id);
      v_converted := v_converted + 1;
      for k in select * from public.rep_custody where representative_id = r.id and quantity > 0 order by product_name loop
        v_plan := null;
        if p_stock_plan is not null and jsonb_typeof(p_stock_plan) = 'array' then
          select x into v_plan from jsonb_array_elements(p_stock_plan) x
           where (x ->> 'representative_id')::uuid = r.id and (x ->> 'company_product_id')::uuid = k.company_product_id limit 1;
        end if;
        v_qty := coalesce((v_plan ->> 'qty')::integer, k.quantity);
        if v_qty < 0 or v_qty > k.quantity then
          raise exception 'The quantity for % (%) must be between 0 and %.', k.product_name, r.full_name, k.quantity using errcode = '22023';
        end if;
        -- carehub_20270106: custody is outside company stock, so it moves into the account without touching the company's
        -- stock; whatever the owner chooses not to move goes back into company stock.
        select * into p from public.products where id = k.company_product_id and business_id = p_company for update;
        v_found := found;
        if not v_found or p.master_product_id is null or p.tracking_mode <> 'none' then
          v_exceptions := v_exceptions || jsonb_build_object('representative_id', r.id, 'product', k.product_name,
            'message', k.product_name || case when not v_found then ' is no longer a company product; it stays recorded as custody.'
              else ' is not linked to the master catalogue or is batch-tracked, so it goes back into company stock.' end);
          v_qty := 0;
        end if;
        if v_qty > 0 then
          v_rep_prod := public.rep_account_product(v_account, p.id);
          perform public.apply_stock_change(v_account, v_rep_prod, v_qty, 'transfer', null, 'operating_model_switch', v_change::text, k.id::text,
            'From your custody (model change)', 'model:' || v_change || ':' || k.id || ':rep', null);
        end if;
        if v_found and k.quantity - v_qty > 0 then
          perform public.apply_stock_change(p_company, p.id, k.quantity - v_qty, 'transfer', null, 'operating_model_switch', v_change::text, k.id::text,
            'Back from ' || r.full_name || '''s custody (model change)', 'model:' || v_change || ':' || k.id || ':company', null);
        end if;
        v_moved := v_moved || jsonb_build_object('representative_id', r.id, 'product', k.product_name, 'custody', k.quantity, 'moved', v_qty);
        if v_found then
          update public.rep_custody set quantity = 0, updated_at = now() where id = k.id;
        end if;
      end loop;
    end loop;
  else
    -- Every representative working in their own account comes back, whatever their status.
    for r in select * from public.company_representatives where company_id = p_company order by full_name loop
      if r.rep_account_id is not null then
        for p in select * from public.products where business_id = r.rep_account_id and coalesce(stock, 0) > 0 order by name for update loop
          v_cp := null;
          select c2.id into v_cp from public.products c2
           where c2.business_id = p_company and c2.master_product_id = p.master_product_id and p.master_product_id is not null
           order by coalesce(c2.stock, 0) desc, c2.id limit 1;
          if v_cp is null or p.tracking_mode <> 'none' then
            v_exceptions := v_exceptions || jsonb_build_object('representative_id', r.id, 'product', p.name,
              'message', p.stock || ' of ' || p.name || ' stay in ' || r.full_name || '''s archived account ('
                || case when v_cp is null then 'not a company product' else 'batch-tracked' end || ').');
            continue;
          end if;
          perform public.apply_stock_change(r.rep_account_id, p.id, -p.stock, 'transfer', null, 'operating_model_switch', v_change::text, p.id::text,
            'Into your custody with the company (model change)', 'model:' || v_change || ':' || p.id || ':rep', null);
          -- carehub_20270106: the goods stay with the representative, now as custody outside company stock.
          perform public.rep_custody_add(p_company, r.id, v_cp, p.name, p.stock);
          v_moved := v_moved || jsonb_build_object('representative_id', r.id, 'product', p.name, 'moved', p.stock);
        end loop;
      end if;
      if r.rep_account_id is not null or exists (select 1 from public.staff s where s.id = r.staff_id and s.business_id <> p_company) then
        perform public.rep_move_to_company(r.id);
        v_converted := v_converted + 1;
      end if;
    end loop;
  end if;

  update public.businesses set operating_model = p_target, operating_model_changed_at = now() where id = p_company;

  -- Validation (spec 9.4): nothing may be gained or lost. Any difference raises, which rolls the whole switch back, so
  -- the company is never left half converted.
  v_after := public.operating_model_reconciliation(p_company);
  v_mismatch := case
    when v_after -> 'ledger_entries' <> v_before -> 'ledger_entries' then 'ledger entries'
    when v_after -> 'pending_entries' <> v_before -> 'pending_entries' then 'pending entries'
    when v_after -> 'balances' <> v_before -> 'balances' then 'representative balances'
    when v_after -> 'items' <> v_before -> 'items' then 'stock quantities'
    when v_after -> 'stock_value' <> v_before -> 'stock_value' then 'stock value'
  end;
  if v_mismatch is not null then
    raise exception 'The switch was cancelled and nothing changed: % did not reconcile after the move. Please contact CareHub support.', v_mismatch
      using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object('change_id', v_change, 'from', v_from, 'to', p_target, 'converted', v_converted,
                                 'stock', v_moved, 'exceptions', v_exceptions, 'effective_at', now(),
                                 'reconciliation', jsonb_build_object('balanced', true,
                                   'before', v_before - 'items' - 'balances', 'after', v_after - 'items' - 'balances',
                                   'items_checked', (select count(*) from jsonb_object_keys(v_after -> 'items'))));
  insert into public.operating_model_changes (id, company_id, from_model, to_model, initiated_by, initiated_by_name, summary, result, exceptions, note)
  values (v_change, p_company, v_from, p_target, auth.uid(), public.rep_ledger_actor_name(p_company), v_preview, v_result, v_exceptions,
          nullif(btrim(p_note), ''));
  perform public.rep_ledger_audit(p_company, 'operating_model.switched', v_change,
    jsonb_build_object('from', v_from, 'to', p_target, 'converted', v_converted, 'exceptions', jsonb_array_length(v_exceptions)));
  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (p_company, null, true, 'operating_model_changed', 'Operating model changed to ' || initcap(p_target),
          v_converted || ' representative(s) moved to the new structure. Balances and history are unchanged.', '/dashboard/settings');
  -- Company staff who manage or view representative accounts (not the representatives themselves, notified above).
  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  select p_company, s.id, false, 'operating_model_changed', 'Operating model changed to ' || initcap(p_target),
         v_converted || ' representative(s) moved to the new structure. Balances and history are unchanged.', '/dashboard/representatives'
    from public.staff s join public.roles ro on ro.business_id = s.business_id and ro.name = s.role
   where s.business_id = p_company and s.status = 'active'
     and ((ro.permissions ->> 'canManageRepLedger') = 'true' or (ro.permissions ->> 'canViewRepLedger') = 'true')
     and not exists (select 1 from public.company_representatives cr where cr.staff_id = s.id);
  return v_result;
end $$;
