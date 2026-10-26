// @vitest-environment node
// Partial payments with history (carehub_20261211_partial_payments): credit-sale collections and supplier payments.
// Runs the real migration on PGlite with the live column types and RLS shape of sales / purchases / debts.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const MIGRATION = read('../../../../../supabase/migrations/carehub_20261211_partial_payments.sql')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UID_A = '00000000-0000-4000-8000-00000000000a'
const UID_B = '00000000-0000-4000-8000-00000000000b'
let db

async function as(email, uid, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: uid, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
async function asAnon(fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })])
  await db.query('set role anon')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (s, p) => (await db.query(s, p)).rows[0]
const n = (v) => Number(v)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','anon') $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, email text, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, status text default 'active');
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      select id from businesses where lower(email)=lower(auth.email()) union select business_id from staff where lower(email)=lower(auth.email()) and status='active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email)=lower(auth.email())), false) $$;

    -- Column types as on the LIVE tables (read 2026-10-26).
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text not null, client_name text default 'Walk-in',
      client_id uuid, items jsonb default '[]', subtotal numeric default 0, discount numeric default 0, total numeric default 0,
      payment_method text default 'Cash', payment_split jsonb, amount_paid numeric default 0, balance numeric default 0,
      is_credit boolean default false, is_on_hold boolean default false, staff_name text, created_at timestamp without time zone default now(),
      notes text, status text, dispense_ref text);
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, supplier_name text not null, product_name text,
      quantity integer default 0, cost_price numeric default 0, total_cost numeric default 0, amount_paid numeric default 0, balance numeric default 0,
      supply_date text, due_date text, status text default 'pending', notes text, created_at timestamp without time zone default now(),
      selling_price numeric default 0, expiry date, batch text);
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, direction text not null, party_name text not null,
      amount numeric default 0, amount_paid numeric default 0, balance numeric default 0, due_date text, status text default 'pending',
      description text, created_at timestamp without time zone default now(), source text default 'manual', source_ref text default '', client_id uuid);
    do $$ declare t text; begin foreach t in array array['sales','purchases','debts'] loop
      execute format('alter table %I enable row level security', t);
      execute format('create policy "%s of own business" on %I for all to public using (business_id in (select current_business_ids()) or is_platform_admin()) with check (business_id in (select current_business_ids()) or is_platform_admin())', t, t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
    end loop; end $$;
    insert into businesses (id,email) values ('${A}','a@x.com'), ('${B}','b@x.com');
    insert into staff (business_id,email) values ('${A}','cashier@x.com');

    -- Existing data, recorded before the migration: the backfill must turn these into history rows.
    insert into sales (business_id, txn_no, client_name, total, amount_paid, balance, is_credit, payment_method) values
      ('${A}','OLD-1','Mama Ngozi',5000,1000,4000,true,'Credit'),
      ('${A}','OLD-CASH','Walk-in',800,800,0,false,'Cash');
    insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance, status) values
      ('${A}','Emzor Ltd',10000,4000,6000,'pending');
  `)
  await db.exec(MIGRATION)
})

describe('backfill and first-payment history', () => {
  it('turns money paid before the migration into one history row per credit sale / purchase, not cash sales', async () => {
    const rows = await db.query(`select txn_no, amount, kind from sale_payments order by txn_no`)
    expect(rows.rows.map((r) => [r.txn_no, n(r.amount), r.kind])).toEqual([['OLD-1', 1000, 'before_history']])
    const p = await one(`select supplier_name, amount, kind, supplier_key from purchase_payments`)
    expect([p.supplier_name, n(p.amount), p.kind, p.supplier_key]).toEqual(['Emzor Ltd', 4000, 'before_history', 'emzor ltd'])
  })

  it('re-running the migration does not duplicate history', async () => {
    await db.exec(MIGRATION)
    expect(n((await one('select count(*) c from sale_payments')).c)).toBe(1)
    expect(n((await one('select count(*) c from purchase_payments')).c)).toBe(1)
  })

  it('a new credit sale with a deposit, and a new purchase paid in part, start their history', async () => {
    await as('cashier@x.com', UID_A, async (q) => {
      await q(`insert into sales (business_id, txn_no, client_name, total, amount_paid, balance, is_credit, payment_method)
               values ('${A}','CR-2','Baba Tunde',3000,500,2500,true,'Cash')`)
      await q(`insert into sales (business_id, txn_no, total, amount_paid, balance) values ('${A}','CASH-2',700,700,0)`)
      await q(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance) values ('${A}','  emzor ltd ',2000,500,1500)`)
    })
    const s = await one(`select amount, kind, method, balance_after from sale_payments where txn_no='CR-2'`)
    expect([n(s.amount), s.kind, s.method, n(s.balance_after)]).toEqual([500, 'at_sale', 'Cash', 2500])
    expect(n((await one(`select count(*) c from sale_payments where txn_no='CASH-2'`)).c)).toBe(0)
    expect((await one(`select kind from purchase_payments where amount=500`)).kind).toBe('at_purchase')
  })
})

