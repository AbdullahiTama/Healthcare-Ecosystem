-- carehub_20270114_purchase_bulk_edit_delete
--
-- Status: APPLIED TO PRODUCTION 2026-11-10 with the owner's approval (Supabase migration version 20261110134845),
-- applied verbatim from this file (statements only). Tested first on PGlite
-- (scripts/db-tests/purchaseBulkEditDelete.pglite.mjs, 56 checks) on top of
-- carehub_20261229_purchase_editing_and_analytics, whose edit_purchase, purchase_items_normalized,
-- purchase_line_received, can_edit_purchases and purchases_guard_direct_write match production byte for byte (md5 of
-- the live bodies, read 2026-11-10), and the live apply_stock_change (docs/architecture/stock-ledger-live-snapshot.sql,
-- md5 checked the same day), member_can_delete() (carehub_20270112_expense_bulk_delete) and the live
-- stamp_recorded_by() / keep_recorded_by() / pos_actor().
-- After applying: 32 purchases, 24 payment rows, 5,378 stock movements, unchanged; deleted_purchases RLS on,
-- authenticated SELECT only; bulk edit / delete / restore EXECUTE: authenticated only.
-- Live probe (DO block that raised at the end; afterwards 32 / 24 / 5,378, 0 copies, 0 audit rows, Paracetamol stock
-- 119 as before), on the carehub.test pharmacy's 2 purchases (recorded before line items) plus a purchase recorded in
-- the probe the way the app does (3 x Paracetamol 500mg, ₦100 paid of ₦300, receive_stock, debt):
--   cashier:                    bulk edit refused EDIT_NOT_ALLOWED; delete refused DELETE_NOT_ALLOWED
--   owner of another business:  delete refused DELETE_NOT_ALLOWED
--   owner bulk edit (all 3):    3 updated through edit_purchase, 0 skipped / failed; stock unchanged (122);
--                               the debt's due date followed (2026-12-31)
--   owner delete (all 3):       the probe purchase deleted, stock 122 -> 119, its payment and debt removed; the 2
--                               summary purchases kept ('not_linked'); audit {deleted 1, kept 2, total 300, paid 100,
--                               units taken back 3}
--   owner restores:             1 restored; stock back to 122; purchase row, payment rows and debt identical to before
--   anon:                       refused, permission denied for function delete_purchases
--
-- PROBLEM
-- -------
-- Purchases can be changed only one at a time (Edit purchase) and cannot be deleted at all: the direct-write guard
-- refuses UPDATE and DELETE from signed-in clients, because a purchase put stock into Inventory (through the stock
-- ledger, often into a batch of its own), may have supplier payments (purchase_payments, ON DELETE CASCADE) and may
-- have raised a "we owe" debt (debts source 'purchase', source_ref = purchase id). A mistaken purchase could only be
-- corrected line by line.
--
-- Live, 2026-11-10: 32 purchases, 305 lines; 20 purchases have units that were sold since (their stock cannot be
-- taken back), 8 lines recorded before the ledger stock a product nobody can identify; 22 purchases have payments.
--
-- FIX
-- ---
--   1. bulk_edit_purchases(business, ids, changes, reason, staff): the same supplier name / supply date / due date /
--      notes on many purchases, each through edit_purchase() itself (so the debt, the payment history's supplier name
--      and the audit follow exactly as for one edit), each in its own subtransaction: one purchase failing does not
--      undo the others. A purchase whose lines would make edit_purchase move stock (a line not linked to Inventory
--      that added nothing, or a line whose received stock differs from its quantity) is skipped and reported instead:
--      a header edit must never change stock. Who: can_edit_purchases (edit_purchase checks again).
--   2. public.deleted_purchases: a copy of every purchase deleted (full row), its payments, its debt and the stock it
--      took back, grouped by deletion, with who and when.
--   3. delete_purchases(business, ids): for each purchase, takes back the stock each line added (what
--      edit_purchase does when a line is removed: apply_stock_change through the ledger, out of the batch the line
--      created), copies it, deletes its debt and the purchase (its payments go with it, kept in the copy) and audits.
--      A purchase is KEPT, with the reason, when its stock cannot be taken back: units sold or moved since
--      ('stock_used', naming the product), a pre-ledger line not linked to a product ('not_linked'), a tracked
--      product without a batch to take from ('no_batch'), or the batch is gone ('batch_gone'). Each purchase is all
--      or nothing. Who: the Owner, or a role allowed to delete (member_can_delete) that may also edit purchases
--      (can_edit_purchases).
--   4. restore_deleted_purchases(business, deletion): puts each purchase back with its id, lines, totals, original
--      recorder and its original payment rows (inserted with nothing paid so no "at purchase" payment is invented,
--      then the paid amount), its debt, and puts the stock back into the same batch. A purchase whose product or batch
--      is gone since is skipped and named (nothing of it is restored). A purchase already back is skipped. Audited.
--   Products a purchase created stay in Inventory (with the stock taken back); product cost prices are not reverted.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. Today no client can update or delete a purchase directly (guard), and these functions
--     only do what edit_purchase already allows, plus deleting for the Owner / delete roles that may edit purchases.
--   * SECURITY DEFINER, search_path public, pg_temp, caller checked first, one business; EXECUTE authenticated only.
--     The guard lets these through because they run as the function owner (as edit_purchase does).
--   * Restoring clears the request identity for its own inserts only (set_config, local to the transaction) so the
--     recorded-by stamp keeps the original recorder; it is put back straight after. The audit names who restored.
--   * deleted_purchases: RLS on; members of the business SELECT their rows; no client writes; anon nothing.
--
-- ROLLBACK
--   drop function public.restore_deleted_purchases(uuid, uuid); drop function public.delete_purchases(uuid, uuid[]);
--   drop function public.bulk_edit_purchases(uuid, uuid[], jsonb, text, text); drop table public.deleted_purchases;

