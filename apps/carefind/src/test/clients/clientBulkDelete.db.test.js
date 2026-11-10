// @vitest-environment node
// carehub_20270111_client_bulk_delete on PGlite, with the live foreign keys to clients (and their ON DELETE rules),
// the live one-phone-per-business index and the live current_business_ids(), is_business_owner() and
// is_platform_admin() (2026-11-10). Bulk deletes keep clients with history, keep a restorable copy, and are limited to
// the owner and delete-permission roles.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270111_client_bulk_delete.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng', MANAGER = 'manager@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [MANAGER]: '10000000-0000-4000-8000-000000000002', [CASHIER]: '10000000-0000-4000-8000-000000000003', [STRANGER]: '10000000-0000-4000-8000-000000000004' }
const C = (n) => 'c0000000-0000-4000-8000-00000000000' + n
// C1 plain, C2 plain, C3 sales, C4 appointment, C5 consultation, C6 debt, C7 request, C8 global record of C9, C9 other business

let db
async function scenario(email, sql, checks = []) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
    await db.exec('reset role')
    const seen = []
    for (const c of checks) seen.push((await db.query(c)).rows)
    return { out, seen }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const del = (ids) => `select delete_clients('${BIZ}', array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]) r`
const lastDeletion = `(select deletion_id from deleted_clients order by deleted_at desc limit 1)`

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}'), ('${OTHER}', 'Other', '${STRANGER}');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Musa', '${MANAGER}', 'Manager'), ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Manager', '{"canDelete": true}'), ('${BIZ}', 'Cashier', '{}');

    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit
      )
      SELECT id FROM visible
      UNION
      SELECT b.id FROM businesses b INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
    $function$;
    CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner' AND lower(s.email) = lower(auth.email()))
         )
    $function$;
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;

    -- Live clients shape, policy, grants and phone index (2026-11-10).
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text, email text, address text,
      date_of_birth text, gender text, notes text, total_spend numeric, visit_count integer, created_at timestamp default now(), global_client_id uuid references clients(id) on delete set null);
    create unique index clients_phone_unique_per_business on clients (business_id, regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null and btrim(phone) <> '';
    alter table clients enable row level security;
    create policy "clients of own business" on clients for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on clients to anon, authenticated, service_role;
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());

    -- Live foreign keys to clients (2026-11-10).
    create table sales (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
    create table appointments (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
    create table debts (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id) on delete set null);
    create table customer_requests (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id) on delete set null);
    create table skincare_consultations (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
    create table consultation_forms (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
    create table client_visits (id uuid primary key default gen_random_uuid(), global_client_id uuid references clients(id) on delete cascade);

    insert into clients (id, business_id, full_name, phone, gender, total_spend, visit_count) values
      ('${C(1)}', '${BIZ}', 'Ada Obi', '0801 111', 'Female', 0, 0),
      ('${C(2)}', '${BIZ}', 'Bayo', null, null, 0, 0),
      ('${C(3)}', '${BIZ}', 'Chi (sales)', '0803', null, 500, 1),
      ('${C(4)}', '${BIZ}', 'Dayo (appointment)', '0804', null, 0, 0),
      ('${C(5)}', '${BIZ}', 'Efe (consultation)', '0805', null, 0, 0),
      ('${C(6)}', '${BIZ}', 'Femi (debt)', '0806', null, 0, 0),
      ('${C(7)}', '${BIZ}', 'Gbenga (request)', '0807', null, 0, 0),
      ('${C(8)}', '${BIZ}', 'Halima (global)', '0808', null, 0, 0),
      ('${C(9)}', '${OTHER}', 'Other biz', '0809', null, 0, 0);
    update clients set global_client_id = '${C(8)}' where id = '${C(9)}';
    insert into sales (client_id) values ('${C(3)}');
    insert into appointments (client_id) values ('${C(4)}');
    insert into consultation_forms (client_id) values ('${C(5)}');
    insert into debts (client_id) values ('${C(6)}');
    insert into customer_requests (client_id) values ('${C(7)}');
  `)
  await db.exec(MIGRATION)
})

describe('delete_clients', () => {
  it('deletes clients with no history, keeps every client with history with its reasons, copies and audits', async () => {
    const r = await scenario(MANAGER, del([C(1), C(2), C(3), C(4), C(5), C(6), C(7), C(8)]), [
      `select id from clients where business_id = '${BIZ}' order by id`,
      `select client_id, client_name, client->>'phone' phone, deleted_by_name from deleted_clients order by client_id`,
      `select action, actor_type, metadata from audit_log`,
      `select count(*)::int n from debts where client_id is not null`,
    ])
    expect(r.error).toBeUndefined()
    const res = r.out[0][0].r
    expect(res.deleted).toBe(2)
    expect(res.kept.map((k) => [k.name, k.reasons])).toEqual([
      ['Chi (sales)', ['sales']], ['Dayo (appointment)', ['appointments']], ['Efe (consultation)', ['consultations']],
      ['Femi (debt)', ['debts']], ['Gbenga (request)', ['requests']], ['Halima (global)', ['linked_records']],
    ])
    expect(r.seen[0].map((x) => x.id)).toEqual([C(3), C(4), C(5), C(6), C(7), C(8)])
    expect(r.seen[1]).toEqual([
      { client_id: C(1), client_name: 'Ada Obi', phone: '0801 111', deleted_by_name: 'Musa' },
      { client_id: C(2), client_name: 'Bayo', phone: null, deleted_by_name: 'Musa' },
    ])
    expect(r.seen[2]).toEqual([{ action: 'clients.deleted', actor_type: 'staff', metadata: { deleted: 2, kept: 6, requested: 8 } }])
    expect(r.seen[3][0].n).toBe(1) // the debt still points at its client
  })

  it('another business\'s client and unknown ids are counted as not found and never touched', async () => {
    const r = await scenario(OWNER, del([C(9), 'd0000000-0000-4000-8000-000000000001', C(2)]), [`select count(*)::int n from clients where id = '${C(9)}'`])
    expect(r.out[0][0].r).toMatchObject({ deleted: 1, not_found: 2 })
    expect(r.seen[0][0].n).toBe(1)
  })

  it('who: owner and delete roles; not other staff, other businesses or anon', async () => {
    expect((await scenario(OWNER, del([C(1)]))).out[0][0].r.deleted).toBe(1)
    expect((await scenario(CASHIER, del([C(1)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(STRANGER, del([C(1)]))).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(null, del([C(1)]))).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, `select delete_clients('${BIZ}', '{}'::uuid[])`)).error).toMatch(/DELETE_NONE/)
    expect((await scenario(OWNER, `select can_delete_clients('${BIZ}')`)).error).toMatch(/permission denied/)
  })
})

describe('restore_deleted_clients', () => {
  it('puts clients back with the same ids and details', async () => {
    const r = await scenario(OWNER, [del([C(1), C(2)]), `select restore_deleted_clients('${BIZ}', ${lastDeletion}) r`], [
      `select id, full_name, phone, gender from clients where id in ('${C(1)}', '${C(2)}') order by id`,
      `select action from audit_log order by created_at, action`,
    ])
    expect(r.out[1][0].r).toEqual({ restored: 2, skipped_already_back: 0, skipped_phone_taken: 0 })
    expect(r.seen[0]).toEqual([{ id: C(1), full_name: 'Ada Obi', phone: '0801 111', gender: 'Female' }, { id: C(2), full_name: 'Bayo', phone: null, gender: null }])
    expect(r.seen[1].map((a) => a.action)).toEqual(['clients.deleted', 'clients.restored'])
  })

  it('a phone now used by another client is skipped (one phone per business), never duplicated', async () => {
    const r = await scenario(OWNER, [
      del([C(1), C(2)]),
      `insert into clients (business_id, full_name, phone) values ('${BIZ}', 'New Ada', '0801-111')`,
      `select restore_deleted_clients('${BIZ}', ${lastDeletion}) r`,
      `select restore_deleted_clients('${BIZ}', ${lastDeletion}) r`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[2][0].r).toEqual({ restored: 1, skipped_already_back: 0, skipped_phone_taken: 1 })
    expect(r.out[3][0].r).toEqual({ restored: 0, skipped_already_back: 0, skipped_phone_taken: 1 })
  })

  it('same people as deleting; an unknown deletion is not found', async () => {
    expect((await scenario(CASHIER, `select restore_deleted_clients('${BIZ}', gen_random_uuid())`)).error).toMatch(/DELETE_NOT_ALLOWED/)
    expect((await scenario(OWNER, `select restore_deleted_clients('${BIZ}', gen_random_uuid())`)).error).toMatch(/RESTORE_NOT_FOUND/)
  })
})

describe('deleted_clients access', () => {
  it('members read their own business\'s copies; nobody writes them directly; anon reads nothing', async () => {
    await db.exec(`insert into deleted_clients (deletion_id, business_id, client_id, client_name, client) values
      (gen_random_uuid(), '${BIZ}', '${C(1)}', 'x', '{}'), (gen_random_uuid(), '${OTHER}', '${C(9)}', 'y', '{}')`)
    expect((await scenario(CASHIER, `select client_name from deleted_clients`)).out[0]).toEqual([{ client_name: 'x' }])
    expect((await scenario(OWNER, `delete from deleted_clients`)).error).toMatch(/permission denied/)
    expect((await scenario(null, `select count(*) from deleted_clients`)).error).toMatch(/permission denied/)
  })
})