describe('history never blocks a sale or purchase', () => {
  it('a sale with an over-long staff name, or a huge amount, is still recorded', async () => {
    await as('cashier@x.com', UID_A, async (q) => {
      await q(`insert into sales (business_id, txn_no, total, amount_paid, balance, is_credit, staff_name) values ('${A}','LONG-1',100,10,90,true,$1)`, ['x'.repeat(500)])
      await q(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance) values ('${A}','Big', 1e15, 1e14, 9e14)`)
    })
    expect(n((await one(`select count(*) c from sales where txn_no='LONG-1'`)).c)).toBe(1)
    expect((await one(`select length(staff_name) l from sale_payments where txn_no='LONG-1'`)).l).toBe(120)
    expect(n((await one(`select count(*) c from purchases where supplier_name='Big'`)).c)).toBe(1)
  })
})

describe('record_sale_payment', () => {
  let saleId
  beforeAll(async () => {
    saleId = (await one(`insert into sales (business_id, txn_no, client_name, total, amount_paid, balance, is_credit, payment_method)
      values ('${A}','CR-9','Iya Bisi',10000,0,10000,true,'Credit') returning id`)).id
    await db.query(`insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status, source, source_ref)
      values ('${A}','owed_to_us','Iya Bisi',10000,0,10000,'pending','credit_sale','CR-9')`)
  })

  it('a partial payment updates the sale, the linked debt and the history together', async () => {
    const r = await as('cashier@x.com', UID_A, (q) => q(`select record_sale_payment($1, 2500.004, 'Transfer', ' first part ', 'Ada') r`, [saleId]))
    expect(r[0].r).toMatchObject({ amount: 2500, amount_paid: 2500, balance: 7500 })
    const sale = await one('select amount_paid, balance, is_credit from sales where id=$1', [saleId])
    expect([n(sale.amount_paid), n(sale.balance), sale.is_credit]).toEqual([2500, 7500, true])
    const debt = await one(`select amount_paid, balance, status from debts where source_ref='CR-9'`)
    expect([n(debt.amount_paid), n(debt.balance), debt.status]).toEqual([2500, 7500, 'pending'])
    const h = await one('select amount, method, kind, note, balance_after, recorded_by, staff_name from sale_payments where sale_id=$1', [saleId])
    expect([n(h.amount), h.method, h.kind, h.note, n(h.balance_after), h.recorded_by, h.staff_name]).toEqual([2500, 'Transfer', 'payment', 'first part', 7500, UID_A, 'Ada'])
  })

  it('refuses more than the balance, zero, negative, an unknown method; nothing changes', async () => {
    await as('cashier@x.com', UID_A, async (q) => {
      await expect(q('select record_sale_payment($1, 7500.01)', [saleId])).rejects.toThrow(/more than the balance of 7,500.00/)
      await expect(q('select record_sale_payment($1, 0)', [saleId])).rejects.toThrow(/greater than zero/)
      await expect(q('select record_sale_payment($1, -5)', [saleId])).rejects.toThrow(/greater than zero/)
      await expect(q(`select record_sale_payment($1, 10, 'Bitcoin')`, [saleId])).rejects.toThrow(/how the customer paid/)
    })
    expect(n((await one('select balance from sales where id=$1', [saleId])).balance)).toBe(7500)
  })

  it('the final payment clears the sale and marks the debt paid', async () => {
    const r = await as('a@x.com', UID_A, (q) => q(`select record_sale_payment($1, 7500) r`, [saleId]))
    expect(r[0].r.balance).toBe(0)
    const sale = await one('select balance, is_credit from sales where id=$1', [saleId])
    expect([n(sale.balance), sale.is_credit]).toEqual([0, false])
    expect((await one(`select status from debts where source_ref='CR-9'`)).status).toBe('paid')
    await as('a@x.com', UID_A, async (q) => {
      await expect(q('select record_sale_payment($1, 1)', [saleId])).rejects.toThrow(/nothing left to pay/)
    })
    const hist = await db.query('select sum(amount) s from sale_payments where sale_id=$1', [saleId])
    expect(n(hist.rows[0].s)).toBe(10000)
  })

  it('a held sale is refused', async () => {
    const held = (await one(`insert into sales (business_id, txn_no, total, balance, is_credit, is_on_hold) values ('${A}','HOLD-1',100,100,true,true) returning id`)).id
    await as('a@x.com', UID_A, async (q) => {
      await expect(q('select record_sale_payment($1, 10)', [held])).rejects.toThrow(/on hold/)
    })
  })

  it("another business's member, and anon, cannot pay it or learn it exists", async () => {
    const other = (await one(`insert into sales (business_id, txn_no, total, balance, is_credit) values ('${A}','CR-X',100,100,true) returning id`)).id
    await as('b@x.com', UID_B, async (q) => {
      await expect(q('select record_sale_payment($1, 10)', [other])).rejects.toThrow(/Sale not found/)
      await expect(q(`select record_sale_payment('00000000-0000-4000-8000-000000000999', 10)`)).rejects.toThrow(/Sale not found/)
    })
    await asAnon(async (q) => {
      await expect(q('select record_sale_payment($1, 10)', [other])).rejects.toThrow(/permission denied/)
    })
    expect(n((await one('select balance from sales where id=$1', [other])).balance)).toBe(100)
  })
})

describe('record_purchase_payment', () => {
  let purchaseId
  beforeAll(async () => {
    purchaseId = (await one(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance, status)
      values ('${A}','Fidson Healthcare',8000,0,8000,'pending') returning id`)).id
    await db.query(`insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status, source, source_ref)
      values ('${A}','we_owe','Fidson Healthcare',8000,0,8000,'pending','purchase',$1)`, [purchaseId])
  })

  it('a partial payment marks the purchase partly paid and moves the linked debt', async () => {
    const r = await as('cashier@x.com', UID_A, (q) => q(`select record_purchase_payment($1, 3000, 'Cheque', '2026-10-20', 'chq 0012') r`, [purchaseId]))
    expect(r[0].r).toMatchObject({ amount_paid: 3000, balance: 5000, status: 'partial' })
    const debt = await one(`select amount_paid, balance, status from debts where source='purchase'`)
    expect([n(debt.amount_paid), n(debt.balance), debt.status]).toEqual([3000, 5000, 'pending'])
    const h = await one('select method, paid_on::text d, note, kind from purchase_payments where purchase_id=$1', [purchaseId])
    expect([h.method, h.d, h.note, h.kind]).toEqual(['Cheque', '2026-10-20', 'chq 0012', 'payment'])
  })

  it('refuses a future date and an overpayment', async () => {
    await as('a@x.com', UID_A, async (q) => {
      await expect(q(`select record_purchase_payment($1, 10, 'Cash', current_date + 5)`, [purchaseId])).rejects.toThrow(/future/)
      await expect(q('select record_purchase_payment($1, 5000.01)', [purchaseId])).rejects.toThrow(/more than the balance/)
    })
  })

  it('the rest pays it off', async () => {
    const r = await as('a@x.com', UID_A, (q) => q('select record_purchase_payment($1, 5000) r', [purchaseId]))
    expect(r[0].r).toMatchObject({ balance: 0, status: 'paid' })
    expect((await one(`select status from debts where source='purchase'`)).status).toBe('paid')
    await as('a@x.com', UID_A, async (q) => {
      await expect(q('select record_purchase_payment($1, 1)', [purchaseId])).rejects.toThrow(/already fully paid/)
    })
  })

  it("another business cannot pay it", async () => {
    const p = (await one(`insert into purchases (business_id, supplier_name, total_cost, balance) values ('${A}','X',10,10) returning id`)).id
    await as('b@x.com', UID_B, async (q) => {
      await expect(q('select record_purchase_payment($1, 1)', [p])).rejects.toThrow(/Purchase not found/)
    })
  })
})