create table if not exists public.deleted_purchases (
  id              uuid primary key default gen_random_uuid(),
  deletion_id     uuid not null,
  business_id     uuid not null,
  purchase_id     uuid not null,
  supplier_name   text,
  purchase        jsonb not null,
  payments        jsonb not null default '[]',
  debts           jsonb not null default '[]',
  stock           jsonb not null default '[]',
  deleted_by      uuid,
  deleted_by_name text,
  deleted_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid
);
create index if not exists deleted_purchases_deletion_idx on public.deleted_purchases (business_id, deletion_id);
create index if not exists deleted_purchases_recent_idx on public.deleted_purchases (business_id, deleted_at desc);

alter table public.deleted_purchases enable row level security;
drop policy if exists "deleted purchases of own business" on public.deleted_purchases;
create policy "deleted purchases of own business" on public.deleted_purchases for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.deleted_purchases from public, anon, authenticated;
grant select on public.deleted_purchases to authenticated;
grant all on public.deleted_purchases to service_role;

-- ── Bulk edit ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.bulk_edit_purchases(p_business_id uuid, p_purchase_ids uuid[], p_changes jsonb,
                                                       p_reason text, p_staff_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes   jsonb := coalesce(p_changes, '{}'::jsonb);
  v_target    uuid[];
  v_p         public.purchases%rowtype;
  v_lines     jsonb;
  v_skip      text;
  v_supply    date;
  v_due       date;
  r           jsonb;
  v_rows      jsonb := '[]';
  v_failed    jsonb := '[]';
  v_skipped   jsonb := '[]';
  v_updated   int := 0;
  v_unchanged int := 0;
begin
  if auth.uid() is null or not public.can_edit_purchases(p_business_id) then
    raise exception 'EDIT_NOT_ALLOWED: only the owner, or a role allowed to edit purchases, can edit purchases' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'EDIT_REASON: say why the purchases are being changed (3 to 300 characters)' using errcode = '22023';
  end if;
  if jsonb_typeof(v_changes) <> 'object'
     or not (v_changes ?| array['supplier_name', 'supply_date', 'due_date', 'notes'])
     or exists (select 1 from jsonb_object_keys(v_changes) k where k not in ('supplier_name', 'supply_date', 'due_date', 'notes')) then
    raise exception 'EDIT_NOTHING: choose what to change (supplier, supply date, due date or notes)' using errcode = '22023';
  end if;
  begin
    if v_changes ? 'supply_date' then v_supply := (v_changes ->> 'supply_date')::date; end if;
    if nullif(v_changes ->> 'due_date', '') is not null then v_due := (v_changes ->> 'due_date')::date; end if;
  exception when others then
    raise exception 'EDIT_BAD_DATE: enter valid dates' using errcode = '22023';
  end;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_purchase_ids, '{}'::uuid[])) d where d is not null;
  if cardinality(v_target) = 0 then
    raise exception 'EDIT_NONE: choose at least one purchase' using errcode = '22023';
  end if;
  if cardinality(v_target) > 500 then
    raise exception 'EDIT_TOO_MANY: edit at most 500 purchases at a time' using errcode = '22023';
  end if;

  for v_p in select * from public.purchases where business_id = p_business_id and id = any (v_target) order by id loop
    v_lines := public.purchase_items_normalized(v_p);
    -- A header edit must never move stock: skip a purchase where edit_purchase would.
    select case
             when bool_or(nullif(x ->> 'product_id', '') is null and coalesce((x ->> 'ledger_base')::int, 0) = 0
                          and not coalesce((x ->> 'summary')::boolean, false)) then 'not_in_inventory'
             when bool_or(nullif(x ->> 'product_id', '') is not null
                          and coalesce((x ->> 'ledger_base')::int, 0)
                              + public.purchase_line_received(v_p.business_id, v_p.id, x ->> 'id', (x ->> 'product_id')::uuid)
                              <> trunc(public.purchase_num(x ->> 'qty'))::int) then 'stock_differs'
           end
      into v_skip
      from jsonb_array_elements(v_lines) x;
    if v_skip is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_p.id, 'name', v_p.supplier_name, 'reason', v_skip));
      continue;
    end if;

    begin
      r := public.edit_purchase(
        v_p.id,
        case when v_changes ? 'supplier_name' then v_changes ->> 'supplier_name' else v_p.supplier_name end,
        coalesce(v_supply, public.purchase_effective_date(v_p.supply_date, v_p.created_at)),
        case when v_changes ? 'due_date' then v_due else nullif(v_p.due_date, '')::date end,
        case when v_changes ? 'notes' then v_changes ->> 'notes' else v_p.notes end,
        v_lines, null, v_reason, p_staff_name, coalesce(v_p.edit_count, 0), coalesce(v_p.amount_paid, 0));
      if coalesce((r ->> 'unchanged')::boolean, false) then
        v_unchanged := v_unchanged + 1;
      else
        v_updated := v_updated + 1;
        v_rows := v_rows || jsonb_build_array(r -> 'purchase');
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', v_p.id, 'name', v_p.supplier_name, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('updated', v_updated, 'unchanged', v_unchanged, 'rows', v_rows, 'failed', v_failed, 'skipped', v_skipped);
end $$;

