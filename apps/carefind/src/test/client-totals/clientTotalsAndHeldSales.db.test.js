// @vitest-environment node
// carehub_20261220_client_totals_and_held_sales on PGlite, with the live shapes of clients and sales and the live
// sales_close_resumed_hold trigger (carehub_20261216).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261220_client_totals_and_held_sales.sql', import.meta.url)), 'utf8')

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000001'
const MUSA = 'c0000000-0000-4000-8000-000000000001'
const ADA = 'c0000000-0000-4000-8000-000000000002'
const ADA2 = 'c0000000-0000-4000-8000-000000000003' // a second "Ada" in the same business
const MUSA_B = 'c0000000-0000-4000-8000-000000000004' // a "Musa" in another business
let db
const one = async (s, p) => (await db.query(s, p)).rows[0]
const client = (id) => one('select visit_count::int v, total_spend::numeric::float8 s from clients where id = $1', [id])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table businesses (id uuid primary key);
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text,
      total_spend numeric, visit_count integer, created_at timestamp default now());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text, client_id uuid, client_name text,
      items jsonb, subtotal numeric, discount numeric, total numeric, payment_method text, amount_paid numeric, balance numeric,
      is_credit boolean default false, is_on_hold boolean default false, status text, refunded_amount numeric default 0,
      resumed_from uuid references sales(id) on delete set null, deleted_at timestamptz, created_at timestamp default now());
    insert into businesses values ('${A}'), ('${B}');
    insert into clients (id, business_id, full_name, total_spend, visit_count) values
      ('${MUSA}', '${A}', 'Musa', 0, 0), ('${ADA}', '${A}', 'Ada', 0, 0), ('${ADA2}', '${A}', 'ada ', 0, 0), ('${MUSA_B}', '${B}', 'Musa', 0, 0);
    insert into sales (business_id, txn_no, client_id, client_name, total, amount_paid, balance, payment_method, status, is_on_hold, refunded_amount, deleted_at) values
      ('${A}', 'TXN1', '${MUSA}', 'Musa', 1000, 1000, 0, 'Cash', null, false, 0, null),
      ('${A}', 'TXN2', '${MUSA}', 'Musa', 2000, 2000, 0, 'Cash', 'completed', false, 500, null),
      ('${A}', 'TXN3', '${MUSA}', 'Musa', 9000, 9000, 0, 'Cash', 'deleted', false, 0, now()),
      ('${A}', 'TXN4', null, '  musa ', 300, 300, 0, 'Transfer', null, false, 0, null),
      ('${A}', 'TXN5', null, 'Ada', 400, 400, 0, 'Cash', null, false, 0, null),
      ('${A}', 'TXN6', null, 'Walk-in', 50, 50, 0, 'Cash', null, false, 0, null),
      ('${A}', 'HLD1', null, 'Musa', 700, 0, 700, 'On Hold', 'completed', false, 0, null),
      ('${A}', 'HLD2', null, 'Walk-in', 800, 0, 800, 'On Hold', null, true, 0, null);
    -- a held row the till already charged (converted, still flagged on hold and owing)
    insert into sales (id, business_id, txn_no, client_name, total, amount_paid, balance, payment_method, status, is_on_hold)
      values ('d0000000-0000-4000-8000-000000000001', '${A}', 'HLD3', 'Walk-in', 600, 0, 600, 'On Hold', 'converted', true);
  `)
  await db.exec(MIGRATION)
  await db.exec('create trigger sales_close_resumed_hold after insert on sales for each row execute function sales_close_resumed_hold()')
})

describe('client totals backfill', () => {
  it('counts completed sales only and subtracts refunds', async () => {
    // TXN1 1000 + TXN2 (2000 - 500 refunded) + TXN4 300 linked by name; TXN3 deleted and HLD1 retired do not count
    expect(await client(MUSA)).toEqual({ v: 3, s: 2800 })
  })

  it('links a named sale only to a unique client of the same business; never Walk-in or an ambiguous name', async () => {
    expect((await one(`select client_id from sales where txn_no = 'TXN4'`)).client_id).toBe(MUSA)
    expect((await one(`select client_id from sales where txn_no = 'TXN5'`)).client_id).toBeNull()
    expect((await one(`select client_id from sales where txn_no = 'TXN6'`)).client_id).toBeNull()
    expect(await client(ADA)).toEqual({ v: 0, s: 0 })
    expect(await client(MUSA_B)).toEqual({ v: 0, s: 0 })
  })
})

describe('client totals stay current', () => {
  it('a new sale, a refund, a deletion and a move to another client all update the totals', async () => {
    await db.query(`insert into sales (business_id, txn_no, client_id, client_name, total, amount_paid, balance, payment_method) values ('${A}', 'TXN7', '${ADA}', 'Ada', 250, 250, 0, 'Cash')`)
    expect(await client(ADA)).toEqual({ v: 1, s: 250 })
    await db.query(`update sales set refunded_amount = 50 where txn_no = 'TXN7'`)
    expect(await client(ADA)).toEqual({ v: 1, s: 200 })
    await db.query(`update sales set client_id = '${MUSA}' where txn_no = 'TXN7'`)
    expect(await client(ADA)).toEqual({ v: 0, s: 0 })
    expect(await client(MUSA)).toEqual({ v: 4, s: 3000 })
    await db.query(`update sales set status = 'deleted', deleted_at = now() where txn_no = 'TXN7'`)
    expect(await client(MUSA)).toEqual({ v: 3, s: 2800 })
    await db.query(`delete from sales where txn_no = 'TXN1'`)
    expect(await client(MUSA)).toEqual({ v: 2, s: 1800 })
  })

  it('a held sale is not a visit until it is charged', async () => {
    await db.query(`insert into sales (business_id, txn_no, client_id, client_name, total, amount_paid, balance, payment_method, is_on_hold) values ('${A}', 'HLD9', '${ADA}', 'Ada', 900, 0, 900, 'On Hold', true)`)
    expect(await client(ADA)).toEqual({ v: 0, s: 0 })
  })
})

describe('held sales', () => {
  it('charging a held sale closes it: no longer on hold, nothing owing, and the paid sale carries the payment', async () => {
    const held = await one(`select id from sales where txn_no = 'HLD2'`)
    await db.query(`insert into sales (business_id, txn_no, client_name, total, amount_paid, balance, payment_method, resumed_from) values ('${A}', 'TXN8', 'Walk-in', 800, 800, 0, 'Transfer', $1)`, [held.id])
    expect(await one(`select status, is_on_hold, balance::int from sales where txn_no = 'HLD2'`)).toEqual({ status: 'converted', is_on_hold: false, balance: 0 })
    expect(await one(`select status, is_on_hold, amount_paid::int, balance::int from sales where txn_no = 'TXN8'`)).toEqual({ status: null, is_on_hold: false, amount_paid: 800, balance: 0 })
  })

  it('a held sale cannot be charged twice', async () => {
    const held = await one(`select id from sales where txn_no = 'HLD2'`)
    await expect(db.query(`insert into sales (business_id, txn_no, total, amount_paid, balance, payment_method, resumed_from) values ('${A}', 'TXN9', 800, 800, 0, 'Cash', $1)`, [held.id]))
      .rejects.toThrow(/already completed/)
  })

  it('held rows already charged are closed', async () => {
    expect(await one(`select status, is_on_hold, balance::int from sales where txn_no = 'HLD3'`)).toEqual({ status: 'converted', is_on_hold: false, balance: 0 })
  })

  it('legacy held rows wrongly marked completed with nothing paid are retired', async () => {
    expect((await one(`select status from sales where txn_no = 'HLD1'`)).status).toBe('resumed')
    // a real completed sale is untouched
    expect((await one(`select status from sales where txn_no = 'TXN2'`)).status).toBe('completed')
  })

  it('re-running the migration changes nothing', async () => {
    const snap = async () => (await db.query('select txn_no, client_id, status, is_on_hold, balance::text from sales order by txn_no')).rows
    const clients = async () => (await db.query('select id, visit_count, total_spend::text from clients order by id')).rows
    const before = [await snap(), await clients()]
    await db.exec(MIGRATION)
    expect([await snap(), await clients()]).toEqual(before)
  })

  it('the functions cannot be called by app users', async () => {
    const r = await one(`select has_function_privilege('authenticated', 'public.refresh_client_totals(uuid[])', 'execute') a,
      has_function_privilege('authenticated', 'public.sales_refresh_client_totals()', 'execute') b`)
    expect(r).toEqual({ a: false, b: false })
  })
})
