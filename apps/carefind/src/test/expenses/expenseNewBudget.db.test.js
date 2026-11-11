// @vitest-environment node
// carehub_20270116_expense_new_budget on PGlite, applied over carehub_20270103_expense_budgets (as in production), with
// the live current_business_ids(), is_business_owner(), is_platform_admin() and expense_effective_date().
// "Set new budget": once a budget is used up the Owner starts a new one from a day in the month; the old one is kept in
// expense_budget_history with what was spent against it, and spending against the new one counts from its start.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const mig = (f) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + f, import.meta.url)), 'utf8')
const BEFORE = mig('carehub_20270103_expense_budgets.sql')
const MIGRATION = mig('carehub_20270116_expense_new_budget.sql')

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
    -- Live expenses columns (2026-11-11) and expense_effective_date(), verbatim.
    create table expenses (id uuid primary key default gen_random_uuid(), business_id uuid, category text, description text, amount numeric default 0,
      date text, staff_name text, created_at timestamp without time zone default now(), recorded_by uuid, recorded_by_staff_id uuid,
      recorded_by_name text, amount_paid numeric, payment_method text);
    CREATE OR REPLACE FUNCTION public.expense_effective_date(p_date text, p_created_at timestamp without time zone)
     RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
    begin
      if p_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then
        return p_date::date;
      end if;
      return p_created_at::date;
    exception when others then
      return p_created_at::date;
    end;
    $function$;
  `)
  await db.exec(BEFORE)
  // Production state before this migration: a budget set for October, carried into November.
  await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-10', 50000)`)
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-runs cleanly
  // November spending: 52,000 by the 17th (over the 50,000 budget), 4,000 from the 18th.
  await db.exec(`insert into expenses (business_id, category, amount, date) values
    ('${BIZ}', 'Rent', 40000, '2026-11-02'), ('${BIZ}', 'Fuel', 12000, '2026-11-17'), ('${BIZ}', 'Fuel', 4000, '2026-11-18'),
    ('${BIZ}', 'Rent', 9999, '2026-10-30'), ('${OTHER}', 'Rent', 7777, '2026-11-05')`)
})

const budget = (biz, month) => `select month, amount::float8 amount, starts_on::text starts_on from expense_budgets where business_id = '${biz}' and month <= '${month}' order by month desc limit 1`
const history = (biz) => `select month, amount::float8 amount, starts_on::text starts_on, ended_on::text ended_on, spent::float8 spent, reason, new_amount::float8 new_amount, closed_by is not null closed from expense_budget_history where business_id = '${biz}' order by closed_at, amount`

describe('existing budgets are unchanged', () => {
  it('the October budget still reads the same, from the 1st, carried into November', async () => {
    expect((await as(CASHIER, budget(BIZ, '2026-11'))).rows).toEqual([{ month: '2026-10', amount: 50000, starts_on: null }])
  })
})