describe('history is read-only and tenant-scoped', () => {
  it('a member reads only their business; nobody writes history directly', async () => {
    await db.query(`insert into sales (business_id, txn_no, total, amount_paid, balance, is_credit) values ('${B}','B-1',100,40,60,true)`)
    await as('b@x.com', UID_B, async (q) => {
      const rows = await q('select txn_no from sale_payments')
      expect(rows.map((r) => r.txn_no)).toEqual(['B-1'])
      await expect(q(`insert into sale_payments (business_id, sale_id, txn_no, amount, balance_after) select business_id, id, txn_no, 1, 0 from sales limit 1`)).rejects.toThrow(/permission denied/)
      await expect(q('update sale_payments set amount = 1')).rejects.toThrow(/permission denied/)
      await expect(q('delete from purchase_payments')).rejects.toThrow(/permission denied/)
    })
    await asAnon(async (q) => {
      await expect(q('select * from sale_payments')).rejects.toThrow(/permission denied/)
    })
  })
})

describe('get_supplier_balances', () => {
  it('groups suppliers ignoring case and spaces, with totals, and only for the caller', async () => {
    const rows = await as('a@x.com', UID_A, (q) => q(`select * from get_supplier_balances('${A}')`))
    const emzor = rows.find((r) => r.supplier_key === 'emzor ltd')
    expect([n(emzor.purchase_count), n(emzor.total_cost), n(emzor.amount_paid), n(emzor.balance), n(emzor.open_count)]).toEqual([2, 12000, 4500, 7500, 2])
    const fidson = rows.find((r) => r.supplier_key === 'fidson healthcare')
    expect([n(fidson.balance), n(fidson.open_count)]).toEqual([0, 0])
    expect(n(rows[0].balance)).toBeGreaterThanOrEqual(n(rows[rows.length - 1].balance))
    const other = await as('b@x.com', UID_B, (q) => q(`select * from get_supplier_balances('${A}')`))
    expect(other).toEqual([])
  })

  it('get_supplier_purchases returns that supplier\'s purchases by the same key, only for the caller', async () => {
    const rows = await as('a@x.com', UID_A, (q) => q(`select supplier_name from get_supplier_purchases('${A}', ' EMZOR LTD')`))
    expect(rows.map((r) => r.supplier_name.trim().toLowerCase())).toEqual(['emzor ltd', 'emzor ltd'])
    expect(await as('b@x.com', UID_B, (q) => q(`select * from get_supplier_purchases('${A}', 'emzor ltd')`))).toEqual([])
  })
})
