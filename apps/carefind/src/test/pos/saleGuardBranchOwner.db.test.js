// @vitest-environment node
// carehub_20270118_sale_guard_branch_owner on PGlite, applied over carehub_20260814_guard_sale_item_prices (as in
// production), with the live current_business_ids(), is_business_owner(), is_platform_admin() and the live
// "sales of own business" policy. Reported: "This sale is not authorized for your account." for an Owner selling at
// one of their branch locations, which RLS allows but the price guard refused.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const mig = (f) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + f, import.meta.url)), 'utf8')
const BEFORE = mig('carehub_20260814_guard_sale_item_prices.sql')
const MIGRATION = mig('carehub_20270118_sale_guard_branch_owner.sql')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const BRANCH = 'a0000000-0000-4000-8000-000000000002'
const DEEP = 'a0000000-0000-4000-8000-000000000003' // a branch of BRANCH, whose own depth limit is 0: outside current_business_ids()
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const P_MAIN = 'c0000000-0000-4000-8000-000000000001'
const P_BRANCH = 'c0000000-0000-4000-8000-000000000002'
const P_DEEP = 'c0000000-0000-4000-8000-000000000003'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng' // staff of the main business
const BRANCH_CASHIER = 'till@yaba.pharm.ng' // staff of the branch
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
const sale = (biz, product, price) => `insert into sales (business_id, items, total) values ('${biz}', to_jsonb('[{"id":"${product}","name":"Item","qty":1,"price":${price}}]'::text), ${price}) returning id`

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
    create table products (id uuid primary key, business_id uuid, name text, price numeric);
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, items jsonb, total numeric);
    insert into businesses (id, name, email, branch_depth_limit) values ('${BIZ}', 'Pharm', '${OWNER}', 1), ('${OTHER}', 'Other', '${STRANGER}', 3);
    insert into businesses (id, name, email, parent_business_id, branch_depth_limit) values ('${BRANCH}', 'Pharm Yaba', 'yaba@pharm.ng', '${BIZ}', 0), ('${DEEP}', 'Pharm Yaba 2', 'yaba2@pharm.ng', '${BRANCH}', 3);
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier'), ('${BRANCH}', 'Tunde', '${BRANCH_CASHIER}', 'Cashier');
    insert into products values ('${P_MAIN}', '${BIZ}', 'Paracetamol', 500), ('${P_BRANCH}', '${BRANCH}', 'Paracetamol', 500), ('${P_DEEP}', '${DEEP}', 'Paracetamol', 500);

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
  await db.exec(BEFORE)
})

describe('before the fix (reproduces the report)', () => {
  it('refuses the Owner at their own branch although RLS allows it', async () => {
    expect((await as(OWNER, sale(BRANCH, P_BRANCH, 500))).error).toMatch(/This sale is not authorized for your account/)
  })
  it('accepts the Owner at the main business (control)', async () => {
    expect((await as(OWNER, sale(BIZ, P_MAIN, 500))).rows).toHaveLength(1)
  })
})

describe('after carehub_20270118_sale_guard_branch_owner', () => {
  beforeAll(async () => { await db.exec(MIGRATION) })

  it('accepts the Owner at the main business and at a branch', async () => {
    expect((await as(OWNER, sale(BIZ, P_MAIN, 500))).rows).toHaveLength(1)
    expect((await as(OWNER, sale(BRANCH, P_BRANCH, 500))).rows).toHaveLength(1)
  })

  it('gives the Owner at a branch the Owner price permission', async () => {
    expect((await as(OWNER, sale(BRANCH, P_BRANCH, 450))).rows).toHaveLength(1)
  })

  it('honours a custom Owner role on the branch that withholds price edits', async () => {
    await db.exec(`insert into roles (business_id, name, permissions) values ('${BRANCH}', 'Owner', '{"canEditPrice": false}')`)
    try {
      expect((await as(OWNER, sale(BRANCH, P_BRANCH, 450))).error).toMatch(/Price override not allowed/)
      expect((await as(OWNER, sale(BRANCH, P_BRANCH, 500))).rows).toHaveLength(1)
    } finally {
      await db.exec(`delete from roles where business_id = '${BRANCH}'`)
    }
  })

  it('still refuses a branch beyond the depth limit (RLS and the guard agree)', async () => {
    expect((await as(OWNER, sale(DEEP, P_DEEP, 500))).error).toBeTruthy()
  })

  it('keeps staff to their own business', async () => {
    expect((await as(BRANCH_CASHIER, sale(BRANCH, P_BRANCH, 500))).rows).toHaveLength(1)
    expect((await as(CASHIER, sale(BIZ, P_MAIN, 500))).rows).toHaveLength(1)
    expect((await as(CASHIER, sale(BRANCH, P_BRANCH, 500))).error).toBeTruthy()
  })

  it('still refuses a price override by a Cashier', async () => {
    expect((await as(BRANCH_CASHIER, sale(BRANCH, P_BRANCH, 1))).error).toMatch(/Price override not allowed/)
  })

  it('still refuses a stranger', async () => {
    expect((await as(STRANGER, sale(BIZ, P_MAIN, 500))).error).toBeTruthy()
    expect((await as(STRANGER, sale(BRANCH, P_BRANCH, 500))).error).toBeTruthy()
  })
})
