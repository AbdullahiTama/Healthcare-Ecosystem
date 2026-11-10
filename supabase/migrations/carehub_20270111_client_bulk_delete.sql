-- carehub_20270111_client_bulk_delete
--
-- Status: APPLIED TO PRODUCTION 2026-11-10 with the owner's approval (Supabase migration version 20261110091924),
-- applied verbatim from this file (statements only). Tested first on PGlite
-- (apps/carefind/src/test/clients/clientBulkDelete.db.test.js) with the live foreign keys to clients and their ON
-- DELETE rules, the live phone uniqueness index and the live current_business_ids(), is_business_owner(),
-- is_platform_admin(), read 2026-11-10. After applying: 25 clients, unchanged; deleted_clients RLS on, authenticated
-- SELECT only; delete_clients / restore_deleted_clients EXECUTE: authenticated only; can_delete_clients: nobody.
-- Live probe (DO blocks that raised at the end; afterwards 25 clients, 0 copies, 0 audit rows, 0 probe rows), on the
-- carehub.test pharmacy (one plain client, plus a temporary client with a debt):
--   cashier (no delete permission):            refused DELETE_NOT_ALLOWED
--   can_delete_clients called directly:        refused
--   owner of another business:                 refused DELETE_NOT_ALLOWED
--   owner deletes the plain + the owing client: 1 deleted; kept "PROBE owing" (debts); the debt still linked;
--                                               1 copy; audit {deleted 1, kept 1, requested 2}
--   owner restores:                            1 restored, same id and name
--   anon:                                      refused, permission denied for function delete_clients
--
-- PROBLEM
-- -------
-- The Clients page could not delete clients at all, one or many. A plain DELETE on clients is unsafe (live foreign
-- keys, 2026-11-10):
--   * REFUSED for a client with sales, appointments or consultations (NO ACTION), so one such client fails a bulk
--     request;
--   * silently UNLINKS their debts and customer requests (SET NULL), so a debt would no longer show whose it is;
--   * CASCADES away client_visits that point at the client as a global client record, and unlinks other client
--     records that use it as their global record (SET NULL).
--
-- FIX (the same design as carehub_20270109_inventory_bulk_delete)
-- ---
--   1. public.deleted_clients: a copy of every client deleted in bulk (full row as JSON), grouped by deletion, with who
--      and when, so a deletion can be undone. Read by members of the business; written only here.
--   2. delete_clients(business, client_ids): in one transaction, keeps and reports with every reason each client with
--      sales, appointments, consultations, debts, customer requests, or linked client records / visits; copies and
--      deletes the rest; writes one audit_log entry. Who: the Owner, or a role allowed to delete
--      (roles.permissions.canDelete), as for products.
--   3. restore_deleted_clients(business, deletion): puts the clients back with their ids. A client already back, or
--      whose phone number is now used by another client of the business (the phone must be unique per business), is
--      skipped and counted. Same people. Audit-logged.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened: today any member may DELETE clients through the API (RLS "clients of own business");
--     these functions are stricter (owner or delete-permission role) and never delete a client with history.
--   * SECURITY DEFINER, search_path public, pg_temp, caller checked first, one business only. EXECUTE: authenticated
--     only (anon revoked explicitly).
--   * deleted_clients: RLS on; members of the business SELECT their rows (client data they could already read); no
--     client writes; anon nothing. It holds personal data (names, phones): it is kept for restore and covered by the
--     same access rule as clients.
--
-- ROLLBACK
--   drop function public.restore_deleted_clients(uuid, uuid);
--   drop function public.delete_clients(uuid, uuid[]);
--   drop table public.deleted_clients;   -- only after restoring anything still needed from it

create table if not exists public.deleted_clients (
  id              uuid primary key default gen_random_uuid(),
  deletion_id     uuid not null,
  business_id     uuid not null,
  client_id       uuid not null,
  client_name     text,
  client          jsonb not null,
  deleted_by      uuid,
  deleted_by_name text,
  deleted_at      timestamptz not null default now(),
  restored_at     timestamptz,
  restored_by     uuid
);
create index if not exists deleted_clients_deletion_idx on public.deleted_clients (business_id, deletion_id);
create index if not exists deleted_clients_recent_idx on public.deleted_clients (business_id, deleted_at desc);

alter table public.deleted_clients enable row level security;
drop policy if exists "deleted clients of own business" on public.deleted_clients;
create policy "deleted clients of own business" on public.deleted_clients for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke all on public.deleted_clients from public, anon, authenticated;
grant select on public.deleted_clients to authenticated;
grant all on public.deleted_clients to service_role;

-- Owner, or an active staff member whose role may delete. Shared by the two functions below.
create or replace function public.can_delete_clients(p_business_id uuid)
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
revoke all on function public.can_delete_clients(uuid) from public, anon, authenticated;

