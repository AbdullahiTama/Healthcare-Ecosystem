// @vitest-environment node
// Owner decision 2026-10-22: the Business Directory is platform-admin only, reads included.
// Replays the shipped directory schema (apps/carehub/sql/20261010..12) and 20261202, proves a
// company COULD read the registry before, applies 20261208, then proves: companies read nothing
// through the API, the nearby suggestion is bounded and leaks no contact details, a visit can still
// link a verified platform listing (and nothing else), and the company-facing functions are closed.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 180000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SQL = (f) => read(`../../../../carehub/sql/${f}`)
const MIG = (f) => read(`../../../../../supabase/migrations/${f}.sql`)

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADMIN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const TERR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P_NEAR = id(1), P_NEAR2 = id(2), P_FAR = id(3), P_UNVERIFIED = id(4), P_INACTIVE = id(5), P_DEMO = id(6), P_EDGE = id(7)
const OWN_A = id(20), OWN_B = id(21)
const HERE = { lat: 6.5, lng: 3.4 }
let db

async function as(email, fn) {
  const sub = '00000000-0000-4000-8000-0000000000aa'
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const biz = (rows, name) => rows.find((r) => r.name === name)
const near = (q, lat = HERE.lat, lng = HERE.lng, radius = 0.5, limit = 5) =>
  q(`select * from nearby_directory_businesses(${lat}, ${lng}, ${radius}, ${limit})`)

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
    insert into staff (business_id,email,role) values ('${A}','staff@x.com','Sales Rep'), ('${A}','custom@x.com','Directory Lead');
    insert into roles (business_id,name,permissions) values ('${A}','Directory Lead','{"canManageDirectory": true}');
    insert into territories (id,business_id) values ('${TERR}','${A}');
  `)
  for (const f of ['20261010_business_directory.sql', '20261011_territory_intelligence.sql', '20261012_directory_platform_scope.sql']) await db.exec(SQL(f))
  await db.exec(MIG('carehub_20261202_directory_platform_only'))

  const row = (rid, biz, name, lat, lng, { status = 'verified', active = true, source = 'manual' } = {}) =>
    `('${rid}', ${biz ? `'${biz}'` : 'null'}, '${name}', '${name.toLowerCase()}', '${status}', ${active}, '${source}', ${lat}, ${lng}, '12 Test Road', 'pharmacy', '08030000000', 'contact@${name.toLowerCase().replace(/ /g, '')}.com', 'Lagos')`
  await db.query(`insert into directory_businesses
    (id, business_id, name, name_normalized, verification_status, is_active, data_source, latitude, longitude, address, business_type, phone, email, state) values
    ${[
      row(P_NEAR, null, 'Near Verified', 6.5, 3.4),
      row(P_NEAR2, null, 'Near Verified Two', 6.5027, 3.4),              // ~0.30 km
      row(P_EDGE, null, 'Edge Verified', 6.5081, 3.4),                   // ~0.90 km: inside the 1 km cap, outside 0.5
      row(P_FAR, null, 'Far Verified', 6.6, 3.5),
      row(P_UNVERIFIED, null, 'Near Unverified', 6.5, 3.4001, { status: 'unverified' }),
      row(P_INACTIVE, null, 'Near Inactive', 6.5001, 3.4, { active: false }),
      row(P_DEMO, null, 'Near Demo', 6.5, 3.4002, { source: 'demo' }),
      row(OWN_A, A, 'Own A Pharmacy', 6.5, 3.4003, { status: 'unverified', source: 'manual' }),
      row(OWN_B, B, 'Own B Pharmacy', 6.5, 3.4004, { status: 'unverified', source: 'manual' }),
    ].join(',\n')}`)
})

describe('before the migration (the problem)', () => {
  it('every signed-in company can read the verified registry, contact details included, and its own rows', async () => {
    await as('staff@x.com', async (q) => {
      const rows = await q('select name, phone, email from directory_businesses order by name')
      expect(biz(rows, 'Near Verified')).toMatchObject({ phone: '08030000000' })
      expect(biz(rows, 'Near Verified').email).toMatch(/@/)
      expect(biz(rows, 'Own A Pharmacy')).toBeTruthy()
      expect(biz(rows, 'Own B Pharmacy')).toBeFalsy()
    })
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(MIG('carehub_20261208_directory_company_lockdown')) })

  describe('companies cannot read the directory', () => {
    it.each([['owner', 'a@x.com'], ['staff', 'staff@x.com'], ['custom role with canManageDirectory', 'custom@x.com'], ['other company', 'b@x.com']])(
      '%s reads no directory rows, categories or subcategories', async (_n, email) => {
        await as(email, async (q) => {
          expect(await q('select id from directory_businesses')).toHaveLength(0)
          expect(await q('select id from directory_categories')).toHaveLength(0)
          expect(await q('select id from directory_subcategories')).toHaveLength(0)
        })
      })

    it('the platform admin still reads and manages everything', async () => {
      await as('admin@x.com', async (q) => {
        expect((await q('select id from directory_businesses')).length).toBe(9)
        expect((await q('select id from directory_categories')).length).toBeGreaterThan(0)
        expect(await q(`update directory_businesses set is_active=true where id='${P_NEAR}' returning id`)).toHaveLength(1)
      })
    })

    it('no read policy on a directory table admits a company by predicate', async () => {
      const r = await db.query(`select tablename||'.'||policyname n from pg_policies
        where schemaname='public' and tablename like 'directory\\_%' and cmd in ('SELECT','ALL')
          and (coalesce(qual,'') ilike '%current_business_ids%' or coalesce(qual,'') ilike '%business_id is null%' or coalesce(qual,'') not like '%is_platform_admin()%')`)
      expect(r.rows).toEqual([])
    })
  })

  describe('nearby_directory_businesses', () => {
    it('returns verified active platform listings within the radius, nearest first, and nothing else', async () => {
      await as('staff@x.com', async (q) => {
        const rows = await near(q)
        expect(rows.map((r) => r.name)).toEqual(['Near Verified', 'Near Verified Two'])
        expect(rows[0].distance_km).toBeLessThan(0.01)
        expect(rows[1].distance_km).toBeGreaterThan(0.25)
        expect(rows[1].distance_km).toBeLessThan(0.35)
        const names = rows.map((r) => r.name)
        for (const excluded of ['Near Unverified', 'Near Inactive', 'Near Demo', 'Own A Pharmacy', 'Own B Pharmacy', 'Far Verified', 'Edge Verified']) {
          expect(names).not.toContain(excluded)
        }
      })
    })

    it('exposes only name, address, type, verification and distance: no phone, e-mail, contact or coordinates', async () => {
      await as('staff@x.com', async (q) => {
        const rows = await near(q)
        expect(Object.keys(rows[0]).sort()).toEqual(['address', 'business_type', 'distance_km', 'id', 'name', 'verification_status'])
        expect(JSON.stringify(rows)).not.toMatch(/08030000000|contact@/)
      })
    })

    it('caps the radius at 1 km and the result at 10 rows, whatever the caller asks for', async () => {
      await as('staff@x.com', async (q) => {
        const wide = (await near(q, HERE.lat, HERE.lng, 500, 100)).map((r) => r.name)
        expect(wide).toContain('Edge Verified')          // ~0.9 km is inside the cap
        expect(wide).not.toContain('Far Verified')       // ~15 km is not, however big a radius is requested
      })
      for (let i = 0; i < 12; i++) {
        await db.query(`insert into directory_businesses (business_id, name, name_normalized, verification_status, latitude, longitude)
          values (null, 'Crowd ${i}', 'crowd ${i}', 'verified', ${7.0 + i * 0.00001}, 4.0)`)
      }
      await as('staff@x.com', async (q) => {
        expect(await near(q, 7.0, 4.0, 1, 1000)).toHaveLength(10)
        expect(await near(q, 7.0, 4.0, 1, 0)).toHaveLength(1)
        expect(await near(q, 7.0, 4.0, 1, 2)).toHaveLength(2)
      })
    })

    it('rejects impossible coordinates', async () => {
      await as('staff@x.com', async (q) => {
        await expect(near(q, 91, 0)).rejects.toThrow(/Invalid position/)
        await expect(near(q, 0, 181)).rejects.toThrow(/Invalid position/)
        await expect(q(`select * from nearby_directory_businesses(null, null)`)).rejects.toThrow(/Invalid position/)
      })
    })

    it('is for signed-in company staff only: not anon, not a user with no business', async () => {
      await as('nobody@x.com', async (q) => { await expect(near(q)).rejects.toThrow(/Not authorized/) })
      await db.query('set role anon')
      try { await expect(db.query(`select * from nearby_directory_businesses(6.5, 3.4)`)).rejects.toThrow(/permission denied/) } finally { await db.query('reset role') }
      await as('a@x.com', async (q) => { expect((await near(q)).length).toBeGreaterThan(0) })
    })

    it('exists exactly once and is not executable by anon', async () => {
      const r = await db.query(`select count(*)::int n, bool_or(has_function_privilege('anon', oid, 'execute')) anon_ok,
        bool_and(has_function_privilege('authenticated', oid, 'execute')) auth_ok
        from pg_proc where proname = 'nearby_directory_businesses'`)
      expect(r.rows[0]).toEqual({ n: 1, anon_ok: false, auth_ok: true })
    })
  })

  describe('a visit can link a verified platform listing (and nothing it should not)', () => {
    const log = (q, bizId, dirId) =>
      q(`insert into field_activities (business_id, rep_name, directory_business_id, directory_business_name)
         values ('${bizId}', 'Rep', ${dirId ? `'${dirId}'` : 'null'}, 'snapshot') returning id`)

    it('accepts a verified active platform listing, through the real company path (guard runs as definer)', async () => {
      await as('staff@x.com', async (q) => { expect(await log(q, A, P_NEAR)).toHaveLength(1) })
    })

    it('still accepts no link, and a company\'s own legacy row', async () => {
      await as('staff@x.com', async (q) => {
        expect(await log(q, A, null)).toHaveLength(1)
        expect(await log(q, A, OWN_A)).toHaveLength(1)
      })
    })

    it.each([['unverified platform listing', P_UNVERIFIED], ['inactive platform listing', P_INACTIVE], ['demo listing', P_DEMO], ["another company's row", OWN_B]])(
      'refuses a %s', async (_n, dirId) => {
        await as('staff@x.com', async (q) => { await expect(log(q, A, dirId)).rejects.toThrow(/not available to this business account/) })
      })

    it('the guard function is not callable by API roles', async () => {
      const r = await db.query(`select has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') n
        from pg_proc where proname = 'field_activities_directory_link_guard'`)
      expect(r.rows[0]).toEqual({ a: false, n: false })
    })
  })

  describe('company-facing directory functions are closed', () => {
    it('adopt, assign and the four Territory Intelligence readers are not executable by authenticated or anon, but are by service_role', async () => {
      const r = await db.query(`select proname, has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') n,
          has_function_privilege('service_role', oid, 'execute') s
        from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('adopt_platform_directory_listing','assign_directory_territory','directory_coverage_summary','directory_unvisited','directory_visit_totals','directory_rep_activity')`)
      expect(r.rows).toHaveLength(6)
      for (const row of r.rows) expect(row, row.proname).toMatchObject({ a: false, n: false, s: true })
    })

    it('a company cannot call them through the API', async () => {
      await as('a@x.com', async (q) => {
        await expect(q(`select adopt_platform_directory_listing('${A}','${P_NEAR}')`)).rejects.toThrow(/permission denied/)
        await expect(q(`select assign_directory_territory('${A}','${TERR}', null)`)).rejects.toThrow(/permission denied/)
        await expect(q(`select * from directory_visit_totals('${A}', now() - interval '30 days')`)).rejects.toThrow(/permission denied/)
      })
    })
  })

  it('can_manage_directory is unchanged, so "see all field activity" keeps working for a granted role', async () => {
    await as('custom@x.com', async (q) => { expect((await q(`select can_manage_directory('${A}') ok`))[0].ok).toBe(true) })
    await as('b@x.com', async (q) => { expect((await q(`select can_manage_directory('${A}') ok`))[0].ok).toBe(false) })
  })

  it('writes stay platform-admin only', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`insert into directory_businesses (business_id,name,name_normalized) values ('${A}','x','x')`)).rejects.toThrow(/row-level security/)
    })
  })
})
