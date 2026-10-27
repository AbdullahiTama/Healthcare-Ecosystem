// @vitest-environment node
// Supplier payments with history (carehub_20261212_supplier_payments).
// Runs the real migration on PGlite with the live column types and RLS shape of purchases / debts.
// Customer credit payments use the POS ledger (carehub_20261210_pos_accounting), tested in scripts/db-tests.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const MIGRATION = read('../../../../../supabase/migrations/carehub_20261212_supplier_payments.sql')

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
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, supplier_name text not null, product_name text,
      quantity integer default 0, cost_price numeric default 0, total_cost numeric default 0, amount_paid numeric default 0, balance numeric default 0,
      supply_date text, due_date text, status text default 'pending', notes text, created_at timestamp without time zone default now(),
      selling_price numeric default 0, expiry date, batch text);
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, direction text not null, party_name text not null,
      amount numeric default 0, amount_paid numeric default 0, balance numeric default 0, due_date text, status text default 'pending',
      description text, created_at timestamp without time zone default now(), source text default 'manual', source_ref text default '', client_id uuid);
    do $$ declare t text; begin foreach t in array array['purchases','debts'] loop
      execute format('alter table %I enable row level security', t);
      execute format('create policy "%s of own business" on %I for all to public using (business_id in (select current_business_ids()) or is_platform_admin()) with check (business_id in (select current_business_ids()) or is_platform_admin())', t, t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
    end loop; end $$;
    insert into businesses (id,email) values ('${A}','a@x.com'), ('${B}','b@x.com');
    insert into staff (business_id,email) values ('${A}','cashier@x.com');

    -- Existing data, recorded before the migration: the backfill must turn these into history rows.
    insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance, status) values
      ('${A}','Emzor Ltd',10000,4000,6000,'pending');
  `)
  await db.exec(MIGRATION)
})

describe('backfill and first-payment history', () => {
  it('turns money paid before the migration into one history row per purchase', async () => {
    const p = await one(`select supplier_name, amount, kind, supplier_key from purchase_payments`)
    expect([p.supplier_name, n(p.amount), p.kind, p.supplier_key]).toEqual(['Emzor Ltd', 4000, 'before_history', 'emzor ltd'])
  })

  it('re-running the migration does not duplicate history', async () => {
    await db.exec(MIGRATION)
    expect(n((await one('select count(*) c from purchase_payments')).c)).toBe(1)
  })

  it('a new purchase paid in part starts its history', async () => {
    await as('cashier@x.com', UID_A, async (q) => {
      await q(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance) values ('${A}','  emzor ltd ',2000,500,1500)`)
    })
    const h = await one(`select kind, method, balance_after from purchase_payments where amount=500`)
    expect([h.kind, h.method, n(h.balance_after)]).toEqual(['at_purchase', 'Other', 1500])
  })

  it('leaves customer payments to the POS ledger: no sale table, function or trigger is created', async () => {
    const r = await one(`select to_regclass('public.sale_payments') t, to_regproc('public.record_sale_payment') f`)
    expect([r.t, r.f]).toEqual([null, null])
  })
})

describe('history never blocks a purchase', () => {
  it('a purchase whose history row cannot be written (amount too large) is still recorded', async () => {
    await as('cashier@x.com', UID_A, async (q) => {
      await q(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance) values ('${A}','Big', 1e15, 1e14, 9e14)`)
    })
    expect(n((await one(`select count(*) c from purchases where supplier_name='Big'`)).c)).toBe(1)
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
    const h = await one('select method, paid_on::text d, note, kind, balance_after, recorded_by from purchase_payments where purchase_id=$1', [purchaseId])
    expect([h.method, h.d, h.note, h.kind, n(h.balance_after), h.recorded_by]).toEqual(['Cheque', '2026-10-20', 'chq 0012', 'payment', 5000, UID_A])
  })

  it('refuses a future date, an overpayment, zero, negative and an unknown method; nothing changes', async () => {
    await as('a@x.com', UID_A, async (q) => {
      await expect(q(`select record_purchase_payment($1, 10, 'Cash', current_date + 5)`, [purchaseId])).rejects.toThrow(/future/)
      await expect(q('select record_purchase_payment($1, 5000.01)', [purchaseId])).rejects.toThrow(/more than the balance of 5,000.00/)
      await expect(q('select record_purchase_payment($1, 0)', [purchaseId])).rejects.toThrow(/greater than zero/)
      await expect(q('select record_purchase_payment($1, -5)', [purchaseId])).rejects.toThrow(/greater than zero/)
      await expect(q(`select record_purchase_payment($1, 10, 'Bitcoin')`, [purchaseId])).rejects.toThrow(/how the supplier was paid/)
    })
    expect(n((await one('select balance from purchases where id=$1', [purchaseId])).balance)).toBe(5000)
  })

  it('the rest pays it off', async () => {
    const r = await as('a@x.com', UID_A, (q) => q('select record_purchase_payment($1, 5000) r', [purchaseId]))
    expect(r[0].r).toMatchObject({ balance: 0, status: 'paid' })
    expect((await one(`select status from debts where source='purchase'`)).status).toBe('paid')
    await as('a@x.com', UID_A, async (q) => {
      await expect(q('select record_purchase_payment($1, 1)', [purchaseId])).rejects.toThrow(/already fully paid/)
    })
  })

  it("another business's member, and anon, cannot pay it or learn it exists", async () => {
    const p = (await one(`insert into purchases (business_id, supplier_name, total_cost, balance) values ('${A}','X',10,10) returning id`)).id
    await as('b@x.com', UID_B, async (q) => {
      await expect(q('select record_purchase_payment($1, 1)', [p])).rejects.toThrow(/Purchase not found/)
      await expect(q(`select record_purchase_payment('00000000-0000-4000-8000-000000000999', 1)`)).rejects.toThrow(/Purchase not found/)
    })
    await asAnon(async (q) => {
      await expect(q('select record_purchase_payment($1, 1)', [p])).rejects.toThrow(/permission denied/)
      await expect(q(`select * from get_supplier_balances('${A}')`)).rejects.toThrow(/permission denied/)
    })
    expect(n((await one('select balance from purchases where id=$1', [p])).balance)).toBe(10)
  })
})

describe('history is read-only and tenant-scoped', () => {
  it('a member reads only their business; nobody writes history directly', async () => {
    await db.query(`insert into purchases (business_id, supplier_name, total_cost, amount_paid, balance) values ('${B}','B Supplier',100,40,60)`)
    await as('b@x.com', UID_B, async (q) => {
      const rows = await q('select supplier_name from purchase_payments')
      expect(rows.map((r) => r.supplier_name)).toEqual(['B Supplier'])
      await expect(q(`insert into purchase_payments (business_id, purchase_id, supplier_name, amount, balance_after) select business_id, id, supplier_name, 1, 0 from purchases limit 1`)).rejects.toThrow(/permission denied/)
      await expect(q('update purchase_payments set amount = 1')).rejects.toThrow(/permission denied/)
      await expect(q('delete from purchase_payments')).rejects.toThrow(/permission denied/)
    })
    await asAnon(async (q) => {
      await expect(q('select * from purchase_payments')).rejects.toThrow(/permission denied/)
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