create or replace function public.delete_clients(p_business_id uuid, p_client_ids uuid[])
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
  if not public.can_delete_clients(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can delete clients' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_target from unnest(coalesce(p_client_ids, '{}'::uuid[])) d where d is not null;
  v_requested := cardinality(v_target);
  if v_requested = 0 then
    raise exception 'DELETE_NONE: choose at least one client' using errcode = '22023';
  end if;
  if v_requested > 5000 then
    raise exception 'DELETE_TOO_MANY: delete at most 5,000 clients at a time' using errcode = '22023';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_target
    from (select id from public.clients where business_id = p_business_id and id = any (v_target) order by id for update) l;

  with reasons as (
    select c.id, c.full_name, array_remove(array[
             case when exists (select 1 from public.sales x where x.client_id = c.id) then 'sales' end,
             case when exists (select 1 from public.appointments x where x.client_id = c.id) then 'appointments' end,
             case when exists (select 1 from public.consultation_forms x where x.client_id = c.id)
                    or exists (select 1 from public.skincare_consultations x where x.client_id = c.id) then 'consultations' end,
             case when exists (select 1 from public.debts x where x.client_id = c.id) then 'debts' end,
             case when exists (select 1 from public.customer_requests x where x.client_id = c.id) then 'requests' end,
             case when exists (select 1 from public.clients x where x.global_client_id = c.id)
                    or exists (select 1 from public.client_visits x where x.global_client_id = c.id) then 'linked_records' end
           ], null) as why
      from public.clients c where c.id = any (v_target)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'reasons', to_jsonb(why)) order by full_name) filter (where cardinality(why) > 0), '[]'),
         coalesce(array_agg(id) filter (where cardinality(why) = 0), '{}')
    into v_kept, v_deletable
    from reasons;

  if cardinality(v_deletable) > 0 then
    select coalesce(nullif(s.full_name, ''), auth.email()) into v_actor_name
      from (select 1) one left join public.staff s
        on s.business_id = p_business_id and s.status = 'active' and lower(s.email) = lower(auth.email());

    insert into public.deleted_clients (deletion_id, business_id, client_id, client_name, client, deleted_by, deleted_by_name)
    select v_deletion, c.business_id, c.id, c.full_name, to_jsonb(c), auth.uid(), v_actor_name
      from public.clients c where c.id = any (v_deletable);

    delete from public.clients where id = any (v_deletable);
    get diagnostics v_deleted = row_count;

    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'clients.deleted', 'deletion', v_deletion,
            jsonb_build_object('deleted', v_deleted, 'kept', jsonb_array_length(v_kept), 'requested', v_requested));
  end if;

  return jsonb_build_object(
    'deletion_id', case when v_deleted > 0 then v_deletion end,
    'deleted', v_deleted,
    'kept', v_kept,
    'not_found', greatest(v_requested - cardinality(v_target), 0));
end $$;

revoke all on function public.delete_clients(uuid, uuid[]) from public, anon;
grant execute on function public.delete_clients(uuid, uuid[]) to authenticated;

create or replace function public.restore_deleted_clients(p_business_id uuid, p_deletion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_digits   text;
  v_restored int := 0;
  v_skipped_back int := 0;
  v_skipped_phone int := 0;
begin
  if not public.can_delete_clients(p_business_id) then
    raise exception 'DELETE_NOT_ALLOWED: only the owner, or a role allowed to delete, can restore clients' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deleted_clients where business_id = p_business_id and deletion_id = p_deletion_id) then
    raise exception 'RESTORE_NOT_FOUND: that deletion was not found' using errcode = 'P0002';
  end if;

  for r in
    select d.id, d.client_id, d.client
      from public.deleted_clients d
     where d.business_id = p_business_id and d.deletion_id = p_deletion_id and d.restored_at is null
     order by d.client_name, d.id
     for update
  loop
    v_digits := regexp_replace(coalesce(r.client ->> 'phone', ''), '[^0-9]', '', 'g');
    if exists (select 1 from public.clients where id = r.client_id) then
      v_skipped_back := v_skipped_back + 1;
    elsif v_digits <> '' and exists (select 1 from public.clients c where c.business_id = p_business_id
                                        and c.phone is not null and btrim(c.phone) <> ''
                                        and regexp_replace(c.phone, '[^0-9]', '', 'g') = v_digits) then
      v_skipped_phone := v_skipped_phone + 1;
    else
      insert into public.clients select (jsonb_populate_record(null::public.clients, r.client)).*;
      update public.deleted_clients set restored_at = now(), restored_by = auth.uid() where id = r.id;
      v_restored := v_restored + 1;
    end if;
  end loop;

  if v_restored > 0 then
    insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
    values (auth.uid(), case when public.is_business_owner(p_business_id) then 'owner' else 'staff' end, p_business_id,
            'clients.restored', 'deletion', p_deletion_id,
            jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_phone_taken', v_skipped_phone));
  end if;

  return jsonb_build_object('restored', v_restored, 'skipped_already_back', v_skipped_back, 'skipped_phone_taken', v_skipped_phone);
end $$;

revoke all on function public.restore_deleted_clients(uuid, uuid) from public, anon;
grant execute on function public.restore_deleted_clients(uuid, uuid) to authenticated;
