// @vitest-environment node
// carehub_20270103_expense_budgets on PGlite, with the live current_business_ids(), is_business_owner() and
// is_platform_admin() (pg_get_functiondef, 2026-11-04). Budgets used to live only in the browser; these tests pin
// that they are now stored, readable by the business's members only, written by its Owner only, and that a month
// without its own budget reads the latest earlier one (the query the app runs).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270103_expense_budgets.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const BRANCH = 'a0000000-0000-4000-8000-000000000002'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng'
const MANAGER = 'manager@pharm.ng'
const STRANGER = 'owner@other.ng'

let db
// Runs `sql` as a signed-in user (or anon when email is null) inside a transaction that is rolled back.
async function as(email, sql, params) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-00000000000' + email.length % 10, email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const res = await db.query(sql, params)
    return { rows: res.rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
// The same, committed (to set up data as a user would).
async function commitAs(email, sql) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.exec('set role authenticated')
  try { return (await db.query(sql)).rows } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`) }
}
// What the app reads for a month (expenseRepository.getBudget).
const effective = (biz, month) => `select month, amount::float8 amount from expense_budgets where business_id = '${biz}' and month <= '${month}' order by month desc limit 1`

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
    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', '${OWNER}'), ('${OTHER}', 'Other', '${STRANGER}');
    insert into businesses (id, name, email, parent_business_id) values ('${BRANCH}', 'Pharm Yaba', 'yaba@pharm.ng', '${BIZ}');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier'), ('${BIZ}', 'Musa', '${MANAGER}', 'Branch Manager');

    -- Live definitions, verbatim (2026-11-04).
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
    -- Live grants on these helpers: is_business_owner is not executable by app users.
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
  `)
  await db.exec(MIGRATION)
})

describe('setting a budget', () => {
  it('the Owner sets a budget, and it is stored with who set it', async () => {
    const res = await as(OWNER, `select business_id, month, amount::float8 amount, set_by is not null as stamped from set_expense_budget('${BIZ}', '2026-10', 50000)`)
    expect(res.error).toBeUndefined()
    expect(res.rows).toEqual([{ business_id: BIZ, month: '2026-10', amount: 50000, stamped: true }])
  })

  it('setting it again for the same month replaces it (one row per month)', async () => {
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-09', 40000)`)
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-09', 45000)`)
    expect((await db.query(`select amount::float8 amount from expense_budgets where business_id = '${BIZ}' and month = '2026-09'`)).rows).toEqual([{ amount: 45000 }])
  })

  it('staff, managers, other businesses and anon cannot set one', async () => {
    for (const who of [CASHIER, MANAGER, STRANGER]) {
      expect((await as(who, `select set_expense_budget('${BIZ}', '2026-10', 1)`)).error).toMatch(/Only the Owner can set the expense budget/)
    }
    expect((await as(null, `select set_expense_budget('${BIZ}', '2026-10', 1)`)).error).toMatch(/permission denied/)
  })

  it('refuses a bad month or amount', async () => {
    expect((await as(OWNER, `select set_expense_budget('${BIZ}', '2026-13', 1)`)).error).toMatch(/must look like 2026-11/)
    expect((await as(OWNER, `select set_expense_budget('${BIZ}', 'November', 1)`)).error).toMatch(/must look like 2026-11/)
    expect((await as(OWNER, `select set_expense_budget('${BIZ}', '2026-11', -5)`)).error).toMatch(/0 or more/)
    expect((await as(OWNER, `select set_expense_budget('${BIZ}', '2026-11', null)`)).error).toMatch(/0 or more/)
  })

  it('no app user can write the table directly', async () => {
    for (const sql of [
      `insert into expense_budgets (business_id, month, amount) values ('${BIZ}', '2026-12', 1)`,
      `update expense_budgets set amount = 1 where business_id = '${BIZ}'`,
      `delete from expense_budgets where business_id = '${BIZ}'`,
    ]) {
      expect((await as(OWNER, sql)).error).toMatch(/permission denied/)
      expect((await as(CASHIER, sql)).error).toMatch(/permission denied/)
    }
  })
})

describe('reading a budget', () => {
  beforeAll(async () => {
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-10', 50000)`)
    await commitAs(STRANGER, `select set_expense_budget('${OTHER}', '2026-10', 9999)`)
  })

  it('every member of the business sees it; another business and anon do not', async () => {
    expect((await as(OWNER, effective(BIZ, '2026-10'))).rows).toEqual([{ month: '2026-10', amount: 50000 }])
    expect((await as(CASHIER, effective(BIZ, '2026-10'))).rows).toEqual([{ month: '2026-10', amount: 50000 }])
    expect((await as(STRANGER, effective(BIZ, '2026-10'))).rows).toEqual([])
    expect((await as(CASHIER, effective(OTHER, '2026-10'))).rows).toEqual([])
    expect((await as(null, effective(BIZ, '2026-10'))).error).toMatch(/permission denied/)
  })

  it('a new month without its own budget reads the latest earlier one (the reported disappearance)', async () => {
    expect((await as(CASHIER, effective(BIZ, '2026-11'))).rows).toEqual([{ month: '2026-10', amount: 50000 }])
    expect((await as(CASHIER, effective(BIZ, '2027-03'))).rows).toEqual([{ month: '2026-10', amount: 50000 }])
  })

  it('a month before any budget has none', async () => {
    expect((await as(OWNER, effective(BIZ, '2026-08'))).rows).toEqual([])
  })

  it('a budget of 0 stops the carry-over from that month on', async () => {
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2027-01', 0)`)
    expect((await as(OWNER, effective(BIZ, '2027-02'))).rows).toEqual([{ month: '2027-01', amount: 0 }])
    expect((await as(OWNER, effective(BIZ, '2026-12'))).rows).toEqual([{ month: '2026-10', amount: 50000 }])
  })
})
