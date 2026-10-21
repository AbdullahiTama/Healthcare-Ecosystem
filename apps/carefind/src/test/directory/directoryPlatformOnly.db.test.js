// @vitest-environment node
// Issue 3: Business Directory management is Platform Super Admin only. Replays the
// shipped directory schema + policies (apps/carehub/sql/20261010..12), proves a
// company owner COULD write before, applies the draft migration, then proves the
// boundary at the database (what a direct API call hits), that reads / public
// discovery / feedback still work, and that the two re-homed actions behave.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 180000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SQL = (f) => read(`../../../../carehub/sql/${f}`)
const FIX = read('../../../../../docs/architecture/pending-migrations/carehub_20261202_directory_platform_only.sql')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADMIN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CUSTOM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // company A staff with a custom role granting canManageDirectory
const TERR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PLAT = '11111111-1111-4111-8111-111111111111' // verified platform listing
const PLAT_UNVERIFIED = '22222222-2222-4222-8222-222222222222'
let db

async function as(email, fn) {
  const sub = '00000000-0000-4000-8000-000000000001'
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const insertOwn = (biz, name = 'Own Pharmacy') =>
  `insert into directory_businesses (business_id,name,name_normalized) values ('${biz}','${name}','${name.toLowerCase()}') returning id`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','anon') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table businesses (id uuid primary key, email text, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, status text default 'active', role text);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb);
    create table territories (id uuid primary key, business_id uuid);
    create table field_activities (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, rep_name text,
      lat double precision, lng double precision, created_at timestamptz not null default now());
    create function is_platform_admin_email(p text) returns boolean language sql stable security definer as $$
      select coalesce((select is_platform_admin from businesses where lower(email)=lower(p)), false) $$;
    create function is_business_owner_email(p text, b uuid) returns boolean language sql stable security definer as $$
      select exists (select 1 from businesses where id=b and lower(email)=lower(p)) $$;
    create function is_staff_owner_level(p text, b uuid) returns boolean language sql stable security definer as $$
      select is_platform_admin_email(p) or is_business_owner_email(p, b) $$;
    create function current_business_ids() returns setof uuid language sql stable security definer as $$
      select id from businesses where lower(email)=lower(auth.email())
      union select business_id from staff where lower(email)=lower(auth.email()) and status='active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer as $$
      select is_platform_admin_email(auth.email()) $$;
    insert into businesses (id,email,is_platform_admin) values ('${A}','a@x.com',false), ('${B}','b@x.com',false), ('${ADMIN}','admin@x.com',true);
    insert into staff (business_id,email,role) values ('${A}','custom@x.com','Directory Lead');
    insert into roles (business_id,name,permissions) values ('${A}','Directory Lead','{"canManageDirectory": true}');
    insert into territories (id,business_id) values ('${TERR}','${A}');
  `)
  for (const f of ['20261010_business_directory.sql', '20261011_territory_intelligence.sql', '20261012_directory_platform_scope.sql']) await db.exec(SQL(f))
  await db.query(`insert into directory_businesses (business_id,name,name_normalized,verification_status,is_active,state) values
    (null,'Platform Verified Pharma','platform verified pharma','verified',true,'Lagos'),
    (null,'Platform Unverified','platform unverified','unverified',true,'Lagos')`)
  await db.query(`update directory_businesses set id='${PLAT}' where name='Platform Verified Pharma'`)
  await db.query(`update directory_businesses set id='${PLAT_UNVERIFIED}' where name='Platform Unverified'`)
})

describe('before the migration (the problem)', () => {
  it('a company owner and a granted custom role can write directory rows directly', async () => {
    await as('a@x.com', async (q) => { expect(await q(insertOwn(A, 'Seed One'))).toHaveLength(1) })
    await as('custom@x.com', async (q) => { expect(await q(insertOwn(A, 'Seed Two'))).toHaveLength(1) })
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(FIX) })

  it('existing directory rows are intact', async () => {
    const n = (await db.query('select count(*)::int c from directory_businesses')).rows[0].c
    expect(n).toBe(4)
  })

  it.each([['company owner', 'a@x.com'], ['custom role granted directory management', 'custom@x.com']])(
    '%s cannot insert, update, delete, import or manage categories directly', async (_n, email) => {
      await as(email, async (q) => {
        await expect(q(insertOwn(A))).rejects.toThrow(/row-level security/)
        await expect(q(`insert into directory_businesses (business_id,name,name_normalized) values (null,'Sneaky','sneaky')`)).rejects.toThrow(/row-level security/)
        // restrictive RLS hides rows from UPDATE/DELETE, so these affect nothing
        expect(await q(`update directory_businesses set name='Hijacked' where business_id='${A}' returning id`)).toHaveLength(0)
        expect(await q(`update directory_businesses set verification_status='verified' where business_id is null returning id`)).toHaveLength(0)
        expect(await q(`delete from directory_businesses where business_id='${A}' returning id`)).toHaveLength(0)
        await expect(q(`insert into directory_categories (business_id,name) values ('${A}','Mine')`)).rejects.toThrow(/row-level security/)
        await expect(q(`insert into directory_import_batches (business_id,file_name) values ('${A}','x.csv')`)).rejects.toThrow(/row-level security/)
      })
      const names = (await db.query(`select name from directory_businesses where business_id='${A}' order by name`)).rows.map((r) => r.name)
      expect(names).toEqual(['Seed One', 'Seed Two'])
    })

  it('the platform admin can still manage the registry and company rows', async () => {
    await as('admin@x.com', async (q) => {
      expect(await q(`insert into directory_businesses (business_id,name,name_normalized,verification_status) values (null,'Added By Admin','added by admin','verified') returning id`)).toHaveLength(1)
      expect(await q(`update directory_businesses set is_active=false where name='Added By Admin' returning id`)).toHaveLength(1)
      expect(await q(`insert into directory_categories (business_id,name) values (null,'Platform Category') returning id`)).toHaveLength(1)
      expect(await q(`update directory_businesses set verification_status='verified' where name='Seed One' returning id`)).toHaveLength(1)
    })
  })

  it('reading and discovery still work: members see their rows and everyone sees the verified registry', async () => {
    await as('a@x.com', async (q) => {
      const names = (await q('select name from directory_businesses order by name')).map((r) => r.name)
      expect(names).toContain('Seed One')
      expect(names).toContain('Platform Verified Pharma')
      expect(names).not.toContain('Platform Unverified')
    })
    await as('b@x.com', async (q) => {
      const names = (await q('select name from directory_businesses')).map((r) => r.name)
      expect(names).not.toContain('Seed One') // another company's rows stay private
    })
  })

  it('members can still report incorrect information, but only the platform reads and resolves reports', async () => {
    const rec = (await db.query(`select id from directory_businesses where name='Seed One'`)).rows[0].id
    await as('a@x.com', async (q) => {
      await q(`insert into directory_reports (business_id,directory_business_id,message,reported_by) values ('${A}','${rec}','wrong phone','a@x.com')`)
      expect(await q('select * from directory_reports')).toHaveLength(1) // their own
      expect(await q(`update directory_reports set status='resolved' returning id`)).toHaveLength(0)
    })
    await as('b@x.com', async (q) => { expect(await q('select * from directory_reports')).toHaveLength(0) })
    await as('admin@x.com', async (q) => {
      expect(await q('select * from directory_reports')).toHaveLength(1)
      expect(await q(`update directory_reports set status='resolved' returning id`)).toHaveLength(1)
    })
  })

  it('adopt: copies a verified platform listing once, as unverified, for an authorised company only', async () => {
    await as('a@x.com', async (q) => {
      const first = (await q(`select adopt_platform_directory_listing('${A}','${PLAT}') r`))[0].r
      const again = (await q(`select adopt_platform_directory_listing('${A}','${PLAT}') r`))[0].r
      expect(first.already_had).toBe(false)
      expect(again.already_had).toBe(true)
      expect(again.id).toBe(first.id)
      const copy = (await q(`select verification_status, data_source, source_detail, business_id from directory_businesses where id='${first.id}'`))[0]
      expect(copy).toMatchObject({ verification_status: 'unverified', data_source: 'external', source_detail: 'platform:' + PLAT, business_id: A })
      await expect(q(`select adopt_platform_directory_listing('${A}','${PLAT_UNVERIFIED}')`)).rejects.toThrow(/not available/)
      await expect(q(`select adopt_platform_directory_listing('${B}','${PLAT}')`)).rejects.toThrow(/Not authorized/)
    })
    await as('b@x.com', async (q) => {
      await expect(q(`select adopt_platform_directory_listing('${A}','${PLAT}')`)).rejects.toThrow(/Not authorized/)
    })
  })

  it('assign territory: only unassigned active rows of the caller, only a territory the company owns', async () => {
    await as('a@x.com', async (q) => {
      const n = (await q(`select assign_directory_territory('${A}','${TERR}', null) n`))[0].n
      expect(n).toBeGreaterThan(0)
      expect((await q(`select assign_directory_territory('${A}','${TERR}', null) n`))[0].n).toBe(0) // never overwrites, idempotent
      await expect(q(`select assign_directory_territory('${A}','99999999-9999-4999-8999-999999999999', null)`)).rejects.toThrow(/does not belong/)
      await expect(q(`select assign_directory_territory('${B}','${TERR}', null)`)).rejects.toThrow(/Not authorized/)
    })
  })

  it('the new RPCs are not callable by anon and exist exactly once', async () => {
    const r = await db.query(`select proname, count(*) n, bool_or(has_function_privilege('anon', oid, 'execute')) anon_ok
      from pg_proc where proname in ('adopt_platform_directory_listing','assign_directory_territory') group by proname`)
    expect(r.rows).toHaveLength(2)
    for (const row of r.rows) { expect(Number(row.n)).toBe(1); expect(row.anon_ok).toBe(false) }
  })

  it('can_manage_directory is unchanged, so live field-activity visibility keeps working', async () => {
    await as('custom@x.com', async (q) => { expect((await q(`select can_manage_directory('${A}') ok`))[0].ok).toBe(true) })
    await as('b@x.com', async (q) => { expect((await q(`select can_manage_directory('${A}') ok`))[0].ok).toBe(false) })
  })
})
