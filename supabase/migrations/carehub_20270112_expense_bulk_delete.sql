-- carehub_20270112_expense_bulk_delete
--
-- Status: NOT APPLIED. Tested on PGlite (apps/carefind/src/test/expenses/expenseBulkDelete.db.test.js) with
-- carehub_20270107_expense_payments, the live stamp_recorded_by() / keep_recorded_by() triggers, and the live
-- current_business_ids(), is_business_owner(), is_platform_admin(), read 2026-11-10. Apply only with the owner's
-- approval and record the result here.
--
-- PROBLEM
-- -------
-- Expenses could be deleted only one at a time, by a plain DELETE that (live foreign key, 2026-11-10) CASCADES away
-- the expense's payment history (expense_payments), with no record of who deleted it and no way back. A restore by
-- plain INSERT would also be wrong twice over: stamp_recorded_by() would credit the person restoring as the one who
-- recorded the expense, and expense_payment_history() would invent an "at recording" payment instead of the real
-- history.
--
-- FIX (the same design as the product and client bulk deletes)
-- ---
--   1. public.deleted_expenses: a copy of every expense deleted (full row) with its payment history, grouped by
--      deletion, with who and when.
--   2. delete_expenses(business, expense_ids): copies the expenses and their payments, deletes them (the history goes
--      with them, as before, but is kept in the copy), and writes one audit_log entry. Nothing is "kept back": no
--      other record depends on an expense. Who: the Owner or a role allowed to delete (roles.permissions.canDelete),
--      the rule the Expenses page already used for its Delete button.
--   3. restore_deleted_expenses(business, deletion): puts each expense back exactly: same id, amount, date, who
--      recorded it, and its original payment rows (same ids), then its paid amount, through the payment guard's own
--      switch. An expense already back is skipped and counted. Audited.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. Any member may DELETE expenses through the API today (RLS); these functions are stricter.
--   * SECURITY DEFINER, search_path public, pg_temp, caller checked first, one business only; EXECUTE authenticated
--     only. member_can_delete() is not callable by app users.
--   * Restoring clears the request's identity for its own inserts (set_config, local to the transaction) so the
--     recorded-by stamp keeps the original recorder; the identity is put back straight after. The audit entry names
--     the person who restored.
--   * deleted_expenses: RLS on; members of the business SELECT their rows; no client writes; anon nothing.
--
-- ROLLBACK
--   drop function public.restore_deleted_expenses(uuid, uuid); drop function public.delete_expenses(uuid, uuid[]);
--   drop function public.member_can_delete(uuid); drop table public.deleted_expenses;

create table if not exists public.deleted_expenses (
  id              uuid primary key default gen_random_uuid(),
  deletion_id     uuid not null,
  business_id     uuid not null,
  expense_id      uuid not null,
  label           text,
  expense         jsonb not null,
  payments        jsonb not null default '[]',
  deleted_by      uuid,
  deleted_by_name text,
  deleted_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid
);
create index if not exists deleted_expenses_deletion_idx on public.deleted_expenses (business_id, deletion_id);
create index if not exists deleted_expenses_recent_idx on public.deleted_expenses (business_id, deleted_at desc);

alter table public.deleted_expenses enable row level security;
drop policy if exists "deleted expenses of own business" on public.deleted_expenses;
create policy "deleted expenses of own business" on public.deleted_expenses for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.deleted_expenses from public, anon, authenticated;
grant select on public.deleted_expenses to authenticated;
grant all on public.deleted_expenses to service_role;

-- Owner, or an active staff member whose role may delete. (The product and client functions carry the same rule;
-- new functions use this one.)
create or replace function public.member_can_delete(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    public.is_business_owner(p_business_id)
    or exists (
      select 1 from public.staff s
        join public.roles r on r.business_id = s.business_id and r.name = s.role
       where s.business_id = p_business_id and s.status = 'active'
         and lower(s.email) = lower(auth.email())
         and coalesce((r.permissions ->> 'canDelete')::boolean, false)))
$$;
revoke all on function public.member_can_delete(uuid) from public, anon, authenticated;

create or replace function public.delete_expenses(p_business_id uuid, p_expense_ids uuid[])
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
  v_deleted    int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can delete expenses' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_expense_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one expense' using errcode = '22023';
  end if;
  if v_requested > 5000 then
    raise exception 'DELETE_TOO_MANY: delete at most 5,000 expenses at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_target
    from (select id from public.expenses where business_id = p_business_id and id = any (v_target) order by id for update) l;

  if cardinality(v_target) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    insert into public.deleted_expenses (deletion_id, business_id, expense_id, label, expense, payments, deleted_by, deleted_by_name)
    select v_deletion, x.business_id, x.id,
           coalesce(x.category, 'Expense') || coalesce(' · ' || nullif(x.description, ''), ''),
           to_jsonb(x),
           coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from public.expense_payments p where p.expense_id = x.id), '[]'),
           auth.uid(), v_actor_name
      from public.expenses x where x.id = any (v_target);

    delete from public.expenses where id = any (v_target);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'expenses.deleted', 'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'requested', v_requested,
                               'amount', (select coalesce(sum((expense ->> 'amount')::numeric), 0) from public.deleted_expenses where deletion_id = v_deletion)));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', '[]'::jsonb,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

revoke all on function public.delete_expenses(uuid, uuid[]) from public, anon;
grant execute on function public.delete_expenses(uuid, uuid[]) to authenticated;

create or replace function public.restore_deleted_expenses(p_business_id uuid, p_deletion_id uuid)
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
  v_row      public.expenses%rowtype;
  v_restored int := 0;
  v_skipped_back int := 0;
begin
  if not public.member_can_delete(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can restore expenses' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_expenses where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;
  v_owner := public.is_business_owner(p_business_id);

  for r in
    select d.id, d.expense_id, d.expense, d.payments
      from public.deleted_expenses d
     where d.business_id = p_business_id and d.deletion_id = p_deletion_id and d.restored_at is null
     order by d.label, d.id
     for update
  loop
    if exists (select 1 from public.expenses where id = r.expense_id) then
      v_skipped_back := v_skipped_back + 1;
      continue;
    end if;
    v_row := jsonb_populate_record(null::public.expenses, r.expense);

    -- Inserted with nothing paid, so no "at recording" payment is invented, and without the request's identity, so
    -- the recorded-by stamp keeps the original recorder. The identity is put back at once.
    perform set_config('request.jwt.claims', '', true);
    insert into public.expenses select (jsonb_populate_record(null::public.expenses, r.expense || jsonb_build_object('amount_paid', 0))).*;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

    insert into public.expense_payments
    select (jsonb_populate_record(null::public.expense_payments, p)).* from jsonb_array_elements(r.payments) p;

    if coalesce(v_row.amount_paid, 0) > 0 then
      perform set_config('carehub.expense_payment', 'on', true);
      update public.expenses set amount_paid = v_row.amount_paid where id = r.expense_id;
      perform set_config('carehub.expense_payment', 'off', true);
    end if;

    update public.deleted_expenses set restored_at = now(), restored_by = v_actor where id = r.id;
    v_restored := v_restored + 1;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (v_actor, case when v_owner then 'owner' else 'staff' end, p_business_id, 'expenses.restored', 'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back);
end $$;

revoke all on function public.restore_deleted_expenses(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_expenses(uuid, uuid) to authenticated;
