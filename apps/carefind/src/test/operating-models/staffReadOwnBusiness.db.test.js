// @vitest-environment node
// carehub_20270104_staff_read_own_business on PGlite, with the live businesses policies, the live
// current_business_ids() and caller_owns_business(), and authenticated's table-level SELECT on businesses.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270104_staff_read_own_business.sql', import.meta.url)), 'utf8')

const HIDDEN = 'a0000000-0000-4000-8000-000000000001'
const LISTED = 'a0000000-0000-4000-8000-000000000002'
const BRANCH = 'a0000000-0000-4000-8000-000000000003'
const REPACCT = 'a0000000-0000-4000-8000-000000000004'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
let db

async function visible(email) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return (await db.query('select id from businesses order by id')).rows.map((r) => r.id) } finally {
    await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;
    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3,
      is_platform_admin boolean default false, status text default 'active', visible_on_carefind boolean default true, account_kind text default 'business');
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, status text default 'active');
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union all
        select c.id, c.parent_business_id, c.branch_depth_limit, v.depth + 1 from businesses c join visible v on c.parent_business_id = v.id where v.depth < v.branch_depth_limit)
      select id from visible
      union
      select b.id from businesses b join staff s on s.business_id = b.id where lower(s.email) = lower(auth.email()) and s.status = 'active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email())), false) $$;
    create function caller_owns_business(bid uuid) returns boolean language sql stable security definer set search_path = public as $$
      with recursive up(id, parent_business_id, email, depth) as (
        select b.id, b.parent_business_id, b.email, 0 from businesses b where b.id = bid
        union select p.id, p.parent_business_id, p.email, up.depth + 1 from businesses p join up on p.id = up.parent_business_id where up.depth < 10)
      select auth.email() is not null and exists (select 1 from up where lower(up.email) = lower(auth.email())) $$;
    alter table businesses enable row level security; alter table staff enable row level security;
    grant select, insert, update, delete on businesses, staff to authenticated;
    -- live policies
    create policy "authenticated view own business" on businesses for select to authenticated using (lower(email) = lower(auth.email()) or is_platform_admin());
    create policy "own business row" on businesses for all to authenticated using (lower(email) = lower(auth.email()) or is_platform_admin()) with check (lower(email) = lower(auth.email()) or is_platform_admin());
    create policy "owner manages own branches" on businesses for all to authenticated using (parent_business_id is not null and caller_owns_business(parent_business_id));
    create policy "public can view active visible businesses" on businesses for select using (status = 'active' and visible_on_carefind = true);
    create policy "rep account members read their account" on businesses for select to authenticated using (account_kind = 'rep_account' and id in (select current_business_ids()));

    insert into businesses (id, name, email, parent_business_id, visible_on_carefind, account_kind) values
      ('${HIDDEN}', 'Unlisted importer', 'owner@hidden.ng', null, false, 'business'),
      ('${LISTED}', 'Listed pharmacy', 'owner@listed.ng', null, true, 'business'),
      ('${BRANCH}', 'Unlisted branch', null, '${HIDDEN}', false, 'business'),
      ('${REPACCT}', 'Rep account', null, '${HIDDEN}', false, 'rep_account'),
      ('${OTHER}', 'Another unlisted business', 'owner@other.ng', null, false, 'business');
    insert into staff (business_id, email, status) values
      ('${HIDDEN}', 'rep@hidden.ng', 'active'), ('${HIDDEN}', 'gone@hidden.ng', 'inactive'),
      ('${BRANCH}', 'cashier@branch.ng', 'active'), ('${REPACCT}', 'ada@hidden.ng', 'active');
  `)
})

describe('staff reading their own business', () => {
  it('before the fix: staff of an unlisted business cannot read it (the sign-in failure)', async () => {
    expect(await visible('rep@hidden.ng')).toEqual([LISTED])
    expect(await visible('ada@hidden.ng')).toEqual([LISTED, REPACCT])
  })

  it('after the fix: active staff read their own business, and nothing else that is unlisted', async () => {
    await db.exec(MIGRATION)
    expect(await visible('rep@hidden.ng')).toEqual([HIDDEN, LISTED])
    expect(await visible('cashier@branch.ng')).toEqual([LISTED, BRANCH])
    expect(await visible('ada@hidden.ng')).toEqual([LISTED, REPACCT]) // a representative still sees only their own account
  })

  it('inactive staff and strangers gain nothing; owners keep their tree', async () => {
    expect(await visible('gone@hidden.ng')).toEqual([LISTED])
    expect(await visible('someone@else.ng')).toEqual([LISTED])
    expect(await visible('owner@hidden.ng')).toEqual([HIDDEN, LISTED, BRANCH, REPACCT])
    expect(await visible('owner@other.ng')).toEqual([LISTED, OTHER])
  })

  it('reading is all it widens: staff still cannot change their business', async () => {
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ email: 'rep@hidden.ng', role: 'authenticated' })])
    await db.query('set role authenticated')
    try {
      const r = await db.query(`update businesses set name = 'hijacked' where id = $1`, [HIDDEN])
      expect(r.affectedRows).toBe(0)
    } finally { await db.query('reset role') }
    expect((await db.query('select name from businesses where id = $1', [HIDDEN])).rows[0].name).toBe('Unlisted importer')
  })
})