revoke all on function public.bulk_edit_purchases(uuid, uuid[], jsonb, text, text) from public, anon;
grant execute on function public.bulk_edit_purchases(uuid, uuid[], jsonb, text, text) to authenticated;

-- ── Delete ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_purchases(p_business_id uuid, p_purchase_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target     uuid[];
  v_requested  int;
  v_found      int;
  v_deletion   uuid := gen_random_uuid();
  v_actor_name text;
  v_p          public.purchases%rowtype;
  o            jsonb;
  v_pid        uuid;
  v_base       int;
  v_recv       int;
  v_batch      uuid;
  v_stock      jsonb;
  v_kept       jsonb := '[]';
  v_deleted    int := 0;
  v_parts      text[];
begin
  if not (public.member_can_delete(p_business_id) and public.can_edit_purchases(p_business_id)) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete and to edit purchases, can delete purchases' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_purchase_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one purchase' using errcode = '22023';
  end if;
  if v_requested > 500 then
    raise exception 'DELETE_TOO_MANY: delete at most 500 purchases at a time' using errcode = '22023';
  end if;
  select count(*) into v_found from public.purchases where business_id = p_business_id and id = any (v_target);

  select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
    from (select 1) one left join public.staff s
      on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

  for v_p in select * from public.purchases where business_id = p_business_id and id = any (v_target) order by id for update loop
    v_stock := '[]';
    begin
      -- Take back what each line added, as edit_purchase does for a removed line.
      for o in select value from jsonb_array_elements(public.purchase_items_normalized(v_p)) loop
        v_pid := nullif(o ->> 'product_id', '')::uuid;
        v_base := coalesce((o ->> 'ledger_base')::int, 0);
        if v_pid is null then
          if v_base > 0 then raise exception 'KEEP|not_linked|%', coalesce(o ->> 'name', ''); end if;
          continue;
        end if;
        -- The product was deleted since: its stock went with it, there is nothing to take back.
        continue when not exists (select 1 from public.products where id = v_pid and business_id = v_p.business_id);
        v_recv := v_base + public.purchase_line_received(v_p.business_id, v_p.id, o ->> 'id', v_pid);
        continue when v_recv <= 0;
        v_batch := nullif(o ->> 'batch_id', '')::uuid;
        if v_batch is null then
          select batch_id into v_batch from public.stock_movements
           where business_id = v_p.business_id and source_id = v_p.id::text and source_line_id = o ->> 'id' and product_id = v_pid
             and batch_id is not null order by created_at desc, id desc limit 1;
        end if;
        begin
          perform public.apply_stock_change(
            v_p.business_id, v_pid, -v_recv, 'correction', v_batch,
            'purchase_edit', v_p.id::text, o ->> 'id', 'Purchase from ' || v_p.supplier_name || ' deleted',
            'purchase_delete:' || v_deletion || ':' || (o ->> 'id') || ':' || v_pid, v_actor_name);
        exception
          when check_violation then
            if sqlerrm like 'INSUFFICIENT_STOCK%' then raise exception 'KEEP|stock_used|%', coalesce(o ->> 'name', ''); end if;
            if sqlerrm like 'BATCH_REQUIRED%' then raise exception 'KEEP|no_batch|%', coalesce(o ->> 'name', ''); end if;
            raise exception 'KEEP|stock_check|%', coalesce(o ->> 'name', '');
          when no_data_found then
            raise exception 'KEEP|batch_gone|%', coalesce(o ->> 'name', '');
        end;
        v_stock := v_stock || jsonb_build_array(jsonb_build_object(
          'line_id', o ->> 'id', 'product_id', v_pid, 'batch_id', v_batch, 'name', o ->> 'name', 'qty', v_recv));
      end loop;

      insert into public.deleted_purchases (deletion_id, business_id, purchase_id, supplier_name, purchase, payments, debts, stock, deleted_by, deleted_by_name)
      values (v_deletion, v_p.business_id, v_p.id, v_p.supplier_name, to_jsonb(v_p),
              coalesce((select jsonb_agg(to_jsonb(pp) order by pp.created_at, pp.id) from public.purchase_payments pp where pp.purchase_id = v_p.id), '[]'),
              coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at, d.id) from public.debts d
                         where d.business_id = v_p.business_id and d.source = 'purchase' and d.source_ref = v_p.id::text), '[]'),
              v_stock, auth.uid(), v_actor_name);
      delete from public.debts where business_id = v_p.business_id and source = 'purchase' and source_ref = v_p.id::text;
      delete from public.purchases where id = v_p.id;
      v_deleted := v_deleted + 1;
    exception when raise_exception then
      if sqlerrm not like 'KEEP|%' then raise; end if;
      v_parts := string_to_array(sqlerrm, '|');
      v_kept := v_kept || jsonb_build_array(jsonb_build_object(
        'id', v_p.id, 'name', coalesce(nullif(v_p.supplier_name, ''), 'Unknown supplier'), 'reasons', jsonb_build_array(v_parts[2]),
        'product', nullif(array_to_string(v_parts[3:], '|'), ''), 'ref', v_p.supply_date));
    end;
  end loop;

  if v_deleted > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'purchases.deleted', 'deletion', v_deletion,
            (select jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'requested', v_requested,
                                       'total_cost', coalesce(sum((purchase ->> 'total_cost')::numeric), 0),
                                       'amount_paid', coalesce(sum((purchase ->> 'amount_paid')::numeric), 0),
                                       'units_taken_back', coalesce(sum((select sum((s ->> 'qty')::int) from jsonb_array_elements(stock) s)), 0))
               from public.deleted_purchases where deletion_id = v_deletion));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - v_found, 0));
