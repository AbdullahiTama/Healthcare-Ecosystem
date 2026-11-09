// @vitest-environment node
// carehub_20270107_expense_payments on PGlite, with the live expenses columns, RLS policy and grants, and the live
// current_business_ids(), is_platform_admin() and expense_effective_date() (read 2026-11-09). Expenses gain a paid
// amount: paid, partially paid or unpaid, paid off later through record_expense_payment with an append-only history.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270107_expense_payments.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OLD_PAID = 'e0000000-0000-4000-8000-000000000001'
const OLD_BADDATE = 'e0000000-0000-4000-8000-000000000002'
const OWNER = 'owner@pharm.ng'
const CASHIER = 'cashier@pharm.ng'
const STRANGER = 'owner@other.ng'

let db
const claims = (email) => JSON.stringify({ sub: '10000000-0000-4000-8000-00000000000' + (email.length % 10), email, role: 'authenticated' })
// Runs statements as a signed-in user (anon when email is null) in a transaction that is rolled back; returns the
// last statement's rows or the error message.
async function as(email, statements) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', claims(email)])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    let res
    for (const s of [].concat(statements)) res = await db.query(s)
    return { rows: res.rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const insertExpense = (id, amount, extra = '') =>
  `insert into expenses (id, business_id, category, description, amount, date${extra ? ', ' + extra.split('=')[0] : ''}) values ('${id}', '${BIZ}', 'Rent', 'Shop', ${amount}, '2026-11-05'${extra ? ', ' + extra.split('=')[1] : ''})`
const NEW = 'e1000000-0000-4000-8000-000000000001'
const pay = (amount, method = 'Cash') => `select record_expense_payment('${NEW}', ${amount}, '${method}', null, 'part', 'Bisi') r`
const state = `select amount::float8 amount, amount_paid::float8 paid, (select count(*)::int from expense_payments where expense_id = '${NEW}') n,
  (select json_agg(json_build_object('kind', kind, 'amount', amount::float8, 'after', balance_after::float8, 'method', method) order by created_at, kind) from expense_payments where expense_id = '${NEW}') h
  from expenses where id = '${NEW}'`

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
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');

    -- Live definitions, verbatim (2026-11-09).
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
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    CREATE OR REPLACE FUNCTION public.expense_effective_date(p_date text, p_created_at timestamp without time zone) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
    begin
      if p_date ~ '^\\d{4}-\\d{2}-\\d{2}$' then
        return p_date::date;
      end if;
      return p_created_at::date;
    exception when others then
      return p_created_at::date;
    end;
    $function$;

    -- Live table shape, policy and grants (2026-11-09).
    create table expenses (id uuid primary key default gen_random_uuid(), business_id uuid, category text, description text, amount numeric default 0,
      date text, staff_name text, created_at timestamp default now(), recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    alter table expenses enable row level security;
    create policy "expenses of own business" on expenses for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    grant all on expenses to anon, authenticated, service_role;

    -- Expenses recorded before this change (one with a date the app could not parse).
    insert into expenses (id, business_id, category, amount, date, staff_name, created_at) values
      ('${OLD_PAID}', '${BIZ}', 'Transport', 2500, '2026-10-02', 'Ada', '2026-10-02 09:00'),
      ('${OLD_BADDATE}', '${BIZ}', 'Other', 900, '2026-02-30', '', '2026-03-01 09:00');
  `)
  await db.exec(MIGRATION)
})

describe('existing expenses', () => {
  it('are fully paid, with one "before payment history" row each (a bad date falls back to the day recorded)', async () => {
    const r = await db.query(`select e.id, e.amount_paid::float8 paid, p.kind, p.amount::float8 amount, p.balance_after::float8 after, p.paid_on::text paid_on
      from expenses e join expense_payments p on p.expense_id = e.id order by e.id`)
    expect(r.rows).toEqual([
      { id: OLD_PAID, paid: 2500, kind: 'before_history', amount: 2500, after: 0, paid_on: '2026-10-02' },
      { id: OLD_BADDATE, paid: 900, kind: 'before_history', amount: 900, after: 0, paid_on: '2026-03-01' },
    ])
  })

  it('re-running the migration changes nothing', async () => {
    await db.exec(MIGRATION)
    expect((await db.query('select count(*)::int n from expense_payments')).rows[0].n).toBe(2)
  })
})

describe('recording expenses', () => {
  it('without amount_paid (an older app build): paid in full, first history row "at_recording"', async () => {
    const r = await as(OWNER, [insertExpense(NEW, 10000), state])
    expect(r.rows[0]).toMatchObject({ paid: 10000, n: 1, h: [{ kind: 'at_recording', amount: 10000, after: 0, method: 'Cash' }] })
  })

  it('unpaid: no history yet; part paid: the deposit is the first row with its method', async () => {
    expect((await as(OWNER, [insertExpense(NEW, 10000, 'amount_paid=0'), state])).rows[0]).toMatchObject({ paid: 0, n: 0 })
    const r = await as(OWNER, [`insert into expenses (id, business_id, category, amount, date, amount_paid, payment_method) values ('${NEW}', '${BIZ}', 'Rent', 10000, '2026-11-05', 3000, 'Transfer')`, state])
    expect(r.rows[0]).toMatchObject({ paid: 3000, n: 1, h: [{ kind: 'at_recording', amount: 3000, after: 7000, method: 'Transfer' }] })
  })

  it('refuses paying more than the expense, or a negative amount, at recording', async () => {
    expect((await as(OWNER, insertExpense(NEW, 1000, 'amount_paid=1500'))).error).toMatch(/expenses_amount_paid_range/)
    expect((await as(OWNER, insertExpense(NEW, 1000, 'amount_paid=-1'))).error).toMatch(/expenses_amount_paid_range/)
  })
})

describe('record_expense_payment', () => {
  const unpaid = insertExpense(NEW, 10000, 'amount_paid=0')

  it('pays an unpaid expense in parts; each payment is a history row; over-payment is refused', async () => {
    const r = await as(OWNER, [unpaid, pay(4000), state])
    expect(r.rows[0]).toMatchObject({ paid: 4000, n: 1, h: [{ kind: 'payment', amount: 4000, after: 6000, method: 'Cash' }] })
    expect((await as(OWNER, [unpaid, pay(4000), pay(7000)])).error).toMatch(/more than the 6,000.00 still owed/)
    const full = await as(OWNER, [unpaid, pay(4000), pay(6000, 'Transfer'), state])
    expect(full.rows[0]).toMatchObject({ paid: 10000, n: 2 })
    expect((await as(OWNER, [unpaid, pay(10000), pay(1)])).error).toMatch(/already paid in full/)
  })

  it('returns the new totals', async () => {
    const r = await as(OWNER, [unpaid, pay(2500)])
    expect(r.rows[0].r).toMatchObject({ amount_paid: 2500, balance: 7500 })
  })

  it('a staff member of the business may record a payment', async () => {
    expect((await as(CASHIER, [unpaid, pay(1000), state])).rows[0]).toMatchObject({ paid: 1000 })
  })

  it('refuses bad input', async () => {
    expect((await as(OWNER, [unpaid, pay(0)])).error).toMatch(/greater than zero/)
    expect((await as(OWNER, [unpaid, pay(100, 'Bitcoin')])).error).toMatch(/Choose how it was paid/)
    expect((await as(OWNER, [unpaid, `select record_expense_payment('${NEW}', 100, 'Cash', current_date + 5)`])).error).toMatch(/future/)
  })

  it('another business, a missing expense and anon are refused without revealing anything', async () => {
    await db.exec(`insert into expenses (id, business_id, category, amount, date, amount_paid) values ('${NEW}', '${BIZ}', 'Rent', 10000, '2026-11-05', 0)`)
    try {
      expect((await as(STRANGER, pay(100))).error).toMatch(/not found/)
      expect((await as(OWNER, `select record_expense_payment(gen_random_uuid(), 100)`)).error).toMatch(/not found/)
      expect((await as(null, pay(100))).error).toMatch(/permission denied/)
      expect((await as(STRANGER, `select count(*)::int n from expense_payments`)).rows[0].n).toBe(0)
      expect((await as(null, `select count(*) from expense_payments`)).error).toMatch(/permission denied/)
    } finally {
      await db.exec(`delete from expenses where id = '${NEW}'`)
    }
  })
})

describe('the paid amount moves only through record_expense_payment', () => {
  const unpaid = insertExpense(NEW, 10000, 'amount_paid=0')
  it('a direct change of amount_paid is refused, for the Owner too', async () => {
    expect((await as(OWNER, [unpaid, `update expenses set amount_paid = 10000 where id = '${NEW}'`])).error).toMatch(/cannot be edited directly/)
  })
  it('the amount cannot drop below what has been paid; other edits still work', async () => {
    expect((await as(OWNER, [unpaid, pay(4000), `update expenses set amount = 3000 where id = '${NEW}'`])).error).toMatch(/less than what has already been paid/)
    const ok = await as(OWNER, [unpaid, pay(4000), `update expenses set description = 'Shop rent, Nov' where id = '${NEW}' returning description`])
    expect(ok.rows[0].description).toBe('Shop rent, Nov')
  })
  it('clients cannot write the history directly', async () => {
    const ins = `insert into expense_payments (business_id, expense_id, amount, balance_after) values ('${BIZ}', '${OLD_PAID}', 1, 0)`
    expect((await as(OWNER, ins)).error).toMatch(/permission denied/)
    expect((await as(OWNER, `delete from expense_payments`)).error).toMatch(/permission denied/)
  })
  it('deleting an expense removes its history with it', async () => {
    const r = await as(OWNER, [unpaid, pay(1000), `delete from expenses where id = '${NEW}'`, `select count(*)::int n from expense_payments where expense_id = '${NEW}'`])
    expect(r.rows[0].n).toBe(0)
  })
})
