// @vitest-environment node
// carehub_20270205_wholesale_retail_prices on PGlite, applied over the sale price guard as it is live
// (carehub_20260814_guard_sale_item_prices, then carehub_20270118_sale_guard_branch_owner), with the live helper
// functions and grants (verbatim from saleGuardBranchOwner.db.test.js). A Cashier (no "Edit prices") must be able to
// sell at the retail price or the wholesale price a product has, and at nothing else.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const mig = (f) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + f, import.meta.url)), 'utf8')
const GUARD = mig('carehub_20260814_guard_sale_item_prices.sql')
const BRANCH_OWNER = mig('carehub_20270118_sale_guard_branch_owner.sql')
const MIGRATION = mig('carehub_20270205_wholesale_retail_prices.sql')
const COLUMN_GUARD = mig('carehub_20270203_cost_price_column_guard.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const BRANCH = 'a0000000-0000-4000-8000-000000000002'
const DEEP = 'a0000000-0000-4000-8000-000000000003'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const P_BOTH = 'c0000000-0000-4000-8000-000000000001' // retail 500, wholesale 420 (set after the migration)
const P_RETAIL = 'c0000000-0000-4000-8000-000000000002' // retail 900 only
const P_WHOLESALE = 'c0000000-0000-4000-8000-000000000003' // wholesale 300 only (retail 0 = not entered)
const P_OTHER = 'c0000000-0000-4000-8000-000000000004'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng'
const BRANCH_CASHIER = 'till@yaba.pharm.ng'
const STRANGER = 'owner@other.ng'

let db
async function as(email, sql) {
  await db.exec('begin')
  try {
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-0000000000' + String(email.length).padStart(2, '0'), email, role: 'authenticated' })])
    await db.exec('set local role authenticated')
    const res = await db.query(sql)
    return { rows: res.rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const sale = (biz, product, price) => `insert into sales (business_id, items, total) values ('${biz}', to_jsonb('[{"id":"${product}","name":"Item","qty":1,"price":${price},"price_tier":"wholesale"}]'::text), ${price}) returning id`

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
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb);
    create table products (id uuid primary key, business_id uuid, name text, price numeric default 0, cost_price numeric default 0);
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, items jsonb, total numeric);
    insert into businesses (id, name, email, branch_depth_limit) values ('${BIZ}', 'Pharm', '${OWNER}', 1), ('${OTHER}', 'Other', '${STRANGER}', 3);
    insert into businesses (id, name, email, parent_business_id, branch_depth_limit) values ('${BRANCH}', 'Pharm Yaba', 'yaba@pharm.ng', '${BIZ}', 0), ('${DEEP}', 'Pharm Yaba 2', 'yaba2@pharm.ng', '${BRANCH}', 3);
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier'), ('${BRANCH}', 'Tunde', '${BRANCH_CASHIER}', 'Cashier');
    insert into products (id, business_id, name, price) values ('${P_BOTH}', '${BIZ}', 'Paracetamol', 500), ('${P_RETAIL}', '${BIZ}', 'Amoxil', 900), ('${P_WHOLESALE}', '${BIZ}', 'ORS', 0), ('${P_OTHER}', '${OTHER}', 'Paracetamol', 500);

    -- Live definitions, verbatim (2026-11-15).
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
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;

    CREATE OR REPLACE FUNCTION public.caller_owns_business(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE up(id, parent_business_id, email, depth) AS (
        SELECT b.id, b.parent_business_id, b.email, 0 FROM public.businesses b WHERE b.id = bid
        UNION
        SELECT p.id, p.parent_business_id, p.email, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
      )
      SELECT auth.email() IS NOT NULL AND EXISTS (SELECT 1 FROM up WHERE lower(up.email) = lower(auth.email()))
    $function$;
    -- Function grants exactly as live (read 2026-11-15). Postgres grants EXECUTE to PUBLIC by default; Supabase does
    -- not keep it. is_business_owner is NOT executable by authenticated: a trigger running as the caller cannot use it
    -- (the first version of this fix did, and refused every sale in production for 72 s).
    revoke execute on function public.current_business_ids(), public.is_business_owner(uuid), public.is_platform_admin(), public.caller_owns_business(uuid) from public;
    grant execute on function public.current_business_ids() to authenticated, anon, service_role;
    grant execute on function public.is_platform_admin(), public.caller_owns_business(uuid) to authenticated, service_role;
    grant execute on function public.is_business_owner(uuid) to service_role;

    alter table sales enable row level security;
    alter table products enable row level security;
    alter table staff enable row level security;
    alter table roles enable row level security;
    create policy "sales of own business" on sales for all using ((business_id in (select current_business_ids())) or is_platform_admin()) with check ((business_id in (select current_business_ids())) or is_platform_admin());
    create policy p on products for select using (business_id in (select current_business_ids()));
    create policy s on staff for select using (business_id in (select current_business_ids()));
    create policy r on roles for select using (business_id in (select current_business_ids()));
    grant select, insert on sales to authenticated;
    grant select on products, staff, roles, businesses to authenticated;
  `)
  await db.exec(GUARD)
  await db.exec(BRANCH_OWNER)
})

describe('before the migration (the reported limitation)', () => {
  it('refuses a Cashier selling below the single catalog price', async () => {
    expect((await as(CASHIER, sale(BIZ, P_BOTH, 420))).error).toMatch(/Price override not allowed/)
  })
})

describe('after carehub_20270205_wholesale_retail_prices', () => {
  beforeAll(async () => {
    await db.exec(MIGRATION)
    await db.exec(`update products set wholesale_price = 420 where id = '${P_BOTH}'; update products set wholesale_price = 300 where id = '${P_WHOLESALE}'`)
  })

  it('adds an optional column: existing products keep no wholesale price', async () => {
    const r = await db.query(`select wholesale_price from products where id = '${P_RETAIL}'`)
    expect(r.rows[0].wholesale_price).toBeNull()
  })

  it('refuses a negative wholesale price', async () => {
    await expect(db.exec(`update products set wholesale_price = -1 where id = '${P_RETAIL}'`)).rejects.toThrow(/products_wholesale_price_not_negative/)
  })

  it('lets a Cashier sell at the retail price or the wholesale price', async () => {
    expect((await as(CASHIER, sale(BIZ, P_BOTH, 500))).rows).toHaveLength(1)
    expect((await as(CASHIER, sale(BIZ, P_BOTH, 420))).rows).toHaveLength(1)
  })

  it('lets a Cashier sell a wholesale-only product at its wholesale price', async () => {
    expect((await as(CASHIER, sale(BIZ, P_WHOLESALE, 300))).rows).toHaveLength(1)
  })

  it('still refuses any other price from a Cashier, naming both prices', async () => {
    const r = await as(CASHIER, sale(BIZ, P_BOTH, 400))
    expect(r.error).toMatch(/Price override not allowed/)
    expect(r.error).toMatch(/500 \(retail\) or 420 \(wholesale\)/)
  })

  it('keeps the old message and rule for a product without a wholesale price', async () => {
    expect((await as(CASHIER, sale(BIZ, P_RETAIL, 900))).rows).toHaveLength(1)
    const r = await as(CASHIER, sale(BIZ, P_RETAIL, 420))
    expect(r.error).toMatch(/is priced at 900 but was recorded at 420/)
  })

  it('still lets the Owner set any price', async () => {
    expect((await as(OWNER, sale(BIZ, P_BOTH, 377))).rows).toHaveLength(1)
  })

  it('still refuses negative prices, strangers, and staff of another business', async () => {
    expect((await as(OWNER, sale(BIZ, P_BOTH, -5))).error).toMatch(/Invalid sale price/)
    expect((await as(STRANGER, sale(BIZ, P_BOTH, 420))).error).toBeTruthy()
    expect((await as(BRANCH_CASHIER, sale(BIZ, P_BOTH, 420))).error).toBeTruthy()
  })

  it('does not let another business\'s wholesale price unlock a price', async () => {
    // P_OTHER belongs to OTHER: the guard skips products of other businesses, as before, and RLS refuses the sale.
    expect((await as(CASHIER, sale(OTHER, P_OTHER, 1))).error).toBeTruthy()
  })

  it('keeps the column readable by signed-in users once the cost-price column guard is applied', async () => {
    await db.exec(COLUMN_GUARD)
    const r = await as(CASHIER, `select id, price, wholesale_price from products where id = '${P_BOTH}'`)
    expect(r.error).toBeUndefined()
    expect(Number(r.rows[0].wholesale_price)).toBe(420)
    expect((await as(CASHIER, `select cost_price from products where id = '${P_BOTH}'`)).error).toMatch(/permission denied/)
  })

  it('can be re-run (idempotent)', async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeDefined()
  })
})
