// @vitest-environment node
// Staff offboarding and one-business scope (carehub_20261219_staff_offboarding_and_scope), on PGlite with the live
// shapes of the tables it touches, their live guard triggers (append-only ledgers, directory suggestions) and the C21
// staff-governance helpers.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261219_staff_offboarding_and_scope.sql', import.meta.url)), 'utf8')

const B = { main: 'c0000000-0000-4000-8000-000000000001', branch: 'c0000000-0000-4000-8000-000000000002', other: 'c0000000-0000-4000-8000-000000000003' }
const U = { minted: 'd0000000-0000-4000-8000-000000000001', personal: 'd0000000-0000-4000-8000-000000000002', mgr: 'd0000000-0000-4000-8000-000000000003', owner: 'd0000000-0000-4000-8000-000000000009' }
let db

async function as(email, fn, uid = U.owner) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: uid, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
const count = async (s, p) => Number((await one(`select count(*) n from ${s}`, p)).n)
const staffId = async (email) => (await one('select id from staff where email = $1', [email]))?.id
const remove = (actor, id) => as(actor, async (q) => (await q('select remove_staff_member($1) r', [id]))[0].r)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), email_confirmed_at timestamptz);
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table businesses (id uuid primary key default gen_random_uuid(), name text, email text, parent_business_id uuid,
      branch_depth_limit integer default 3, is_platform_admin boolean default false, deleted_at timestamptz);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text,
      phone text, status text default 'active', created_at timestamp default now(), show_on_carefind boolean, public_title text,
      auth_user_id uuid, invited_at timestamptz, invited_by_email text, invite_token_hash text, invite_expires_at timestamptz, accepted_at timestamptz);
    create unique index staff_email_key on staff (email);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    create table profiles (id uuid primary key references auth.users on delete cascade);
    create table otp_challenges (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade);
    create table wallets (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, balance int default 0);

    -- business records (kept, unlinked) and personal data (deleted); FKs as live (no cascade)
    create table staff_checkins (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, user_id uuid not null, event_type text, status text, created_at timestamptz default now());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, staff_name text, cashier_staff_id uuid, total numeric);
    create table sale_payments (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, staff_name text, amount numeric);
    create table pos_shifts (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, staff_name text);
    create table orders (id uuid primary key default gen_random_uuid(), business_id uuid, created_by_staff_id uuid references staff, created_by_name text, approver_staff_id uuid references staff, approver_name text);
    create table internal_messages (id uuid primary key default gen_random_uuid(), sender_staff_id uuid references staff, sender_name text);
    create table internal_message_recipients (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, recipient_name text);
    create table field_activities (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid references staff, rep_name text);
    create table activity_comments (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, actor_name text);
    create table activity_reactions (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, actor_name text);
    create table enterprise_locations (id uuid primary key default gen_random_uuid(), manager_staff_id uuid references staff);
    create table directory_suggestions (id uuid primary key default gen_random_uuid(), business_id uuid, suggested_by_staff_id uuid, suggested_by_name text,
      suggested_by_email text, name text, business_type text, address text, latitude float8, longitude float8, note text, status text default 'pending',
      reviewed_at timestamptz, reviewed_by text, created_at timestamptz default now());
    create table adr_notification_log (id uuid primary key default gen_random_uuid(), recipient_staff_id uuid);
    create table staff_notifications (id uuid primary key default gen_random_uuid(), staff_id uuid references staff);
    create table activity_viewers (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, viewer_name text);
    create table activity_default_viewers (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, viewer_staff_id uuid references staff, viewer_name text);
    create table order_watchers (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, watcher_name text);
    create table rep_territories (id uuid primary key default gen_random_uuid(), staff_id uuid references staff, territory_id uuid);
    create table staff_claims (id uuid primary key default gen_random_uuid(), staff_id uuid references staff);
    create table rep_customers (id uuid primary key default gen_random_uuid(), staff_id uuid, name text);
    create table rep_colleagues (id uuid primary key default gen_random_uuid(), staff_id uuid, name text);
    create table rep_company_entries (id uuid primary key default gen_random_uuid(), staff_id uuid);
    create table rep_customer_entries (id uuid primary key default gen_random_uuid(), staff_id uuid);
    create table rep_peer_entries (id uuid primary key default gen_random_uuid(), staff_id uuid, peer_staff_id uuid, peer_name text);
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text, branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb, created_at timestamptz default now());

    -- live guard triggers
    create function location_tables_append_only() returns trigger language plpgsql as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
    create trigger staff_checkins_append_only before delete or update on staff_checkins for each row execute function location_tables_append_only();
    create function sale_payments_append_only() returns trigger language plpgsql as $$ begin raise exception 'sale_payments is append-only: record a refund instead of editing a payment'; end $$;
    create trigger sale_payments_no_update before update on sale_payments for each row execute function sale_payments_append_only();
    create function directory_suggestions_before_update() returns trigger language plpgsql as $$ begin
      if coalesce(current_setting('role', true), 'none') <> 'authenticated' then return new; end if;
      if new.suggested_by_staff_id is distinct from old.suggested_by_staff_id then raise exception 'What was suggested, and by whom, cannot change' using errcode = '42501'; end if;
      return new; end $$;
    create trigger directory_suggestions_before_update before update on directory_suggestions for each row execute function directory_suggestions_before_update();
    create function audit_log_append_only() returns trigger language plpgsql as $$ begin raise exception 'audit_log is append-only'; end $$;
    create trigger audit_log_append_only before delete or update on audit_log for each row execute function audit_log_append_only();

  `)
  // staff_activity, reduced to the live check-in branch the migration patches.
  await db.exec(`
    create function staff_activity(p_business_id uuid) returns table (at timestamptz, kind text, staff_id uuid, user_id uuid, name text, detail text)
    language sql as $$
      SELECT c.created_at, 'checkin', c.staff_id, c.user_id, NULL::text,
             c.event_type FROM public.staff_checkins c WHERE c.business_id = p_business_id $$;`)

  // C21 helpers, as live
  await db.exec(`
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    create function is_platform_admin_email(p_email text) returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select bool_or(is_platform_admin) from businesses where lower(email) = lower(trim(p_email))), false) $$;
    create function is_business_owner_email(p_email text, p_business_id uuid) returns boolean language sql stable security definer set search_path = public as $$
      with recursive chain as (select b.id, b.parent_business_id, b.email, 0 as depth from businesses b where b.id = p_business_id
        union all select p.id, p.parent_business_id, p.email, c.depth + 1 from businesses p join chain c on p.id = c.parent_business_id where c.depth < 10)
      select coalesce(p_email, '') <> '' and exists (select 1 from chain where lower(email) = lower(trim(p_email))) $$;
    create function role_grants_staff_management(p_business_id uuid, p_role text) returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select (r.permissions ->> 'canManageStaff') = 'true' from roles r where r.business_id = p_business_id and r.name = p_role limit 1), false) $$;
    create function is_staff_owner_level(p_email text, p_business_id uuid) returns boolean language sql stable security definer set search_path = public as $$
      select is_platform_admin_email(p_email) or is_business_owner_email(p_email, p_business_id) $$;
    create function can_manage_staff_as(p_email text, p_business_id uuid) returns boolean language sql stable security definer set search_path = public as $$
      select is_staff_owner_level(p_email, p_business_id) or exists (select 1 from staff s where s.business_id = p_business_id
        and lower(s.email) = lower(trim(p_email)) and s.status = 'active' and role_grants_staff_management(s.business_id, s.role)) $$;
    create function staff_email_conflict(p_business_id uuid, p_email text, p_ignore_staff_id uuid default null) returns text
    language plpgsql stable security definer set search_path = public as $$
    declare v_email text := lower(trim(p_email));
    begin
      if exists (select 1 from businesses where lower(email) = v_email) then return 'This email is a business owner''s CareHub login. Each staff member needs their own email address.'; end if;
      if exists (select 1 from staff where business_id = p_business_id and lower(email) = v_email and (p_ignore_staff_id is null or id <> p_ignore_staff_id)) then return 'already a member'; end if;
      if exists (select 1 from staff where business_id <> p_business_id and lower(email) = v_email and (p_ignore_staff_id is null or id <> p_ignore_staff_id)) then return 'staff at another business'; end if;
      return null;
    end $$;
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b INNER JOIN staff s ON s.business_id = b.id
         WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1 FROM businesses child
         INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit)
      SELECT DISTINCT id FROM visible $$;
    create function guard_staff_writes() returns trigger language plpgsql as $$ begin if tg_op = 'DELETE' then return old; end if; return new; end $$;
    create trigger guard_staff_writes before insert or delete or update on staff for each row execute function guard_staff_writes();
    do $$ declare t text; begin foreach t in array array['businesses','staff','sales','staff_checkins'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
    end loop; end $$;
    create policy "own businesses" on businesses for all to authenticated using (id in (select current_business_ids())) with check (true);
    create policy "own staff" on staff for all to authenticated using (business_id in (select current_business_ids()));
    create policy "own sales" on sales for select to authenticated using (business_id in (select current_business_ids()));
  `)

  // Data: an owner with a branch, a staff admin, a cashier (minted login), a rep who signed in with their own CareFind
  // account, an inactive staff member whose email later became another business's login.
  await db.exec(`
    insert into businesses (id, name, email) values ('${B.main}', 'Main', 'owner@x.com'), ('${B.other}', 'Other', 'otherowner@x.com');
    insert into businesses (id, name, email, parent_business_id) values ('${B.branch}', 'Branch', 'owner@x.com', '${B.main}');
    insert into businesses (name, email, is_platform_admin) values ('Platform', 'admin@x.com', true);
    insert into roles (business_id, name, permissions) values ('${B.main}', 'Staff Admin', '{"canManageStaff": true}');
    insert into auth.users (id, email, created_at) values
      ('${U.minted}', 'cashier@x.com', now()), ('${U.personal}', 'rep@x.com', now() - interval '1 year'), ('${U.mgr}', 'mgr@x.com', now());
    insert into profiles (id) values ('${U.minted}'), ('${U.personal}');
    insert into wallets (user_id) values ('${U.personal}');
    insert into staff (business_id, full_name, email, role, auth_user_id, created_at) values
      ('${B.main}', 'Ada Cashier', 'cashier@x.com', 'Cashier', '${U.minted}', now() - interval '1 hour'),
      ('${B.main}', 'Rep Personal', 'rep@x.com', 'Sales Rep', '${U.personal}', now()),
      ('${B.main}', 'Mgr Admin', 'mgr@x.com', 'Staff Admin', '${U.mgr}', now() - interval '1 hour'),
      ('${B.main}', 'Peer', 'peer@x.com', 'Cashier', null, now());
    insert into staff (business_id, full_name, email, role, status) values ('${B.main}', 'Became Owner', 'OtherOwner@x.com', 'Cashier', 'inactive');
    insert into sales (business_id, total) values ('${B.branch}', 100);
  `)
  const cashier = await staffId('cashier@x.com')
  const peer = await staffId('peer@x.com')
  await db.exec(`
    insert into staff_checkins (business_id, staff_id, user_id, event_type, status) values ('${B.main}', '${cashier}', '${U.minted}', 'check_in', 'ok');
    insert into sales (business_id, staff_name, cashier_staff_id, total) values ('${B.main}', 'Ada Cashier', '${cashier}', 500);
    insert into sale_payments (business_id, staff_id, staff_name, amount) values ('${B.main}', '${cashier}', 'Ada Cashier', 500);
    insert into pos_shifts (business_id, staff_id, staff_name) values ('${B.main}', '${cashier}', 'Ada Cashier');
    insert into orders (business_id, created_by_staff_id, created_by_name, approver_staff_id, approver_name) values ('${B.main}', '${cashier}', 'Ada Cashier', '${cashier}', 'Ada Cashier');
    insert into internal_messages (sender_staff_id, sender_name) values ('${cashier}', 'Ada Cashier');
    insert into internal_message_recipients (staff_id, recipient_name) values ('${cashier}', 'Ada Cashier');
    insert into field_activities (business_id, staff_id, rep_name) values ('${B.main}', '${cashier}', 'Ada Cashier');
    insert into activity_comments (staff_id, actor_name) values ('${cashier}', 'Ada Cashier');
    insert into activity_reactions (staff_id, actor_name) values ('${cashier}', 'Ada Cashier');
    insert into enterprise_locations (manager_staff_id) values ('${cashier}');
    insert into directory_suggestions (business_id, suggested_by_staff_id, suggested_by_name, name) values ('${B.main}', '${cashier}', 'Ada Cashier', 'Pharm');
    insert into adr_notification_log (recipient_staff_id) values ('${cashier}');
    insert into staff_notifications (staff_id) values ('${cashier}'), ('${cashier}');
    insert into activity_viewers (staff_id) values ('${cashier}');
    insert into activity_default_viewers (staff_id, viewer_staff_id) values ('${cashier}', '${peer}'), ('${peer}', '${cashier}');
    insert into order_watchers (staff_id) values ('${cashier}');
    insert into rep_territories (staff_id) values ('${cashier}');
    insert into staff_claims (staff_id) values ('${cashier}');
    insert into rep_customers (staff_id) values ('${cashier}');
    insert into rep_colleagues (staff_id) values ('${cashier}');
    insert into rep_company_entries (staff_id) values ('${cashier}');
    insert into rep_customer_entries (staff_id) values ('${cashier}');
    insert into rep_peer_entries (staff_id, peer_staff_id, peer_name) values ('${cashier}', null, null), ('${peer}', '${cashier}', 'Ada Cashier');
  `)
  await db.exec(MIGRATION)
})

describe('remove_staff_member', () => {
  it('backfills owns_login: minted logins yes, a pre-existing personal account no', async () => {
    expect((await one(`select owns_login o from staff where email = 'cashier@x.com'`)).o).toBe(true)
    expect((await one(`select owns_login o from staff where email = 'rep@x.com'`)).o).toBe(false)
  })

  it('direct DELETE through the API is refused', async () => {
    // the guard is the migration's (replacing the stub above)
    const id = await staffId('peer@x.com')
    await expect(as('owner@x.com', (q) => q('delete from staff where id = $1', [id]))).rejects.toThrow(/"Remove" on the Staff page/)
  })

  it('refuses outsiders, staff without staff management, and removing yourself', async () => {
    const id = await staffId('peer@x.com')
    await expect(remove('otherowner@x.com', id)).rejects.toThrow(/do not have permission/)
    await expect(remove('cashier@x.com', id)).rejects.toThrow(/do not have permission/)
    await expect(remove('mgr@x.com', await staffId('mgr@x.com'))).rejects.toThrow(/your own/)
    expect(await staffId('peer@x.com')).toBe(id)
  })

  it('a staff admin cannot remove someone else who manages staff; the Owner can', async () => {
    await db.exec(`insert into staff (business_id, full_name, email, role) values ('${B.main}', 'Admin2', 'admin2@x.com', 'Staff Admin')`)
    const id = await staffId('admin2@x.com')
    await expect(remove('mgr@x.com', id)).rejects.toThrow(/Only the business owner/)
    expect((await remove('owner@x.com', id)).removed).toBe('Admin2')
  })

  it('removes the person completely and keeps the business records, unlinked, with the name', async () => {
    const id = await staffId('cashier@x.com')
    const r = await remove('mgr@x.com', id)
    expect(r).toEqual({ removed: 'Ada Cashier', login_deleted: true, login_kept: false })

    expect(await staffId('cashier@x.com')).toBeUndefined()
    expect(await count('auth.users where id = $1', [U.minted])).toBe(0)
    expect(await count('profiles where id = $1', [U.minted])).toBe(0)

    for (const t of ['staff_notifications', 'activity_viewers', 'order_watchers', 'rep_territories', 'staff_claims', 'rep_customers',
      'rep_colleagues', 'rep_company_entries', 'rep_customer_entries']) {
      expect(await count(`${t} where staff_id = $1`, [id]), t).toBe(0)
    }
    expect(await count('activity_default_viewers where staff_id = $1 or viewer_staff_id = $1', [id])).toBe(0)
    expect(await count('rep_peer_entries where staff_id = $1 or peer_staff_id = $1', [id])).toBe(0)
    expect((await one(`select peer_name from rep_peer_entries where peer_staff_id is null and peer_name = 'Ada Cashier'`)).peer_name).toBe('Ada Cashier')

    expect(await one(`select cashier_staff_id, staff_name, total from sales where staff_name = 'Ada Cashier'`)).toMatchObject({ cashier_staff_id: null, total: '500' })
    expect(await one(`select staff_id, staff_name, amount from sale_payments`)).toMatchObject({ staff_id: null, staff_name: 'Ada Cashier' })
    expect(await one(`select staff_id from pos_shifts`)).toEqual({ staff_id: null })
    expect(await one(`select created_by_staff_id, approver_staff_id, created_by_name from orders`)).toEqual({ created_by_staff_id: null, approver_staff_id: null, created_by_name: 'Ada Cashier' })
    for (const [t, c] of [['internal_messages', 'sender_staff_id'], ['internal_message_recipients', 'staff_id'], ['field_activities', 'staff_id'],
      ['activity_comments', 'staff_id'], ['activity_reactions', 'staff_id'], ['enterprise_locations', 'manager_staff_id'],
      ['directory_suggestions', 'suggested_by_staff_id'], ['adr_notification_log', 'recipient_staff_id']]) {
      expect(await count(`${t} where ${c} is null`), t).toBe(1)
    }
    expect(await one(`select staff_id, user_id, staff_name, event_type from staff_checkins`)).toEqual({ staff_id: null, user_id: U.minted, staff_name: 'Ada Cashier', event_type: 'check_in' })

    const audit = await one(`select actor_type, action, branch_id, metadata from audit_log where target_id = $1`, [id])
    expect(audit).toMatchObject({ actor_type: 'staff', action: 'staff.removed', branch_id: B.main })
    expect(audit.metadata).toMatchObject({ name: 'Ada Cashier', login_deleted: true })
  })

  it('keeps a personal CareFind account (it has a wallet), only removing the membership', async () => {
    const r = await remove('owner@x.com', await staffId('rep@x.com'))
    expect(r).toEqual({ removed: 'Rep Personal', login_deleted: false, login_kept: true })
    expect(await count('auth.users where id = $1', [U.personal])).toBe(1)
    expect(await count('wallets where user_id = $1', [U.personal])).toBe(1)
  })

  it('the ledgers still refuse every other change, even from server code', async () => {
    await expect(db.query(`update sale_payments set amount = 1`)).rejects.toThrow(/append-only/)
    await expect(db.query(`update staff_checkins set event_type = 'x'`)).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from staff_checkins`)).rejects.toThrow(/append-only/)
    await db.exec(`insert into sale_payments (business_id, staff_id, amount) values ('${B.main}', '${await staffId('peer@x.com')}', 1)`)
    await expect(as('owner@x.com', (q) => q(`update sale_payments set staff_id = null where staff_id is not null`))).rejects.toThrow(/permission denied|append-only/)
  })

  it('staff_activity reports a removed person\'s check-in under the stored name', async () => {
    const rows = (await db.query(`select name from staff_activity($1) where kind = 'checkin'`, [B.main])).rows
    expect(rows).toEqual([{ name: 'Ada Cashier' }])
  })
})

