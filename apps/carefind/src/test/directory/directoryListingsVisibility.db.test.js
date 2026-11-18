// @vitest-environment node
// carehub_20270126: bulk-imported platform listings (unverified on arrival) reach the Field Report
// suggestion and Facility Discovery for Manufacturer / Importer and Wholesale companies.
// Replays the shipped directory schema, 20261202 and 20261208, proves the reported defect
// (an imported, unverified listing is invisible and cannot be linked), applies 20270126, then
// proves: eligible listings appear and can be linked; rejected / inactive / demo / company-owned
// rows never do; search by name, category, place and radius works; contact fields other than
// the business phone stay hidden; callers outside enterprise businesses are refused.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 180000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SQL = (f) => read(`../../../../carehub/sql/${f}`)
const MIG = (f) => read(`../../../../../supabase/migrations/${f}.sql`)

const IMPORTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WHOLESALE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PHARMACY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ADMIN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const IMP_PHARM = id(1), IMP_HOSP = id(2), IMP_FAR = id(3), VERIFIED = id(4)
const REJECTED = id(6), INACTIVE = id(7), DEMO = id(8), OWN_PHARMACY = id(9), WILDCARD = id(10)
const HERE = { lat: 6.5, lng: 3.4 } // Lagos
let db

async function as(email, fn) {
  const sub = '00000000-0000-4000-8000-0000000000aa'
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const near = (q, lat = HERE.lat, lng = HERE.lng, radius = 1, limit = 10) =>
  q(`select * from nearby_directory_businesses(${lat}, ${lng}, ${radius}, ${limit})`)
const discover = async (q, args = {}) => {
  const a = { p_keyword: null, p_state: null, p_lga: null, p_city: null, p_lat: null, p_lng: null, p_radius_km: null, p_limit: null, p_offset: null, ...args }
  const rows = await q(`select discover_directory_listings($1,$2,$3,$4,$5,$6,$7,$8,$9) r`,
    [a.p_keyword, a.p_state, a.p_lga, a.p_city, a.p_lat, a.p_lng, a.p_radius_km, a.p_limit, a.p_offset])
  return rows[0].r
}
const names = (rows) => rows.map((r) => r.name)
const link = (q, bizId, dirId) =>
  q(`insert into field_activities (business_id, rep_name, directory_business_id, directory_business_name)
     values ('${bizId}', 'Rep', '${dirId}', 'snapshot') returning id`)

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
    create table businesses (id uuid primary key, email text, business_type text, is_platform_admin boolean default false);
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
    insert into businesses (id,email,business_type,is_platform_admin) values
      ('${IMPORTER}','importer@x.com','manufacturer_importer',false),
      ('${WHOLESALE}','wholesale@x.com','wholesale',false),
      ('${PHARMACY}','pharmacy@x.com','pharmacy',false),
      ('${ADMIN}','admin@x.com','pharmacy',true);
    insert into staff (business_id,email,role) values ('${IMPORTER}','rep@x.com','Sales Rep');
  `)
  for (const f of ['20261010_business_directory.sql', '20261011_territory_intelligence.sql', '20261012_directory_platform_scope.sql']) await db.exec(SQL(f))
  await db.exec(MIG('carehub_20261202_directory_platform_only'))
  await db.exec(MIG('carehub_20261208_directory_company_lockdown'))

  const cat = async (name) => (await db.query(`select id from directory_categories where business_id is null and name ilike $1 limit 1`, [name])).rows[0]?.id
  const pharmacyCat = await cat('%pharm%')
  const hospitalCat = await cat('%hospital%')
  const row = (rid, biz, name, lat, lng, { status = 'unverified', active = true, source = 'import', state = 'Lagos', lga = 'Ikeja', city = 'Ikeja', category = pharmacyCat, type = 'Pharmacy' } = {}) =>
    `('${rid}', ${biz ? `'${biz}'` : 'null'}, '${name}', '${name.toLowerCase()}', '${status}', ${active}, '${source}', ${lat}, ${lng},
      '12 Allen Avenue', '${type}', '08030000000', 'owner@${name.toLowerCase().replace(/[^a-z]/g, '')}.com', 'Private Person', 'private note',
      '${state}', '${lga}', '${city}', ${category ? `'${category}'` : 'null'})`
  await db.query(`insert into directory_businesses
    (id, business_id, name, name_normalized, verification_status, is_active, data_source, latitude, longitude,
     address, business_type, phone, email, contact_person, description, state, lga, city, category_id) values
    ${[
      row(IMP_PHARM, null, 'Medplus Ikeja', 6.5, 3.4),
      row(IMP_HOSP, null, 'Reddington Hospital', 6.5027, 3.4, { type: 'Hospital', category: hospitalCat }), // ~0.3 km
      row(IMP_FAR, null, 'Kano Pharmacy', 12.0, 8.5, { state: 'Kano', lga: 'Nassarawa', city: 'Kano' }),
      row(VERIFIED, null, 'Verified Chemist', 6.5001, 3.4001, { status: 'verified', source: 'manual' }),
      row(REJECTED, null, 'Rejected Chemist', 6.5, 3.4002, { status: 'rejected' }),
      row(INACTIVE, null, 'Inactive Chemist', 6.5003, 3.4, { active: false }),
      row(DEMO, null, 'Demo Chemist', 6.5, 3.4003, { source: 'demo' }),
      row(OWN_PHARMACY, PHARMACY, 'Own Legacy Row', 6.5, 3.4004, { source: 'manual', category: null }),
      row(WILDCARD, null, 'Percent_Pharmacy 100%', 6.6, 3.35),
    ].join(',\n')}`)
})

describe('before the migration (the reported defect)', () => {
  it('the Field Report suggestion hides an imported, unverified listing standing at the rep\'s position', async () => {
    await as('rep@x.com', async (q) => {
      const got = names(await near(q))
      expect(got).toContain('Verified Chemist')
      expect(got).not.toContain('Medplus Ikeja')
      expect(got).not.toContain('Reddington Hospital')
    })
  })

  it('a report cannot link an imported listing', async () => {
    await as('rep@x.com', async (q) => {
      await expect(link(q, IMPORTER, IMP_PHARM)).rejects.toThrow(/not available to this business account/)
    })
  })

  it('there is no discovery path to the directory for a company', async () => {
    const r = await db.query(`select count(*)::int n from pg_proc where proname = 'discover_directory_listings'`)
    expect(r.rows[0].n).toBe(0)
    await as('importer@x.com', async (q) => { expect(await q('select id from directory_businesses')).toHaveLength(0) })
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(MIG('carehub_20270126_directory_listings_in_field_and_discovery')) })

  describe('Field Report suggestion (nearby_directory_businesses)', () => {
    it('includes imported unverified listings next to verified ones, with their status, nearest first', async () => {
      await as('rep@x.com', async (q) => {
        const rows = await near(q)
        expect(names(rows)).toEqual(expect.arrayContaining(['Medplus Ikeja', 'Reddington Hospital', 'Verified Chemist']))
        expect(rows.find((r) => r.name === 'Medplus Ikeja').verification_status).toBe('unverified')
        expect(rows.find((r) => r.name === 'Verified Chemist').verification_status).toBe('verified')
        const d = rows.map((r) => r.distance_km)
        expect([...d].sort((a, b) => a - b)).toEqual(d)
      })
    })

    it.each(['Rejected Chemist', 'Inactive Chemist', 'Demo Chemist', 'Own Legacy Row', 'Kano Pharmacy'])('never returns %s', async (n) => {
      await as('rep@x.com', async (q) => { expect(names(await near(q))).not.toContain(n) })
    })

    it('keeps its shape (no contact details) and its 1 km / 10 row caps', async () => {
      await as('rep@x.com', async (q) => {
        const rows = await near(q, HERE.lat, HERE.lng, 500, 1000)
        expect(Object.keys(rows[0]).sort()).toEqual(['address', 'business_type', 'distance_km', 'id', 'name', 'verification_status'])
        expect(JSON.stringify(rows)).not.toMatch(/08030000000|owner@|Private Person|private note/)
        expect(rows.length).toBeLessThanOrEqual(10)
        expect(rows.every((r) => r.distance_km <= 1)).toBe(true)
      })
    })
  })

  describe('a report can link an eligible listing', () => {
    it.each([['imported unverified', IMP_PHARM], ['verified', VERIFIED]])('accepts a %s listing', async (_n, dirId) => {
      await as('rep@x.com', async (q) => { expect(await link(q, IMPORTER, dirId)).toHaveLength(1) })
    })

    it.each([['rejected', REJECTED], ['inactive', INACTIVE], ['demo', DEMO], ["another company's", OWN_PHARMACY]])('refuses a %s listing', async (_n, dirId) => {
      await as('rep@x.com', async (q) => { await expect(link(q, IMPORTER, dirId)).rejects.toThrow(/not available to this business account/) })
    })
  })

  describe('Facility Discovery (discover_directory_listings)', () => {
    it('lists every eligible listing nationwide, and nothing else', async () => {
      await as('importer@x.com', async (q) => {
        const r = await discover(q)
        expect(names(r.rows).sort()).toEqual(['Kano Pharmacy', 'Medplus Ikeja', 'Percent_Pharmacy 100%', 'Reddington Hospital', 'Verified Chemist'])
        expect(r.total).toBe(5)
        expect(r.hasMore).toBe(false)
      })
    })

    it('searches by name, by category and by business type', async () => {
      await as('importer@x.com', async (q) => {
        expect(names((await discover(q, { p_keyword: 'medplus' })).rows)).toEqual(['Medplus Ikeja'])
        expect(names((await discover(q, { p_keyword: 'hospital' })).rows)).toEqual(['Reddington Hospital'])
        const pharm = names((await discover(q, { p_keyword: 'pharmacy' })).rows)
        expect(pharm).toEqual(expect.arrayContaining(['Medplus Ikeja', 'Kano Pharmacy']))
        expect(pharm).not.toContain('Reddington Hospital')
      })
    })

    it('searches by state, LGA and city', async () => {
      await as('importer@x.com', async (q) => {
        expect(names((await discover(q, { p_state: 'Kano' })).rows)).toEqual(['Kano Pharmacy'])
        expect(names((await discover(q, { p_state: 'lagos', p_lga: 'ikeja' })).rows)).not.toContain('Kano Pharmacy')
        expect(names((await discover(q, { p_city: 'Kano' })).rows)).toEqual(['Kano Pharmacy'])
      })
    })

    it('searches by radius with straight-line distance, nearest first', async () => {
      await as('importer@x.com', async (q) => {
        const r = await discover(q, { p_lat: HERE.lat, p_lng: HERE.lng, p_radius_km: 1 })
        expect(names(r.rows)[0]).toBe('Medplus Ikeja')
        expect(names(r.rows)).toContain('Reddington Hospital')
        expect(names(r.rows)).not.toContain('Kano Pharmacy')
        expect(names(r.rows)).not.toContain('Percent_Pharmacy 100%') // ~12 km away
        const hosp = r.rows.find((x) => x.name === 'Reddington Hospital')
        expect(hosp.distance_km).toBeGreaterThan(0.25)
        expect(hosp.distance_km).toBeLessThan(0.35)
        expect(r.radiusKm).toBe(1)
        expect(names((await discover(q, { p_lat: HERE.lat, p_lng: HERE.lng, p_radius_km: 20 })).rows)).toContain('Percent_Pharmacy 100%')
      })
    })

    it('returns category, coordinates and business phone; never e-mail, contact person or notes', async () => {
      await as('importer@x.com', async (q) => {
        const row = (await discover(q, { p_keyword: 'medplus' })).rows[0]
        expect(row).toMatchObject({ category: expect.stringMatching(/pharm/i), latitude: 6.5, longitude: 3.4, phone: '08030000000', verification_status: 'unverified', data_source: 'import' })
        expect(Object.keys(row).sort()).toEqual(['address', 'business_type', 'category', 'city', 'data_source', 'distance_km', 'id', 'latitude', 'lga', 'longitude', 'name', 'phone', 'state', 'subcategory', 'verification_status'])
        expect(JSON.stringify((await discover(q)).rows)).not.toMatch(/owner@|Private Person|private note/)
      })
    })

    it('treats LIKE wildcards in user text literally', async () => {
      await as('importer@x.com', async (q) => {
        expect(names((await discover(q, { p_keyword: '%' })).rows)).toEqual(['Percent_Pharmacy 100%'])
        expect(names((await discover(q, { p_keyword: '_' })).rows)).toEqual(['Percent_Pharmacy 100%'])
      })
    })

    it('pages with a capped limit', async () => {
      await as('importer@x.com', async (q) => {
        const p1 = await discover(q, { p_limit: 2 })
        const p2 = await discover(q, { p_limit: 2, p_offset: 2 })
        expect(p1.rows).toHaveLength(2)
        expect(p1.hasMore).toBe(true)
        expect(names(p1.rows).some((n) => names(p2.rows).includes(n))).toBe(false)
        expect((await discover(q, { p_limit: 100000 })).rows.length).toBe(5)
      })
    })

    it('rejects a half or impossible position', async () => {
      await as('importer@x.com', async (q) => {
        await expect(discover(q, { p_lat: 6.5 })).rejects.toThrow(/Invalid position/)
        await expect(discover(q, { p_lat: 95, p_lng: 3 })).rejects.toThrow(/Invalid position/)
      })
    })
  })

  describe('who may call', () => {
    it.each([['importer owner', 'importer@x.com'], ['importer rep', 'rep@x.com'], ['wholesale owner', 'wholesale@x.com'], ['platform admin', 'admin@x.com']])(
      '%s may use both functions', async (_n, email) => {
        await as(email, async (q) => {
          expect((await near(q)).length).toBeGreaterThan(0)
          expect((await discover(q)).total).toBe(5)
        })
      })

    it.each([['pharmacy owner', 'pharmacy@x.com'], ['user with no business', 'nobody@x.com']])('%s is refused', async (_n, email) => {
      await as(email, async (q) => {
        await expect(near(q)).rejects.toThrow(/Not authorized/)
        await expect(discover(q)).rejects.toThrow(/Not authorized/)
      })
    })

    it('anon cannot execute either function; authenticated cannot execute the link guard', async () => {
      const r = await db.query(`select proname, has_function_privilege('anon', oid, 'execute') anon_ok, has_function_privilege('authenticated', oid, 'execute') auth_ok
        from pg_proc where proname in ('nearby_directory_businesses','discover_directory_listings','field_activities_directory_link_guard') order by proname`)
      expect(r.rows).toEqual([
        { proname: 'discover_directory_listings', anon_ok: false, auth_ok: true },
        { proname: 'field_activities_directory_link_guard', anon_ok: false, auth_ok: false },
        { proname: 'nearby_directory_businesses', anon_ok: false, auth_ok: true },
      ])
    })

    it('directory tables stay unreadable to companies', async () => {
      await as('importer@x.com', async (q) => { expect(await q('select id from directory_businesses')).toHaveLength(0) })
    })
  })

  it('is safe to re-apply', async () => {
    await db.exec(MIG('carehub_20270126_directory_listings_in_field_and_discovery'))
    await as('importer@x.com', async (q) => { expect((await discover(q)).total).toBe(5) })
  })
})