end $$;

revoke all on function public.delete_purchases(uuid, uuid[]) from public, anon;
grant execute on function public.delete_purchases(uuid, uuid[]) to authenticated;

-- ── Restore ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.restore_deleted_purchases(p_business_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r            record;
  v_claims     text := current_setting('request.jwt.claims', true);
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_owner      boolean;
  v_row        public.purchases%rowtype;
  d            jsonb;
  s            jsonb;
  v_restored   int := 0;
  v_skipped_back int := 0;
  v_skipped    jsonb := '[]';
begin
  if not (public.member_can_delete(p_business_id) and public.can_edit_purchases(p_business_id)) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete and to edit purchases, can restore purchases' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_purchases where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;
  v_owner := public.is_business_owner(p_business_id);
  select coalesce(nullif(st.full_name, ''), auth.email()) into v_actor_name
    from (select 1) one left join public.staff st
      on st.business_id = p_business_id and st.status = 'active' and lower(st.email) = lower(auth.email());

  for r in
    select x.id, x.purchase_id, x.purchase, x.payments, x.debts, x.stock, x.supplier_name
      from public.deleted_purchases x
     where x.business_id = p_business_id and x.deletion_id = p_deletion_id and x.restored_at is null
     order by x.supplier_name, x.id
     for update
  loop
    if exists (select 1 from public.purchases where id = r.purchase_id) then
      v_skipped_back := v_skipped_back + 1;
      continue;
    end if;
    v_row := jsonb_populate_record(null::public.purchases, r.purchase);
    begin
      -- Inserted with nothing paid (no "at purchase" payment is invented) and without the request's identity (the
      -- recorded-by stamp keeps the original recorder); the identity is put back at once.
      perform set_config('request.jwt.claims', '', true);
      insert into public.purchases select (jsonb_populate_record(null::public.purchases, r.purchase || jsonb_build_object('amount_paid', 0))).*;
      for d in select value from jsonb_array_elements(r.debts) loop
        continue when exists (select 1 from public.debts where id = (d ->> 'id')::uuid);
        if nullif(d ->> 'client_id', '') is not null
           and not exists (select 1 from public.clients c where c.id = (d ->> 'client_id')::uuid) then
          d := d || jsonb_build_object('client_id', null);
        end if;
        insert into public.debts select (jsonb_populate_record(null::public.debts, d)).*;
      end loop;
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

      -- supplier_key is generated from supplier_name, so it is left out.
      insert into public.purchase_payments (id, business_id, purchase_id, supplier_name, amount, method, kind, paid_on, note,
                                            balance_after, recorded_by, staff_name, created_at)
      select x.id, x.business_id, x.purchase_id, x.supplier_name, x.amount, x.method, x.kind, x.paid_on, x.note,
             x.balance_after, x.recorded_by, x.staff_name, x.created_at
        from jsonb_array_elements(r.payments) p, jsonb_populate_record(null::public.purchase_payments, p) x;
      if coalesce(v_row.amount_paid, 0) <> 0 then
        update public.purchases set amount_paid = v_row.amount_paid where id = r.purchase_id;
      end if;

      -- The stock goes back into the batch it was taken from.
      for s in select value from jsonb_array_elements(r.stock) loop
        begin
          perform public.apply_stock_change(
            p_business_id, (s ->> 'product_id')::uuid, (s ->> 'qty')::int, 'correction', nullif(s ->> 'batch_id', '')::uuid,
            'purchase_edit', r.purchase_id::text, s ->> 'line_id', 'Purchase from ' || r.supplier_name || ' restored',
            'purchase_restore:' || p_deletion_id || ':' || (s ->> 'line_id') || ':' || (s ->> 'product_id'), v_actor_name);
        exception when check_violation or no_data_found then
          raise exception 'SKIP|%', coalesce(s ->> 'name', '');
        end;
      end loop;

      update public.deleted_purchases set restored_at = now(), restored_by = v_actor where id = r.id;
      v_restored := v_restored + 1;
    exception when raise_exception then
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      if sqlerrm not like 'SKIP|%' then raise; end if;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', r.purchase_id, 'name', r.supplier_name,
                                                                     'product', substr(sqlerrm, 6)));
    end;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (v_actor, case when v_owner then 'owner' else 'staff' end, p_business_id, 'purchases.restored', 'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_stock', jsonb_array_length(v_skipped)));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back,
                            'skipped_stock', jsonb_array_length(v_skipped), 'skipped', v_skipped);
end $$;

revoke all on function public.restore_deleted_purchases(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_purchases(uuid, uuid) to authenticated;
