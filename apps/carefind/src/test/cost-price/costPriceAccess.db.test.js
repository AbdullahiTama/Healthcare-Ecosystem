// @vitest-environment node
// carehub_20270202_cost_price_access + carehub_20270203_cost_price_column_guard on PGlite (CODE_AUDIT A25).
// products carries its live columns, grants (table-level to anon/authenticated) and the four live policies (read
// 2026-11-22); current_business_ids / is_business_owner / is_platform_admin are the live definitions.
// Before part 2 any signed-in user could read the cost of every listed product, and every staff member their
// business's costs; after it, costs come only from product_costs(), for the Owner and roles allowed to see them.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
const PART1 = repoFile('supabase/migrations/carehub_20270202_cost_price_access.sql')
const PART2 = repoFile('supabase/migrations/carehub_20270203_cost_price_column_guard.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'      // a pharmacy
const BRANCH = 'a0000000-0000-4000-8000-000000000002'   // its branch
const RIVAL = 'b0000000-0000-4000-8000-000000000001'    // another business
const P1 = 'c0000000-0000-4000-8000-000000000001'       // listed on CareFind, cost 800
const P2 = 'c0000000-0000-4000-8000-000000000002'       // not listed, cost 50
const P3 = 'c0000000-0000-4000-8000-000000000003'       // listed, no cost
const PB = 'c0000000-0000-4000-8000-000000000009'       // the branch's product, cost 300
const USERS = {
  owner: 'owner@pharm.ng', manager: 'manager@pharm.ng', cashier: 'cashier@pharm.ng', custom: 'stock@pharm.ng',
  customOff: 'shift@pharm.ng', staffOwner: 'partner@pharm.ng', inactive: 'old@pharm.ng', rival: 'owner@rival.ng',
  shopper: 'shopper@example.com',
}
const uid = (k) => `10000000-0000-4000-8000-${String(Object.keys(USERS).indexOf(k) + 1).padStart(12, '0')}`

let db
// Runs `sql` as user `who` (or anon when who is null) in a transaction that is rolled back.
async function as(who, sql, params) {
  await db.exec('begin')
  try {
    if (who) {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: uid(who), email: USERS[who], role: 'authenticated' })])
      await db.exec('set local role authenticated')
    } else {
      await db.exec('set local role anon')
    }
    return { rows: (await db.query(sql, params)).rows }
  } catch (e) {
    return { error: e.message, code: e.code }
  } finally {
    await db.exec('rollback')
  }
}
const costs = async (who, biz = BIZ, ids = null) =>
  (await as(who, `select product_costs($1, $2::uuid[]) c`, [biz, ids])).rows?.[0]?.c

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table businesses (id uuid primary key, name text, email text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active');
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb, created_at timestamptz default now());
    create table business_claims (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, status text);
    grant select on businesses, staff, roles, business_claims to authenticated;

    -- Live definitions (2026-11-22).
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 from businesses b join staff s on s.business_id = b.id where lower(s.email) = lower(auth.email()) and s.status = 'active'
        union all
        select c.id, c.parent_business_id, c.branch_depth_limit, visible.depth + 1 from businesses c join visible on c.parent_business_id = visible.id where visible.depth < visible.branch_depth_limit)
      select distinct id from visible $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    revoke execute on function is_platform_admin() from public, anon;
    grant execute on function is_platform_admin() to authenticated;
    create function is_business_owner(bid uuid) returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1
          FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s
                       WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner'
                         AND lower(s.email) = lower(auth.email()))
         ) $$;
    create function is_rx_restricted(p_rx_status text) returns boolean language sql immutable as $$ select coalesce(p_rx_status, '') in ('prescription_only', 'controlled') $$;
    create function is_carefind_unpriced(p_rx_status text, p_price numeric) returns boolean language sql immutable as $$ select not public.is_rx_restricted(p_rx_status) and coalesce(p_price, 0) <= 0 $$;

    -- products: live columns (order as live), table-level grants, live policies.
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text not null, generic_name text, category text,
      price numeric, stock integer default 0, emoji text, list_on_carefind boolean default false, created_at timestamptz default now(),
      cost_price numeric, barcode text, reorder_level integer, owner_id uuid, description text, image_url text, whatsapp text, sale_type text,
      min_purchase integer, price_unit text, seller_location text, sales_unit text, shelf text, expiry text, batch text, show_price boolean default true,
      latitude numeric, longitude numeric, expiry_date date, shelf_label text, is_quarantined boolean default false, tracking_mode text default 'none',
      master_product_id uuid, rx_status text, price_source text, updated_at timestamptz);
    grant select, insert, update, delete on products to anon, authenticated;
    alter table products enable row level security;
    create policy "products insertable by owner or approved claimant" on products for insert to public
      with check ((owner_id = (select auth.uid())) or (business_id in (select business_id from business_claims where user_id = (select auth.uid()) and status = 'approved')));
    create policy "products of own business" on products for all to authenticated
      using ((business_id in (select current_business_ids())) or is_platform_admin())
      with check ((business_id in (select current_business_ids())) or is_platform_admin());
    create policy "products updatable by owner or approved claimant" on products for update to public
      using ((owner_id = (select auth.uid())) or (business_id in (select business_id from business_claims where user_id = (select auth.uid()) and status = 'approved')))
      with check ((owner_id = (select auth.uid())) or (business_id in (select business_id from business_claims where user_id = (select auth.uid()) and status = 'approved')));
    create policy "public can view listed products" on products for select to public
      using ((list_on_carefind = true) and (((not is_rx_restricted(rx_status)) and (not is_carefind_unpriced(rx_status, price)))
        or (owner_id = (select auth.uid())) or (business_id in (select bc.business_id from business_claims bc where bc.user_id = (select auth.uid()) and bc.status = 'approved'))));

    insert into businesses (id, name, email, parent_business_id) values
      ('${BIZ}', 'Ada Pharmacy', '${USERS.owner}', null), ('${BRANCH}', 'Ada Pharmacy Yaba', null, '${BIZ}'), ('${RIVAL}', 'Rival', '${USERS.rival}', null);
    insert into roles (business_id, name, permissions) values
      ('${BIZ}', 'Stock Controller', '{"canViewCostPrice": true}'),
      ('${BIZ}', 'Night Shift', '{"canViewCostPrice": false, "canMakeSales": true}'),
      ('${BIZ}', 'Manager', '{"canViewCostPrice": false}');                  -- a business may redefine a preset
    insert into staff (business_id, email, role, status) values
      ('${BIZ}', '${USERS.manager}', 'Regional Manager', 'active'),
      ('${BIZ}', '${USERS.cashier}', 'Cashier', 'active'),
      ('${BIZ}', '${USERS.custom}', 'Stock Controller', 'active'),
      ('${BIZ}', '${USERS.customOff}', 'Night Shift', 'active'),
      ('${BIZ}', '${USERS.staffOwner}', 'Owner', 'active'),
      ('${BIZ}', '${USERS.inactive}', 'Stock Controller', 'inactive');
    insert into products (id, business_id, name, price, cost_price, list_on_carefind, stock) values
      ('${P1}', '${BIZ}', 'Amoxil 500mg', 1200, 800, true, 10),
      ('${P2}', '${BIZ}', 'Back office item', 100, 50, false, 3),
      ('${P3}', '${BIZ}', 'Vitamin C', 500, null, true, 4),
      ('${PB}', '${BRANCH}', 'Branch item', 400, 300, true, 2);
  `)
})

describe('before (today)', () => {
  it('any signed-in user reads the cost of a listed product of any business; a cashier reads all of theirs', async () => {
    expect((await as('shopper', `select cost_price from products where id = '${P1}'`)).rows).toEqual([{ cost_price: '800' }])
    expect((await as('cashier', `select count(cost_price)::int n from products where business_id = '${BIZ}'`)).rows[0].n).toBe(2)
  })
})

describe('part 1: can_view_cost_price and product_costs', () => {
  beforeAll(async () => { await db.exec(PART1) })

  it('the Owner, a staff member with role Owner, a custom role with the switch: costs', async () => {
    for (const who of ['owner', 'staffOwner', 'custom']) {
      expect(await costs(who), who).toEqual({ [P1]: 800, [P2]: 50 })
    }
  })

  it('a preset Manager sees costs; the same preset redefined by the business without the switch does not', async () => {
    await db.exec(`insert into staff (business_id, email, role) values ('${RIVAL}', 'mgr@rival.ng', 'Manager')`)
    USERS.rivalManager = 'mgr@rival.ng'
    expect(await costs('rivalManager', RIVAL)).toEqual({})   // rival has no products with cost, but may ask
    expect((await as('rivalManager', `select can_view_cost_price('${RIVAL}') ok`)).rows[0].ok).toBe(true)
    await db.exec(`insert into staff (business_id, email, role) values ('${BIZ}', 'preset@pharm.ng', 'Manager')`)
    USERS.presetMgr = 'preset@pharm.ng'
    expect(await costs('presetMgr')).toEqual({})               // BIZ redefined "Manager" without canViewCostPrice
  })

  it('a role named like a manager but without the switch, a cashier, a custom role with it off: nothing', async () => {
    for (const who of ['manager', 'cashier', 'customOff']) expect(await costs(who), who).toEqual({})
  })

  it('inactive staff, another business, a shopper: nothing', async () => {
    for (const who of ['inactive', 'rival', 'shopper']) expect(await costs(who), who).toEqual({})
  })

  it('the Owner of the parent sees a branch\'s costs; parent staff with the switch too', async () => {
    expect(await costs('owner', BRANCH)).toEqual({ [PB]: 300 })
    expect(await costs('custom', BRANCH)).toEqual({ [PB]: 300 })
    expect(await costs('cashier', BRANCH)).toEqual({})
  })

  it('only the ids asked for; a product of another business is never returned', async () => {
    expect(await costs('owner', BIZ, [P2, PB])).toEqual({ [P2]: 50 })
  })

  it('anon cannot call it', async () => {
    expect((await as(null, `select product_costs('${BIZ}')`)).code).toBe('42501')
  })
})

describe('part 2: the column is closed to the API roles', () => {
  beforeAll(async () => { await db.exec(PART2) })

  it('nobody reads cost_price directly any more, not even the Owner; select * is refused', async () => {
    for (const who of ['shopper', 'cashier', 'owner']) {
      expect((await as(who, `select cost_price from products`)).code, who).toBe('42501')
      expect((await as(who, `select * from products`)).code, who).toBe('42501')
      expect((await as(who, `select id from products where cost_price > 0`)).code, who).toBe('42501')
    }
  })

  it('every other column is still readable, as before (CareFind and CareHub reads unaffected)', async () => {
    const cols = (await db.query(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name = 'products' and column_name <> 'cost_price'`)).rows[0].c
    const shopper = await as('shopper', `select ${cols} from products order by name`)
    expect(shopper.rows.map((r) => r.id)).toEqual([P1, PB, P3])    // listed only, as before
    const cashier = await as('cashier', `select id, name, price, show_price, stock, sale_type, min_purchase, price_unit, list_on_carefind from products where business_id = '${BIZ}'`)
    expect(cashier.rows).toHaveLength(3)
  })

  it('costs still come through product_costs to the people allowed', async () => {
    expect(await costs('owner')).toEqual({ [P1]: 800, [P2]: 50 })
    expect(await costs('cashier')).toEqual({})
  })

  it('saving still works: a purchase updates the cost, a new product keeps its cost, reading back named columns', async () => {
    const upd = await as('cashier', `update products set cost_price = 900, stock = stock + 5 where id = '${P1}' returning id, stock`)
    expect(upd.rows).toEqual([{ id: P1, stock: 15 }])
    const ins = await as('owner', `insert into products (business_id, name, price, cost_price) values ('${BIZ}', 'New', 10, 6) returning id, name`)
    expect(ins.rows[0].name).toBe('New')
    // ...but asking for the whole row back (PostgREST return=representation with no select list) is refused.
    expect((await as('owner', `update products set price = 1300 where id = '${P1}' returning *`)).code).toBe('42501')
  })

  it('a CareFind claimant can still update price, stock and listing of a claimed business', async () => {
    await db.exec(`insert into business_claims (business_id, user_id, status) values ('${RIVAL}', '${uid('shopper')}', 'approved')`)
    await db.exec(`insert into products (id, business_id, name, price, cost_price, list_on_carefind) values ('c0000000-0000-4000-8000-000000000020', '${RIVAL}', 'Claimed', 100, 70, true)`)
    const r = await as('shopper', `update products set price = 120, stock = 2, list_on_carefind = true where id = 'c0000000-0000-4000-8000-000000000020' returning id`)
    expect(r.rows).toHaveLength(1)
  })

  it('is idempotent', async () => {
    await db.exec(PART1)
    await db.exec(PART2)
    expect((await as('shopper', `select cost_price from products`)).code).toBe('42501')
    expect(await costs('owner')).toEqual({ [P1]: 800, [P2]: 50 })
  })
})