describe('a staff member belongs to one business', () => {
  it('sees only their own business, not its branches; the Owner still sees the tree', async () => {
    const staffSees = await as('peer@x.com', (q) => q('select id from businesses order by name'))
    expect(staffSees.map((b) => b.id)).toEqual([B.main])
    expect(await as('peer@x.com', (q) => q('select total from sales where business_id = $1', [B.branch]))).toEqual([])
    const ownerSees = await as('owner@x.com', (q) => q('select id from businesses order by name'))
    expect(ownerSees.map((b) => b.id).sort()).toEqual([B.main, B.branch].sort())
  })

  it('one email is one staff record, case-insensitively', async () => {
    await expect(db.query(`insert into staff (business_id, full_name, email, role) values ('${B.other}', 'Dup', 'PEER@x.com', 'Cashier')`)).rejects.toThrow(/staff_email_lower_key/)
  })

  it('a staff email cannot become a business login; an owner adding a branch still can', async () => {
    await expect(db.query(`insert into businesses (name, email) values ('Side shop', 'Peer@X.com')`)).rejects.toThrow(/staff member's login/)
    await expect(db.query(`update businesses set email = 'peer@x.com' where id = $1`, [B.other])).rejects.toThrow(/staff member's login/)
    await db.query(`insert into businesses (name, email, parent_business_id) values ('Branch 2', 'otherowner@x.com', $1)`, [B.other])
  })

  it('a staff record whose email is a business login cannot be reactivated', async () => {
    const id = await staffId('OtherOwner@x.com')
    await expect(as('owner@x.com', (q) => q(`update staff set status = 'active' where id = $1`, [id]))).rejects.toThrow(/business owner's CareHub login/)
  })
})
