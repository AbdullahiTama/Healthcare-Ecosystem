// @vitest-environment node
// CareHub plan limits and expiry restrictions (carehub_20261214_plan_enforcement), on PGlite with the live shapes of
// businesses / staff / products and the live guard_business_insert.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLAN_LIMITS } from '../../../../carehub/src/lib/planLimits.js'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261214_plan_enforcement.sql', import.meta.url)), 'utf8')

const ids = { active: 'a0000000-0000-4000-8000-000000000001', grace: 'a0000000-0000-4000-8000-000000000002', restricted: 'a0000000-0000-4000-8000-000000000003', growth: 'a0000000-0000-4000-8000-000000000004', other: 'a0000000-0000-4000-8000-000000000005' }
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
// Moves the enforcement start, as if the migration had been applied that long ago.
const startedDaysAgo = (days) => db.exec(`create or replace function public.plan_enforcement_started_at() returns timestamptz language sql immutable as $$ select '${new Date(Date.now() - days * 86400000).toISOString()}'::timestamptz $$`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), name text, email text, status text default 'active', plan text default 'basic',
      plan_expires_at timestamptz, parent_business_id uuid, deleted_at timestamptz, is_platform_admin boolean default false,
      referring_agent_id uuid, branch_depth_limit integer default 3);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text, stock integer default 0);
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive v(id, d) as (select id, 0 from businesses where lower(email) = lower(auth.email())
        union all select c.id, v.d + 1 from businesses c join v on c.parent_business_id = v.id where v.d < 5)
      select distinct id from v $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for all to authenticated using (id in (select current_business_ids()) or lower(email) = lower(auth.email())) with check (true);
    create policy "own staff" on staff for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    create policy "own products" on products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
  `)
  await db.exec(`
    insert into businesses (id, name, email, plan, plan_expires_at) values
      ('${ids.active}', 'Active', 'active@x.com', 'basic', now() + interval '60 days'),
      ('${ids.grace}', 'Lapsed long ago', 'grace@x.com', 'basic', now() - interval '70 days'),
      ('${ids.restricted}', 'Lapsed', 'restricted@x.com', 'basic', now() - interval '20 days'),
      ('${ids.growth}', 'Growth', 'growth@x.com', 'growth', now() + interval '200 days'),
      ('${ids.other}', 'Other', 'other@x.com', 'basic', now() + interval '60 days');
    insert into businesses (name, email, is_platform_admin, plan_expires_at) values ('Platform', 'admin@x.com', true, now() + interval '1 year');
  `)
  await db.exec(MIGRATION)
  await db.exec('create trigger a_guard_business_insert before insert on public.businesses for each row execute function public.guard_business_insert()')
})

describe('the rules', () => {
  it('match lib/planLimits.js for every plan (null in the database is unlimited)', async () => {
    for (const [plan, l] of Object.entries(PLAN_LIMITS)) {
      const r = await one(`select plan_limit($1,'staff') s, plan_limit($1,'locations') l, plan_limit($1,'products') p`, [plan])
      const asJs = (v) => (v === null ? Infinity : Number(v))
      expect([asJs(r.s), asJs(r.l), asJs(r.p)], plan).toEqual([l.maxStaff, l.maxLocations, l.maxProducts])
    }
  })

  it('states: active, expiring within 14 days, 7 days of grace, then restricted', async () => {
    await startedDaysAgo(365)
    const st = async (iv) => (await one(`select plan_state(now() + interval '${iv}') s`)).s
    expect(await st('30 days')).toBe('active')
    expect(await st('10 days')).toBe('expiring')
    expect(await st('-3 days')).toBe('grace')
    expect(await st('-8 days')).toBe('restricted')
    expect((await one('select plan_state(null) s')).s).toBe('active')
  })

  it('a business already expired when this goes live gets a fresh 7-day grace from that moment', async () => {
    await startedDaysAgo(0)
    expect((await one(`select plan_state(now() - interval '70 days') s`)).s).toBe('grace')
    await startedDaysAgo(8)
    expect((await one(`select plan_state(now() - interval '70 days') s`)).s).toBe('restricted')
  })

  it('re-running the migration keeps the original enforcement start', async () => {
    await startedDaysAgo(30)
    const before = (await one('select plan_enforcement_started_at() t')).t
    await db.exec(MIGRATION)
    expect((await one('select plan_enforcement_started_at() t')).t).toEqual(before)
  })
})

describe('business_plan_status', () => {
  it('gives a member the state, dates and limits; nothing for another business', async () => {
    await startedDaysAgo(30)
    const mine = await as('restricted@x.com', (q) => q(`select business_plan_status('${ids.restricted}') s`))
    expect(mine[0].s).toMatchObject({ plan: 'basic', state: 'restricted', limits: { staff: 5, locations: 2, products: 5000 } })
    expect(mine[0].s.grace_ends_at).toBeTruthy()
    const theirs = await as('active@x.com', (q) => q(`select business_plan_status('${ids.restricted}') s`))
    expect(theirs[0].s).toBeNull()
  })
})

describe('products', () => {
  it('a restricted business cannot add products but can still update them; a business in grace can add', async () => {
    await startedDaysAgo(30)
    await db.query(`insert into products (business_id, name) values ('${ids.restricted}', 'Existing')`)
    await as('restricted@x.com', async (q) => {
      await expect(q(`insert into products (business_id, name) values ('${ids.restricted}', 'New')`)).rejects.toThrow(/plan has expired.*add products/)
      await q(`update products set stock = 10 where business_id = '${ids.restricted}'`)
    })
    expect((await one(`select stock from products where business_id = '${ids.restricted}'`)).stock).toBe(10)
    await startedDaysAgo(0)
    await as('grace@x.com', (q) => q(`insert into products (business_id, name) values ('${ids.grace}', 'Allowed in grace')`))
  })

  it('Basic stops at 5,000 products, and a bulk import that would cross it is refused as a whole', async () => {
    await db.query(`insert into products (business_id, name) select '${ids.active}', 'P' || g from generate_series(1, 4998) g`)
    await as('active@x.com', async (q) => {
      await expect(q(`insert into products (business_id, name) select '${ids.active}', 'Bulk' || g from generate_series(1, 3) g`)).rejects.toThrow(/up to 5,000 products/)
      await q(`insert into products (business_id, name) values ('${ids.active}', 'Number 4999'), ('${ids.active}', 'Number 5000')`)
      await expect(q(`insert into products (business_id, name) values ('${ids.active}', 'One too many')`)).rejects.toThrow(/up to 5,000 products/)
    })
    expect(Number((await one(`select count(*) c from products where business_id = '${ids.active}'`)).c)).toBe(5000)
  })

  it('server code (service role) and platform admins are not limited', async () => {
    await db.query('set role service_role')
    try {
      await db.query(`insert into products (business_id, name) values ('${ids.active}', 'Server import')`)
    } finally { await db.query('reset role') }
    expect(Number((await one(`select count(*) c from products where business_id = '${ids.active}'`)).c)).toBe(5001)
  })
})

describe('staff', () => {
  it('Basic stops at 5 staff, even when added by server code; a platform admin can still add', async () => {
    await startedDaysAgo(30)
    await db.query(`insert into staff (business_id, full_name) select '${ids.active}', 'S' || g from generate_series(1, 5) g`).catch(() => {})
    expect(Number((await one(`select count(*) c from staff where business_id = '${ids.active}'`)).c)).toBe(5)
    await expect(db.query(`insert into staff (business_id, full_name) values ('${ids.active}', 'Sixth')`)).rejects.toThrow(/up to 5 staff/)
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ email: 'admin@x.com', role: 'authenticated' })])
    await db.query(`insert into staff (business_id, full_name) values ('${ids.active}', 'Added by admin')`)
    await db.query("select set_config('request.jwt.claims', '', false)")
  })

  it('a restricted business cannot add staff; Growth has no staff limit', async () => {
    await expect(db.query(`insert into staff (business_id, full_name) values ('${ids.restricted}', 'New')`)).rejects.toThrow(/plan has expired.*add staff/)
    await db.query(`insert into staff (business_id, full_name) select '${ids.growth}', 'G' || g from generate_series(1, 8) g`)
    expect(Number((await one(`select count(*) c from staff where business_id = '${ids.growth}'`)).c)).toBe(8)
  })
})

describe('branches', () => {
  const branch = (parent, name) => `insert into businesses (name, parent_business_id, status, plan) values ('${name}', '${parent}', 'active', null)`

  it('Basic allows the main business and one branch; a deleted branch frees its place', async () => {
    await startedDaysAgo(30)
    await as('active@x.com', async (q) => {
      await q(branch(ids.active, 'Branch 1'))
      await expect(q(branch(ids.active, 'Branch 2'))).rejects.toThrow(/up to 2 locations/)
    })
    await db.query(`update businesses set deleted_at = now() where name = 'Branch 1'`)
    await as('active@x.com', (q) => q(branch(ids.active, 'Branch 2')))
  })

  it('Growth allows five locations', async () => {
    await as('growth@x.com', async (q) => {
      for (let i = 1; i <= 4; i++) await q(branch(ids.growth, 'G' + i))
      await expect(q(branch(ids.growth, 'G5'))).rejects.toThrow(/up to 5 locations/)
    })
  })

  it('a restricted business cannot add a branch; the existing guard still applies', async () => {
    await as('restricted@x.com', async (q) => {
      await expect(q(branch(ids.restricted, 'New branch'))).rejects.toThrow(/plan has expired.*add branches/)
      await expect(q(branch(ids.other, 'Not mine'))).rejects.toThrow(/business you own/)
    })
  })
})

describe('grants', () => {
  it('the trigger functions cannot be called directly; the rules can', async () => {
    await as('active@x.com', async (q) => {
      await expect(q('select products_enforce_plan()')).rejects.toThrow()
      await expect(q('select staff_enforce_plan()')).rejects.toThrow()
      expect((await q(`select plan_limit('basic','staff') l`))[0].l).toBe(5)
    })
  })
})
