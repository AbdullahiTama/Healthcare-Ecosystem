-- Product catalogue, phase 3: moving stock between branches.
-- Design: docs/architecture/Product-Catalogue-Design.md §3.4 (owner's decisions, 2026-10-27: the owner and managers
-- send, any staff member of the receiving branch receives).
--
-- Written against the LIVE schema read on 2026-10-28:
--   * stock_transfers (carehub_20260810) exists but is unused: 0 rows, no app code, one product per row, and its only
--     policy ("tenant visibility", FOR ALL, no WITH CHECK) lets any member write rows directly.
--   * products.stock is the stock of a branch's product; products.master_product_id links it to the main business's
--     master item (carehub_20261215). tracking_mode is 'none' for every product (no batch tracking in use).
--   * stock_movements is the append-only stock ledger ('transfer' is an allowed movement_type).
--   * is_business_manager(bid): the owner (of the branch or any parent), an active manager of the branch, or a
--     platform admin.
--
-- WHAT THIS DOES
--   1. stock_transfers becomes the transfer header: number, from/to branch, status in_transit → received | cancelled,
--      who sent, received or cancelled it and when. Its old single-product columns stay, unused and optional.
--   2. stock_transfer_lines: one row per master item: quantity sent, quantity received (any shortfall is recorded).
--   3. send_stock_transfer(from, to, lines, note): owner or manager of the sending branch. Takes the stock from the
--      sending branch's products at once (it is in transit), records the movements, and notifies the receiving branch.
--   4. receive_stock_transfer(transfer, lines, note): any staff member of the receiving branch. Adds what arrived to the
--      receiving branch's products, creating the product from the master item when the branch did not carry it, and
--      records any shortfall.
--   5. cancel_stock_transfer(transfer, reason): owner or manager of the sending branch, while still in transit.
--      Returns the stock to the sending branch.
--   6. Reads stay under the existing visibility (both branches, the owner above them). Direct writes to the two
--      tables are refused: only the functions change them.
--
-- SECURITY: the three functions are SECURITY DEFINER because a transfer changes stock in two branches; each checks
-- the caller explicitly (sending branch manager, or receiving branch member) and that both branches belong to the
-- same main business. Every quantity is validated in the database, rows are locked, and each function is atomic.
--
-- ROLLBACK: drop the three functions, stock_transfer_lines, the added stock_transfers columns and policies; re-create
-- the policy "stock_transfers tenant visibility" (FOR ALL, from/to branch in current_business_ids() or admin).

