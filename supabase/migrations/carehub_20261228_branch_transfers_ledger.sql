-- Branch transfers onto the stock ledger.
-- 2026-10-30. Docs: docs/architecture/Stock-Ledger.md
-- APPLIED to the live carehub project 2026-10-30 as carehub_20261228_branch_transfers_ledger (version 20261030221602)
-- after a rolled-back probe. The live bodies of the three functions match this file (md5).
--
-- WHY
-- send_stock_transfer, receive_stock_transfer and cancel_stock_transfer (carehub_20261222; live bodies identical to
-- that file apart from CRLF line endings) wrote products.stock directly and inserted their own stock_movements rows,
-- outside apply_stock_change:
--   * A send recorded a POSITIVE quantity for stock that left the branch (40 -> 25 journalled as +15), the opposite
--     of every other decrease in the ledger, so summing a product's movements was wrong.
--   * No idempotency key, no source line, and no batch handling: a batch-tracked product's stock would have moved
--     without its batches, breaking products.stock = sum(batches).
-- Live at the time: 0 transfers, 0 lines, 0 transfer movements, one business with a branch. Nothing to correct.
--
-- WHAT
-- The same three functions, unchanged apart from how stock moves (permissions, checks, messages, notifications and
-- return values are the same):
--   * send: the line is written first, then apply_stock_change(-qty, 'transfer', source 'branch_transfer_out',
--     source_id the transfer, source_line_id the line, key transfer:<transfer>:<line>:out).
--   * receive: apply_stock_change(+qty received, 'branch_transfer_in', key ...:in), including into a product created
--     from the master item at that moment.
--   * cancel: apply_stock_change(+qty sent, 'branch_transfer_cancel', key ...:cancel) back to the sending product,
--     skipped (as before) when that product no longer exists.
--   * A batch-tracked product is refused with a sentence (sending, or receiving into one), instead of moving its stock
--     without its batches. None is tracked live; carrying batch and expiry between branches is a later step.
--   * Services move no stock (as apply_stock_change does everywhere).
-- The ledger row's actor is still the signed-in user (auth.uid(), auth.email()).
--
-- SECURITY
-- Unchanged: SECURITY DEFINER with the same explicit checks (manager of the sending branch to send or cancel, member
-- of the receiving branch to receive, both branches under the same main business). apply_stock_change is reached only
-- from inside them and is scoped to the branch whose stock moves.
--
-- ROLLBACK
-- Re-run the three functions from supabase/migrations/carehub_20261222_branch_stock_transfers.sql.

