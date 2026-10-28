-- Staff offboarding (complete removal) and one-business staff scope.
--
-- Docs: docs/architecture/Staff-Membership.md
-- Depends on: C21 (sql/20261009_staff_invitations_and_role_governance.sql: guard_staff_writes,
--   accept_staff_invitation, staff_email_conflict, can_manage_staff_as, is_staff_owner_level,
--   role_grants_staff_management, mint_confirmed_auth_user), carehub_20261217_staff_activity.sql.
--
-- ── What was wrong ──────────────────────────────────────────────────────────
--   * Removing a staff member was a plain DELETE. Fifteen foreign keys to staff do not cascade, so anyone who had
--     used the system could not be removed at all, only set inactive. When a delete did succeed, their Supabase login
--     was left behind, along with notifications, viewer lists and rep data that pointed at nobody.
--   * current_business_ids() gave a staff member every branch under their business, not just their own, so through
--     the API a cashier at the main shop could read and write every branch's records. The app hides the branch
--     switcher from staff, but that was a screen rule only.
--   * staff.email was unique only case-sensitively, and a business could be registered with an email that is a staff
--     member's login, making one person both an owner and someone else's staff.
--
-- ── Rules after this migration (owner's decisions, 2026-10-28) ──────────────
--   Removing a staff member (remove_staff_member) deletes the person:
--     - the staff row;
--     - their login, when it was created for this membership and is not used anywhere else (a pre-existing personal
--       CareFind account is never deleted; it just loses access to the business);
--     - their personal working data: notifications, activity viewer and default-viewer entries, order watching,
--       territory assignments, CareFind profile claims, rep customer, colleague and entry lists.
--   It keeps the business's own records, unlinked from the person, with the name already stored on them:
--     sales, payments, till shifts, orders, internal messages, field reports, comments and reactions, warehouse
--     manager slots (emptied), directory suggestions and ADR notification logs.
--   Attendance check-ins are kept with the person's name stored on them (staff_checkins.staff_name).
--   One audit_log row records who removed whom.
--
--   A staff member belongs to exactly one business: only that business's data is visible to them (no branches), one
--   email is one staff record anywhere (case-insensitive), and an email that is staff somewhere cannot become a
--   business login, nor can a staff record whose email is a business login be made active.
--
-- ── Security ────────────────────────────────────────────────────────────────
--   * remove_staff_member is SECURITY DEFINER (it must delete rows the caller's RLS cannot see, and the login). It
--     applies the same authorisation as guard_staff_writes: only someone who may manage this business's staff; never
--     yourself; only the Owner may remove someone who manages staff.
--   * Direct DELETE on staff by browser roles is now refused, so removal always goes through this one path.
--   * A login is deleted only when nothing outside this membership references it (checked against every foreign key
--     to auth.users), so a staff member's own CareFind wallet, posts or orders are never touched.
--   * current_business_ids() only ever narrows: owners keep their whole tree; staff lose branches.
--
-- Rollback: restore current_business_ids, guard_staff_writes, accept_staff_invitation and staff_activity from their
--   previous migrations; drop function remove_staff_member(uuid); drop trigger guard_business_email_not_staff on
--   businesses; drop index staff_email_lower_key; point staff_checkins_append_only back to location_tables_append_only
--   and restore sale_payments_append_only / directory_suggestions_before_update. Added columns may stay.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
-- Attendance outlives the membership: the name is stored when the person is removed.
alter table public.staff_checkins add column if not exists staff_name text;

-- Whether staff.auth_user_id was created for this membership (and so may be deleted with it).
alter table public.staff add column if not exists owns_login boolean not null default false;

-- Existing logins: created at or after the staff row means it was minted for it (provision_staff_auth / the
-- invitation); one that already existed is the person's own account.
update public.staff s
   set owns_login = true
  from auth.users u
 where u.id = s.auth_user_id
   and u.created_at >= s.created_at::timestamptz - interval '1 minute'
   and not s.owns_login;

-- ── 2. One email, one staff record, anywhere ────────────────────────────────
create unique index if not exists staff_email_lower_key on public.staff (lower(email));

-- ── 3. Staff see only their own business ────────────────────────────────────
create or replace function public.current_business_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  -- Owners: the businesses they own and every branch below, within each business's depth limit.
  WITH RECURSIVE visible AS (
    SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth
    FROM businesses b
    WHERE lower(b.email) = lower(auth.email())

    UNION ALL

    SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
    FROM businesses child
    INNER JOIN visible ON child.parent_business_id = visible.id
    WHERE visible.depth < visible.branch_depth_limit
  )
  SELECT id FROM visible
  UNION
  -- Staff: exactly the one business they are an active member of, never its branches.
  SELECT b.id
  FROM businesses b
  INNER JOIN staff s ON s.business_id = b.id
  WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
$function$;

-- ── 4. A staff email cannot become a business login ─────────────────────────
create or replace function public.guard_business_email_not_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and lower(new.email) is not distinct from lower(old.email) then
    return new;
  end if;
  -- An email that is already a business login (an owner adding a branch) is that owner's identity already.
  if new.email is not null
     and exists (select 1 from public.staff s where lower(s.email) = lower(new.email))
     and not exists (select 1 from public.businesses b where lower(b.email) = lower(new.email) and b.id is distinct from new.id) then
    raise exception 'This email is a staff member''s login at a CareHub business. Use a different email, or ask that business to remove the staff member first.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'guard_business_email_not_staff' and tgrelid = 'public.businesses'::regclass) then
    create trigger guard_business_email_not_staff
      before insert or update of email on public.businesses
      for each row execute function public.guard_business_email_not_staff();
  end if;
end $$;

-- ── 5. guard_staff_writes: no direct deletes; owns_login immutable; no reactivating a conflicting email ─────────
create or replace function public.guard_staff_writes()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor text := lower(coalesce(auth.email(), ''));
  v_biz uuid := coalesce(new.business_id, old.business_id);
  v_owner_level boolean;
  v_conflict text;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Staff members are added by invitation. Use "Invite staff" on the Staff page.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Staff members are removed with "Remove" on the Staff page, which also clears their login and personal data.' using errcode = '42501';
  end if;
  if not public.can_manage_staff_as(v_actor, v_biz) then
    raise exception 'You do not have permission to manage staff for this business.' using errcode = '42501';
  end if;
  v_owner_level := public.is_staff_owner_level(v_actor, v_biz);
  if lower(old.email) = v_actor then
    raise exception 'You cannot change or remove your own staff membership. Ask the business owner.' using errcode = '42501';
  end if;
  if not v_owner_level and public.role_grants_staff_management(old.business_id, old.role) then
    raise exception 'Only the business owner can change a staff member who manages staff.' using errcode = '42501';
  end if;
  if new.business_id is distinct from old.business_id
     or lower(new.email) is distinct from lower(old.email)
     or new.auth_user_id is distinct from old.auth_user_id
     or new.owns_login is distinct from old.owns_login
     or new.invited_at is distinct from old.invited_at
     or new.invited_by_email is distinct from old.invited_by_email
     or new.invite_token_hash is distinct from old.invite_token_hash
     or new.invite_expires_at is distinct from old.invite_expires_at
     or new.accepted_at is distinct from old.accepted_at then
    raise exception 'A staff member''s business, email and login cannot be edited. Remove them and send a new invitation instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'invited' or new.status not in ('active', 'inactive') then
      raise exception 'An invitation becomes active only when the invitee accepts it.' using errcode = '42501';
    end if;
    if new.status = 'active' then
      v_conflict := public.staff_email_conflict(new.business_id, new.email, new.id);
      if v_conflict is not null then
        raise exception '%', v_conflict using errcode = '42501';
      end if;
    end if;
  end if;
  if new.role is distinct from old.role then
    if lower(trim(coalesce(new.role, ''))) in ('', 'owner') then
      raise exception '"Owner" is the business account itself and cannot be assigned to staff.' using errcode = '42501';
    end if;
    if not v_owner_level and public.role_grants_staff_management(new.business_id, new.role) then
      raise exception 'Only the business owner can assign a role that manages staff.' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ── 6. accept_staff_invitation records whether it created the login ─────────
create or replace function public.accept_staff_invitation(p_token text, p_password text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_row public.staff%rowtype;
  v_email text;
  v_conflict text;
  v_uid uuid;
  v_confirmed timestamptz;
  v_created boolean := false;
  v_minted boolean := false;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'This invitation link is invalid.'; end if;
  select * into v_row from public.staff
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and status = 'invited'
   for update;
  if v_row.id is null then raise exception 'This invitation link is invalid or has already been used.'; end if;
  if v_row.invite_expires_at <= now() then
    raise exception 'This invitation has expired. Ask your administrator to send a new one.';
  end if;
  v_email := lower(v_row.email);
  v_conflict := public.staff_email_conflict(v_row.business_id, v_email, v_row.id);
  if v_conflict is not null then raise exception '%', v_conflict; end if;
  select id, email_confirmed_at into v_uid, v_confirmed from auth.users where lower(email) = v_email;
  if v_uid is not null and v_confirmed is not null then
    if lower(coalesce(auth.email(), '')) <> v_email then
      raise exception 'An account already exists for %. Sign in with your existing password to accept this invitation.', v_email
        using errcode = '42501';
    end if;
  else
    if p_password is null or length(p_password) < 8 then
      raise exception 'Choose a password of at least 8 characters.';
    end if;
    if v_uid is null then
      v_uid := public.mint_confirmed_auth_user(v_email, p_password);
      v_minted := true;
    else
      update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')),
                            email_confirmed_at = now(), updated_at = now()
       where id = v_uid;
    end if;
    v_created := true;
  end if;
  update public.staff set status = 'active', auth_user_id = v_uid, owns_login = v_minted, accepted_at = now(),
                          invite_token_hash = null, invite_expires_at = null
   where id = v_row.id;
  return jsonb_build_object('email', v_email, 'account_created', v_created);
end $function$;

-- ── 7. Append-only ledgers accept exactly one change: unlinking a removed person ─────────────────────────────────
-- Only server code (not the browser roles) may make it, and every other column must be unchanged.

create or replace function public.staff_checkins_append_only()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user NOT IN ('authenticated', 'anon')
     AND NEW.staff_id IS NULL AND NEW.staff_name IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['staff_id', 'staff_name']) = (to_jsonb(OLD) - ARRAY['staff_id', 'staff_name']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $function$;

create or replace trigger staff_checkins_append_only
  before delete or update on public.staff_checkins
  for each row execute function public.staff_checkins_append_only();

create or replace function public.sale_payments_append_only()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') AND NEW.staff_id IS NULL
     AND (to_jsonb(NEW) - 'staff_id') = (to_jsonb(OLD) - 'staff_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'sale_payments is append-only: record a refund instead of editing a payment';
END $function$;

create or replace function public.directory_suggestions_before_update()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  -- Unlinking a removed staff member (remove_staff_member): nothing else may change.
  IF current_user NOT IN ('authenticated', 'anon') AND NEW.suggested_by_staff_id IS NULL
     AND (to_jsonb(NEW) - 'suggested_by_staff_id') = (to_jsonb(OLD) - 'suggested_by_staff_id') THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('role', true), 'none') <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.suggested_by_staff_id IS DISTINCT FROM OLD.suggested_by_staff_id
     OR NEW.suggested_by_name IS DISTINCT FROM OLD.suggested_by_name
     OR NEW.suggested_by_email IS DISTINCT FROM OLD.suggested_by_email
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.business_type IS DISTINCT FROM OLD.business_type
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'What was suggested, and by whom, cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected')) THEN
      RAISE EXCEPTION 'A suggestion cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '22023';
    END IF;
    NEW.reviewed_at := now();
    NEW.reviewed_by := auth.email();
  ELSE
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  RETURN NEW;
END $function$;

-- ── 8. remove_staff_member ──────────────────────────────────────────────────
create or replace function public.remove_staff_member(p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor text := lower(coalesce(auth.email(), ''));
  s public.staff%rowtype;
  v_owner_level boolean;
  v_uid uuid;
  v_login_deleted boolean := false;
  v_login_kept boolean := false;
  v_used boolean := false;
  fk record;
begin
  select * into s from public.staff where id = p_staff_id for update;
  if not found then
    raise exception 'This staff member no longer exists.' using errcode = 'P0002';
  end if;

  -- Same rules as guard_staff_writes.
  if v_actor = '' or not public.can_manage_staff_as(v_actor, s.business_id) then
    raise exception 'You do not have permission to manage staff for this business.' using errcode = '42501';
  end if;
  v_owner_level := public.is_staff_owner_level(v_actor, s.business_id);
  if lower(s.email) = v_actor then
    raise exception 'You cannot remove your own staff membership. Ask the business owner.' using errcode = '42501';
  end if;
  if not v_owner_level and public.role_grants_staff_management(s.business_id, s.role) then
    raise exception 'Only the business owner can remove a staff member who manages staff.' using errcode = '42501';
  end if;

  -- Attendance: kept, with the name stored. user_id (NOT NULL) stays as the historical login id, like the actor ids
  -- on audit_log and stock_movements; it grants nothing once the membership is gone.
  update public.staff_checkins set staff_name = coalesce(staff_name, s.full_name), staff_id = null
   where staff_id = s.id;

  -- Business records: kept, unlinked. Each already stores the person's name.
  update public.sales set cashier_staff_id = null where cashier_staff_id = s.id;
  update public.sale_payments set staff_id = null where staff_id = s.id;
  update public.pos_shifts set staff_id = null where staff_id = s.id;
  update public.orders set created_by_staff_id = null where created_by_staff_id = s.id;
  update public.orders set approver_staff_id = null where approver_staff_id = s.id;
  update public.internal_messages set sender_staff_id = null where sender_staff_id = s.id;
  update public.internal_message_recipients set staff_id = null where staff_id = s.id;
  update public.field_activities set staff_id = null where staff_id = s.id;
  update public.activity_comments set staff_id = null where staff_id = s.id;
  update public.activity_reactions set staff_id = null where staff_id = s.id;
  update public.enterprise_locations set manager_staff_id = null where manager_staff_id = s.id;
  update public.directory_suggestions set suggested_by_staff_id = null where suggested_by_staff_id = s.id;
  update public.adr_notification_log set recipient_staff_id = null where recipient_staff_id = s.id;
  update public.rep_peer_entries set peer_staff_id = null where peer_staff_id = s.id;

  -- Their personal working data: deleted.
  delete from public.staff_notifications where staff_id = s.id;
  delete from public.activity_viewers where staff_id = s.id;
  delete from public.activity_default_viewers where staff_id = s.id or viewer_staff_id = s.id;
  delete from public.order_watchers where staff_id = s.id;
  delete from public.rep_territories where staff_id = s.id;
  delete from public.staff_claims where staff_id = s.id;
  delete from public.rep_customer_entries where staff_id = s.id;
  delete from public.rep_company_entries where staff_id = s.id;
  delete from public.rep_peer_entries where staff_id = s.id;
  delete from public.rep_customers where staff_id = s.id;
  delete from public.rep_colleagues where staff_id = s.id;

  delete from public.staff where id = s.id;

  -- Their login: deleted only when it was created for this membership and nothing else uses it. Any row in a table
  -- that references auth.users (a CareFind wallet, post, order, admin seat...) means it is the person's own account.
  v_uid := s.auth_user_id;
  if v_uid is not null then
    if s.owns_login
       and not exists (select 1 from public.staff o where o.auth_user_id = v_uid)
       and not exists (select 1 from public.businesses b where lower(b.email) = lower(s.email)) then
      for fk in
        select c.conrelid::regclass as tbl, a.attname as col
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
           and c.connamespace = 'public'::regnamespace
           and array_length(c.conkey, 1) = 1
           and c.conrelid not in ('public.profiles'::regclass, 'public.otp_challenges'::regclass)
      loop
        execute format('select exists (select 1 from %s where %I = $1)', fk.tbl, fk.col) into v_used using v_uid;
        exit when v_used;
      end loop;
      if not v_used then
        delete from auth.users where id = v_uid;
        v_login_deleted := true;
      end if;
    end if;
    v_login_kept := not v_login_deleted;
  end if;

  insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  values (auth.uid(), case when v_owner_level then 'owner' else 'staff' end, s.business_id, 'staff.removed', 'staff', s.id,
          jsonb_build_object('name', s.full_name, 'role', s.role, 'status', s.status,
                             'login_deleted', v_login_deleted, 'login_kept', v_login_kept));

  return jsonb_build_object('removed', s.full_name, 'login_deleted', v_login_deleted, 'login_kept', v_login_kept);
end;
$$;

revoke all on function public.remove_staff_member(uuid) from public, anon;
grant execute on function public.remove_staff_member(uuid) to authenticated;
revoke all on function public.guard_business_email_not_staff() from public, anon, authenticated;

-- ── 9. staff_activity shows a removed person's check-ins under their stored name ─────────────────────────────────
-- Patched from the live definition (carehub_20261217_staff_activity.sql) so nothing else in it changes.
do $$
declare
  v_def text;
  v_old text := 'SELECT c.created_at, ''checkin'', c.staff_id, c.user_id, NULL::text,';
  v_new text := 'SELECT c.created_at, ''checkin'', c.staff_id, c.user_id, c.staff_name,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_activity';
  if v_def is null then
    raise notice 'staff_activity not found; skipped.';
  elsif position(v_new in v_def) > 0 then
    null; -- already patched
  elsif position(v_old in v_def) = 0 then
    raise exception 'staff_activity no longer matches the expected check-in branch; update this migration.';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end $$;