-- ── 1. The transfer header ───────────────────────────────────────────────────────────────────────────────────────────
alter table public.stock_transfers
  alter column product_id drop not null,
  alter column product_name drop not null,
  alter column quantity drop not null,
  alter column requested_by drop not null,
  alter column status set default 'in_transit',
  add column if not exists transfer_no text,
  add column if not exists business_id uuid references public.businesses(id),
  add column if not exists sent_by uuid,
  add column if not exists sent_by_name text,
  add column if not exists sent_at timestamptz,
  add column if not exists received_by uuid,
  add column if not exists received_by_name text,
  add column if not exists received_at timestamptz,
  add column if not exists receive_note text,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_transfers_status_check') then
    alter table public.stock_transfers add constraint stock_transfers_status_check
      check (status in ('pending', 'approved', 'rejected', 'in_transit', 'received', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_transfers_branches_differ') then
    alter table public.stock_transfers add constraint stock_transfers_branches_differ check (from_branch_id <> to_branch_id);
  end if;
end $$;
create unique index if not exists stock_transfers_transfer_no on public.stock_transfers (transfer_no) where transfer_no is not null;
create index if not exists stock_transfers_business_created on public.stock_transfers (business_id, created_at desc);

-- ── 2. Lines ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references public.stock_transfers(id) on delete cascade,
  master_product_id uuid references public.master_products(id) on delete set null,
  from_product_id   uuid references public.products(id) on delete set null,
  to_product_id     uuid references public.products(id) on delete set null,
  product_name      text not null,
  qty_sent          integer not null check (qty_sent > 0),
  qty_received      integer check (qty_received >= 0 and qty_received <= qty_sent),
  unit_cost         numeric(14,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists stock_transfer_lines_transfer on public.stock_transfer_lines (transfer_id);

-- ── 6. Visibility: read only; the functions write ────────────────────────────────────────────────────────────────────
alter table public.stock_transfer_lines enable row level security;
drop policy if exists "stock_transfers tenant visibility" on public.stock_transfers;
drop policy if exists "stock transfers visible to both branches" on public.stock_transfers;
create policy "stock transfers visible to both branches" on public.stock_transfers for select
  using (from_branch_id in (select public.current_business_ids()) or to_branch_id in (select public.current_business_ids())
         or public.is_platform_admin());
drop policy if exists "stock transfer lines visible with their transfer" on public.stock_transfer_lines;
create policy "stock transfer lines visible with their transfer" on public.stock_transfer_lines for select
  using (transfer_id in (select t.id from public.stock_transfers t));
revoke insert, update, delete on public.stock_transfers, public.stock_transfer_lines from anon, authenticated;
grant select on public.stock_transfers, public.stock_transfer_lines to authenticated;
grant all on public.stock_transfers, public.stock_transfer_lines to service_role;

-- The display name of the caller in this branch (staff name, or the email).
create or replace function public.transfer_actor_name(p_business_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.full_name from public.staff s where s.business_id = p_business_id and lower(s.email) = lower(auth.email())
       and s.status = 'active' limit 1),
    auth.email(), 'CareHub')
$$;

-- ── 3. Send ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_lines: [{ "master_product_id": uuid, "qty": int }]. Returns { id, transfer_no, lines }.
create or replace function public.send_stock_transfer(p_from_branch_id uuid, p_to_branch_id uuid, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_root uuid; v_id uuid; v_no text; v_line jsonb; v_master uuid; v_qty integer; v_prod public.products%rowtype;
  v_count integer := 0; v_to_name text; v_from_name text;
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

    update public.products set stock = stock - v_qty where id = v_prod.id;
    insert into public.stock_movements (business_id, product_id, movement_type, quantity, qty_before, qty_after,
                                        source_type, source_id, reason, actor_id, moved_by)
    values (p_from_branch_id, v_prod.id, 'transfer', v_qty, v_prod.stock, v_prod.stock - v_qty,
            'branch_transfer_out', v_id::text, 'Sent to ' || coalesce(v_to_name, 'another location') || ' · ' || v_no,
            auth.uid(), auth.email());
    insert into public.stock_transfer_lines (transfer_id, master_product_id, from_product_id, product_name, qty_sent, unit_cost)
    values (v_id, v_master, v_prod.id, v_prod.name, v_qty, coalesce(v_prod.cost_price, 0));
    v_count := v_count + 1;
  end loop;

  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (p_to_branch_id, null, true, 'stock_transfer_sent', 'Stock on its way · ' || v_no,
          v_count || ' item' || case when v_count = 1 then '' else 's' end || ' sent from ' || coalesce(v_from_name, 'another location')
            || '. Receive them when they arrive.', '/dashboard/transfers');

  return jsonb_build_object('id', v_id, 'transfer_no', v_no, 'lines', v_count);
end $$;

-- ── 4. Receive ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_lines (optional): [{ "line_id": uuid, "qty_received": int }]; lines left out arrived in full.
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
      update public.products set stock = coalesce(stock, 0) + v_got where id = v_prod.id;
      insert into public.stock_movements (business_id, product_id, movement_type, quantity, qty_before, qty_after,
                                          source_type, source_id, reason, actor_id, moved_by)
      values (t.to_branch_id, v_prod.id, 'transfer', v_got, coalesce(v_prod.stock, 0), coalesce(v_prod.stock, 0) + v_got,
              'branch_transfer_in', t.id::text, 'Received from ' || coalesce(v_from_name, 'another location') || ' · ' || t.transfer_no,
              auth.uid(), auth.email());
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

-- ── 5. Cancel ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_stock_transfer(p_transfer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.stock_transfers%rowtype; l public.stock_transfer_lines%rowtype; v_stock integer;
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
    if l.from_product_id is not null then
      select coalesce(stock, 0) into v_stock from public.products where id = l.from_product_id for update;
      if found then
        update public.products set stock = coalesce(stock, 0) + l.qty_sent where id = l.from_product_id;
        insert into public.stock_movements (business_id, product_id, movement_type, quantity, qty_before, qty_after,
                                            source_type, source_id, reason, actor_id, moved_by)
        values (t.from_branch_id, l.from_product_id, 'transfer', l.qty_sent, v_stock, v_stock + l.qty_sent,
                'branch_transfer_cancel', t.id::text, 'Transfer ' || t.transfer_no || ' cancelled; stock returned', auth.uid(), auth.email());
      end if;
    end if;
  end loop;
  update public.stock_transfers
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), resolved_at = now(),
         cancel_reason = nullif(btrim(p_reason), '')
   where id = t.id;
  return jsonb_build_object('id', t.id, 'transfer_no', t.transfer_no, 'status', 'cancelled');
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.send_stock_transfer(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.receive_stock_transfer(uuid, jsonb, text) from public, anon;
revoke all on function public.cancel_stock_transfer(uuid, text) from public, anon;
revoke all on function public.transfer_actor_name(uuid) from public, anon, authenticated;
grant execute on function public.send_stock_transfer(uuid, uuid, jsonb, text), public.receive_stock_transfer(uuid, jsonb, text),
  public.cancel_stock_transfer(uuid, text) to authenticated, service_role;