describe('set new budget', () => {
  it('only the Owner can; staff, managers, other businesses and anon cannot', async () => {
    for (const who of [CASHIER, MANAGER, STRANGER]) {
      expect((await as(who, `select start_new_expense_budget('${BIZ}', '2026-11', 30000, '2026-11-18')`)).error).toMatch(/Only the Owner/)
    }
    expect((await as(null, `select start_new_expense_budget('${BIZ}', '2026-11', 30000, '2026-11-18')`)).error).toMatch(/permission denied/)
  })

  it('refuses a bad amount, a start outside the month, or a start not after the current budget', async () => {
    expect((await as(OWNER, `select start_new_expense_budget('${BIZ}', '2026-11', 0, '2026-11-18')`)).error).toMatch(/above 0/)
    expect((await as(OWNER, `select start_new_expense_budget('${BIZ}', '2026-11', 100, '2026-12-01')`)).error).toMatch(/must start within 2026-11/)
    expect((await as(OWNER, `select start_new_expense_budget('${BIZ}', '2026-11', 100, '2026-11-01')`)).error).toMatch(/after the current one \(from 2026-11-01\).*Edit budget/)
    expect((await as(OWNER, `select start_new_expense_budget('${BIZ}', '2026-08', 100, '2026-08-10')`)).error).toMatch(/no budget for 2026-08 to replace/)
  })

  it('closes the carried-over budget on the 17th with what was spent, and starts the new one on the 18th', async () => {
    const r = await as(OWNER, `select month, amount::float8 amount, starts_on::text starts_on from start_new_expense_budget('${BIZ}', '2026-11', 30000, '2026-11-18')`)
    expect(r.error).toBeUndefined()
    expect(r.rows).toEqual([{ month: '2026-11', amount: 30000, starts_on: '2026-11-18' }])
  })

  it('committed: the old budget is kept (spent 52,000 of 50,000), October untouched, other businesses not counted', async () => {
    await commitAs(OWNER, `select start_new_expense_budget('${BIZ}', '2026-11', 30000, '2026-11-18')`)
    expect((await as(CASHIER, history(BIZ))).rows).toEqual([
      { month: '2026-11', amount: 50000, starts_on: '2026-11-01', ended_on: '2026-11-17', spent: 52000, reason: 'replaced', new_amount: 30000, closed: true },
    ])
    expect((await as(CASHIER, budget(BIZ, '2026-11'))).rows).toEqual([{ month: '2026-11', amount: 30000, starts_on: '2026-11-18' }])
    expect((await as(CASHIER, budget(BIZ, '2026-10'))).rows).toEqual([{ month: '2026-10', amount: 50000, starts_on: null }])
  })

  it('the new budget carries into December, counted from the 1st there', async () => {
    expect((await as(OWNER, budget(BIZ, '2026-12'))).rows).toEqual([{ month: '2026-11', amount: 30000, starts_on: '2026-11-18' }])
  })

  it('a second new budget in the month closes the first new one from its own start', async () => {
    await commitAs(OWNER, `select start_new_expense_budget('${BIZ}', '2026-11', 10000, '2026-11-25')`)
    const rows = (await as(OWNER, history(BIZ))).rows
    expect(rows[1]).toEqual({ month: '2026-11', amount: 30000, starts_on: '2026-11-18', ended_on: '2026-11-24', spent: 4000, reason: 'replaced', new_amount: 10000, closed: true })
  })

  it('Edit keeps the new budget\'s start and records the amount it replaced', async () => {
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-11', 12000)`)
    expect((await as(OWNER, budget(BIZ, '2026-11'))).rows).toEqual([{ month: '2026-11', amount: 12000, starts_on: '2026-11-25' }])
    const last = (await as(OWNER, history(BIZ))).rows.at(-1)
    expect(last).toEqual({ month: '2026-11', amount: 10000, starts_on: '2026-11-25', ended_on: null, spent: null, reason: 'edited', new_amount: 12000, closed: true })
    // Saving the same amount again records nothing.
    await commitAs(OWNER, `select set_expense_budget('${BIZ}', '2026-11', 12000)`)
    expect((await as(OWNER, history(BIZ))).rows).toHaveLength(3)
  })
})

describe('history is protected', () => {
  it('another business and anon cannot read it', async () => {
    expect((await as(STRANGER, history(BIZ))).rows).toEqual([])
    expect((await as(null, history(BIZ))).error).toMatch(/permission denied/)
  })

  it('no app user can write or change it, or set starts_on directly', async () => {
    for (const sql of [
      `insert into expense_budget_history (business_id, month, amount, starts_on, reason, new_amount, closed_by) values ('${BIZ}', '2026-11', 1, '2026-11-01', 'edited', 1, gen_random_uuid())`,
      `update expense_budget_history set spent = 0`,
      `delete from expense_budget_history`,
      `update expense_budgets set starts_on = '2026-11-02'`,
    ]) {
      expect((await as(OWNER, sql)).error).toMatch(/permission denied/)
    }
  })

  it('a starts_on outside its month is refused by the table itself', async () => {
    await expect(db.exec(`insert into expense_budgets (business_id, month, amount, starts_on) values ('${BIZ}', '2027-01', 1, '2027-02-01')`)).rejects.toThrow(/expense_budgets_starts_in_month/)
  })
})