create or replace function public.send_stock_transfer(p_from_branch_id uuid, p_to_branch_id uuid, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_root uuid; v_id uuid; v_no text; v_line jsonb; v_master uuid; v_qty integer; v_prod public.products%rowtype;
  v_count integer := 0; v_to_name text; v_from_name text; v_line_id uuid;
begin
  if p_from_branch_id is null or p_to_branch_id is null or p_from_branch_id = p_to_branch_id then
    raise exception 'Choose two different locations.' using errcode = '22023';
  end if;
  if not public.is_business_manager(p_from_branch_id) then
    raise exception 'Only the owner or a manager of the sending location can send stock.' using errcode = '42501';
  end if;
  v_root := public.business_root(p_from_branch_id);
  if v_root is null or v_root is distinct from (select public.business_root(p_to_branch_id)) then
    raise exception 'Stock can only move between locations of the same business.' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to send.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'A transfer can hold up to 200 items. Split it into two.' using errcode = '22023';
  end if;

  select coalesce(branch_name, name) into v_from_name from public.businesses where id = p_from_branch_id;
  select coalesce(branch_name, name) into v_to_name from public.businesses where id = p_to_branch_id;
  v_no := 'TRF-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
  insert into public.stock_transfers (from_branch_id, to_branch_id, business_id, transfer_no, status, notes,
                                      requested_by, sent_by, sent_by_name, sent_at)
  values (p_from_branch_id, p_to_branch_id, v_root, v_no, 'in_transit', coalesce(nullif(btrim(p_note), ''), ''),
          auth.uid(), auth.uid(), public.transfer_actor_name(p_from_branch_id), now())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_master := (v_line->>'master_product_id')::uuid;
      v_qty := (v_line->>'qty')::integer;
    exception when others then
      raise exception 'Each item needs a product and a whole-number quantity.' using errcode = '22023';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantities must be greater than zero.' using errcode = '22023';
    end if;
    -- The sending branch's product for this master item; with duplicates, the one holding the most stock.
    select * into v_prod from public.products
     where business_id = p_from_branch_id and master_product_id = v_master
     order by coalesce(stock, 0) desc, id limit 1 for update;
    if not found then
      raise exception 'An item in this transfer is not carried at %.', v_from_name using errcode = '22023';
    end if;
    if exists (select 1 from public.stock_transfer_lines where transfer_id = v_id and master_product_id = v_master) then
      raise exception '% is listed twice. Combine the quantities.', v_prod.name using errcode = '22023';
    end if;
    if coalesce(v_prod.stock, 0) < v_qty then
      raise exception 'Only % of % in stock at %.', coalesce(v_prod.stock, 0), v_prod.name, v_from_name using errcode = '22023';
    end if;

    if v_prod.tracking_mode <> 'none' then
      raise exception '% is tracked by batch, so it cannot be sent between locations yet.', v_prod.name using errcode = '22023';
    end if;

    insert into public.stock_transfer_lines (transfer_id, master_product_id, from_product_id, product_name, qty_sent, unit_cost)
    values (v_id, v_master, v_prod.id, v_prod.name, v_qty, coalesce(v_prod.cost_price, 0))
    returning id into v_line_id;
    -- Through the stock ledger (carehub_20261228): a decrease, one movement per line.
    perform public.apply_stock_change(p_from_branch_id, v_prod.id, -v_qty, 'transfer', null, 'branch_transfer_out', v_id::text,
      v_line_id::text, 'Sent to ' || coalesce(v_to_name, 'another location') || ' · ' || v_no,
      'transfer:' || v_id || ':' || v_line_id || ':out', null);
    v_count := v_count + 1;
  end loop;

  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (p_to_branch_id, null, true, 'stock_transfer_sent', 'Stock on its way · ' || v_no,
          v_count || ' item' || case when v_count = 1 then '' else 's' end || ' sent from ' || coalesce(v_from_name, 'another location')
            || '. Receive them when they arrive.', '/dashboard/transfers');

  return jsonb_build_object('id', v_id, 'transfer_no', v_no, 'lines', v_count);
end $$;

create or replace function public.receive_stock_transfer(p_transfer_id uuid, p_lines jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.stock_transfers%rowtype; l public.stock_transfer_lines%rowtype; m public.master_products%rowtype;
  v_got integer; v_given jsonb; v_prod public.products%rowtype; v_short integer := 0; v_from_name text;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found or not (t.to_branch_id in (select public.current_business_ids()) or public.is_platform_admin()) then
    raise exception 'Transfer not found.' using errcode = 'P0002';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'This transfer is already %.', t.status using errcode = '22023';
  end if;
  select coalesce(branch_name, name) into v_from_name from public.businesses where id = t.from_branch_id;

  for l in select * from public.stock_transfer_lines where transfer_id = t.id order by created_at, id loop
    select e into v_given from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e where (e->>'line_id')::uuid = l.id limit 1;
    begin
      v_got := coalesce((v_given->>'qty_received')::integer, l.qty_sent);
    exception when others then
      raise exception 'Received quantities must be whole numbers.' using errcode = '22023';
    end;
    if v_got < 0 or v_got > l.qty_sent then
      raise exception 'Received for % must be between 0 and %.', l.product_name, l.qty_sent using errcode = '22023';
    end if;

    -- The receiving branch's product for this item, created from the master item if the branch did not carry it.
    select * into v_prod from public.products
     where business_id = t.to_branch_id and master_product_id = l.master_product_id
     order by coalesce(stock, 0) desc, id limit 1 for update;
    if not found then
      select * into m from public.master_products where id = l.master_product_id;
      insert into public.products (business_id, master_product_id, name, generic_name, category, price, cost_price, stock,
                                   reorder_level, barcode, sale_type, list_on_carefind, emoji, rx_status, price_source)
      values (t.to_branch_id, l.master_product_id, coalesce(m.name, l.product_name), coalesce(m.generic_name, ''),
              coalesce(m.category, ''), coalesce(m.default_price, 0), coalesce(m.default_cost, l.unit_cost), 0,
              coalesce(m.reorder_level, 5), m.barcode, 'retail', true, '💊', m.rx_status, 'master')
      returning * into v_prod;
      insert into public.branch_products (branch_id, master_product_id, active, override_price)
      values (t.to_branch_id, l.master_product_id, true, null)
      on conflict (branch_id, master_product_id) do update set active = true;
    end if;

    if v_got > 0 then
      if v_prod.tracking_mode <> 'none' then
        raise exception '% is tracked by batch here, so it cannot be received from a transfer yet. Ask the sender to cancel it.', v_prod.name
          using errcode = '22023';
      end if;
      -- Through the stock ledger (carehub_20261228): one movement per line received.
      perform public.apply_stock_change(t.to_branch_id, v_prod.id, v_got, 'transfer', null, 'branch_transfer_in', t.id::text,
        l.id::text, 'Received from ' || coalesce(v_from_name, 'another location') || ' · ' || t.transfer_no,
        'transfer:' || t.id || ':' || l.id || ':in', null);
    end if;
    update public.stock_transfer_lines set qty_received = v_got, to_product_id = v_prod.id where id = l.id;
    v_short := v_short + (l.qty_sent - v_got);
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(), received_by_name = public.transfer_actor_name(t.to_branch_id),
         received_at = now(), resolved_at = now(), receive_note = nullif(btrim(p_note), '')
   where id = t.id;

  if v_short > 0 then
    insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    values (t.from_branch_id, null, true, 'stock_transfer_short', 'Transfer ' || t.transfer_no || ' arrived short',
            v_short || ' unit' || case when v_short = 1 then '' else 's' end || ' did not arrive. See the transfer for details.',
            '/dashboard/transfers');
  end if;
  return jsonb_build_object('id', t.id, 'transfer_no', t.transfer_no, 'shortfall', v_short);
end $$;

create or replace function public.cancel_stock_transfer(p_transfer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.stock_transfers%rowtype; l public.stock_transfer_lines%rowtype;
begin
  select * into t from public.stock_transfers where id = p_transfer_id for update;
  if not found or not (t.from_branch_id in (select public.current_business_ids()) or t.to_branch_id in (select public.current_business_ids())
                       or public.is_platform_admin()) then
    raise exception 'Transfer not found.' using errcode = 'P0002';
  end if;
  if not public.is_business_manager(t.from_branch_id) then
    raise exception 'Only the owner or a manager of the sending location can cancel a transfer.' using errcode = '42501';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'Only a transfer still in transit can be cancelled; this one is %.', t.status using errcode = '22023';
  end if;
  for l in select * from public.stock_transfer_lines where transfer_id = t.id loop
    -- Back to the sending product through the stock ledger (carehub_20261228); skipped if that product is gone.
    if l.from_product_id is not null
       and exists (select 1 from public.products where id = l.from_product_id and business_id = t.from_branch_id) then
      perform public.apply_stock_change(t.from_branch_id, l.from_product_id, l.qty_sent, 'transfer', null, 'branch_transfer_cancel',
        t.id::text, l.id::text, 'Transfer ' || t.transfer_no || ' cancelled; stock returned',
        'transfer:' || t.id || ':' || l.id || ':cancel', null);
    end if;
  end loop;
  update public.stock_transfers
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), resolved_at = now(),
         cancel_reason = nullif(btrim(p_reason), '')
   where id = t.id;
  return jsonb_build_object('id', t.id, 'transfer_no', t.transfer_no, 'status', 'cancelled');
end $$;

revoke all on function public.send_stock_transfer(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.receive_stock_transfer(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_stock_transfer(uuid, text) from public, anon;
grant execute on function public.send_stock_transfer(uuid, uuid, jsonb, text), public.receive_stock_transfer(uuid, jsonb, text),
  public.cancel_stock_transfer(uuid, text) to authenticated, service_role;
