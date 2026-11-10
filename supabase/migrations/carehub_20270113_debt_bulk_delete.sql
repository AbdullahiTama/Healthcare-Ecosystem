-- carehub_20270113_debt_bulk_delete
--
-- Status: NOT APPLIED. Tested on PGlite (apps/carefind/src/test/debts/debtBulkDelete.db.test.js) with the live
-- stamp_recorded_by() / keep_recorded_by() / pos_actor() triggers, member_can_delete()
-- (carehub_20270112_expense_bulk_delete) and the live current_business_ids(), is_business_owner(),
-- is_platform_admin(), read 2026-11-10. Apply only with the owner's approval and record the result here.
--
-- PROBLEM
-- -------
-- Debts could not be deleted from the Debts page at all. A plain DELETE is possible through the API for any member,
-- but most debts are not free-standing (live, 2026-11-10: 36 from credit sales, 27 from purchases, 2 recorded by
-- hand): record_sale_payment, record_purchase_payment, edit_sale, edit_purchase and delete_sale find a sale's or
-- purchase's debt by (source, source_ref) and keep it in step. Deleting one would leave the sale or purchase owing
-- with no debt, and the next payment would have nothing to settle.
--
-- FIX (the same design as the product, client and expense bulk deletes)
-- ---
--   1. public.deleted_debts: a copy of every debt deleted (full row), grouped by deletion, with who and when.
--   2. delete_debts(business, debt_ids): deletes only debts recorded by hand (source 'manual' or none). A debt raised
--      by a credit sale or a purchase is kept and reported with the reason ('credit_sale' / 'purchase'), because it
--      belongs to that record: settle it, or correct or delete the sale / purchase, instead. Copies and audits.
--      Who: the Owner or a role allowed to delete (member_can_delete()).
--   3. restore_deleted_debts(business, deletion): puts each debt back with its id, amounts, status and original
--      recorder (as for expenses, the request identity is cleared for the insert only so the recorded-by stamp keeps
--      the original). A client link to a client deleted since is dropped (the party name is kept). A debt already
--      back is skipped. Audited.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened: any member may DELETE debts through the API today; these functions are stricter
--     (owner / delete role, hand-recorded debts only).
--   * SECURITY DEFINER, search_path public, pg_temp, caller checked first, one business; EXECUTE authenticated only.
--   * deleted_debts: RLS on; members of the business SELECT their rows; no client writes; anon nothing.
--
-- ROLLBACK
--   drop function public.restore_deleted_debts(uuid, uuid); drop function public.delete_debts(uuid, uuid[]);
--   drop table public.deleted_debts;

create table if not exists public.deleted_debts (
  id              uuid primary key default gen_random_uuid(),
  deletion_id     uuid not null,
  business_id     uuid not null,
  debt_id         uuid not null,
  party_name      text,
  debt            jsonb not null,
  deleted_by      uuid,
  deleted_by_name text,
  deleted_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid
);
create index if not exists deleted_debts_deletion_idx on public.deleted_debts (business_id, deletion_id);
create index if not exists deleted_debts_recent_idx on public.deleted_debts (business_id, deleted_at desc);

alter table public.deleted_debts enable row level security;
drop policy if exists "deleted debts of own business" on public.deleted_debts;
create policy "deleted debts of own business" on public.deleted_debts for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.deleted_debts from public, anon, authenticated;
grant select on public.deleted_debts to authenticated;
grant all on public.deleted_debts to service_role;

create or replace function public.delete_debts(p_business_id uuid, p_debt_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target     uuid[];
  v_requested  int;
  v_deletion   uuid := gen_random_uuid();
  v_actor_name text;
  v_kept       jsonb;
  v_deletable  uuid[];
  v_deleted    int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can delete debts' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_debt_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one debt' using errcode = '22023';
  end if;
  if v_requested > 5000 then
    raise exception 'DELETE_TOO_MANY: delete at most 5,000 debts at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_target
    from (select id from public.debts where business_id = p_business_id and id = any (v_target) order by id for update) l;

  -- A debt raised by a credit sale or a purchase belongs to that record and is kept.
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', coalesce(nullif(d.party_name, ''), 'Unnamed'),
                                               'reasons', jsonb_build_array(d.source), 'ref', d.source_ref) order by d.party_name, d.id)
                    filter (where coalesce(d.source, 'manual') <> 'manual'), '[]'),
         coalesce(array_agg(d.id) filter (where coalesce(d.source, 'manual') = 'manual'), '{}')
    into v_kept, v_deletable
    from public.debts d where d.id = any (v_target);

  if cardinality(v_deletable) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    insert into public.deleted_debts (deletion_id, business_id, debt_id, party_name, debt, deleted_by, deleted_by_name)
    select v_deletion, d.business_id, d.id, d.party_name, to_jsonb(d), auth.uid(), v_actor_name
      from public.debts d where d.id = any (v_deletable);

    delete from public.debts where id = any (v_deletable);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'debts.deleted', 'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'requested', v_requested,
                               'outstanding', (select coalesce(sum(greatest((debt ->> 'balance')::numeric, 0)), 0) from public.deleted_debts where deletion_id = v_deletion)));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

revoke all on function public.delete_debts(uuid, uuid[]) from public, anon;
grant execute on function public.delete_debts(uuid, uuid[]) to authenticated;

create or replace function public.restore_deleted_debts(p_business_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_claims   text := current_setting('request.jwt.claims', true);
  v_actor    uuid := auth.uid();
  v_owner    boolean;
  v_debt     jsonb;
  v_restored int := 0;
  v_skipped_back int := 0;
  v_unlinked int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can restore debts' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_debts where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;
  v_owner := public.is_business_owner(p_business_id);

  for r in
    select d.id, d.debt_id, d.debt
      from public.deleted_debts d
     where d.business_id = p_business_id and d.deletion_id = p_deletion_id and d.restored_at is null
     order by d.party_name, d.id
     for update
  loop
    if exists (select 1 from public.debts where id = r.debt_id) then
      v_skipped_back := v_skipped_back + 1;
      continue;
    end if;
    v_debt := r.debt;
    -- The client may have been deleted since: keep the party name, drop the link.
    if nullif(v_debt ->> 'client_id', '') is not null
       and not exists (select 1 from public.clients c where c.id = (v_debt ->> 'client_id')::uuid) then
      v_debt := v_debt || jsonb_build_object('client_id', null);
      v_unlinked := v_unlinked + 1;
    end if;

    -- Without the request's identity for this insert only, so the recorded-by stamp keeps the original recorder.
    perform set_config('request.jwt.claims', '', true);
    insert into public.debts select (jsonb_populate_record(null::public.debts, v_debt)).*;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

    update public.deleted_debts set restored_at = now(), restored_by = v_actor where id = r.id;
    v_restored := v_restored + 1;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (v_actor, case when v_owner then 'owner' else 'staff' end, p_business_id, 'debts.restored', 'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'client_unlinked', v_unlinked));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'client_unlinked', v_unlinked);
end $$;

revoke all on function public.restore_deleted_debts(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_debts(uuid, uuid) to authenticated;
