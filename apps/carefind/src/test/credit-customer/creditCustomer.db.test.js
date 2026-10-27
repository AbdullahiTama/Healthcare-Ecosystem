// @vitest-environment node
// Credit sales must name a customer record; purchases keep their line items
// (carehub_20261213_credit_customer_and_purchase_items). Runs the real migration on PGlite.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261213_credit_customer_and_purchase_items.sql', import.meta.url)), 'utf8')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CLIENT_A = 'c0000000-0000-4000-8000-00000000000a'
const CLIENT_B = 'c0000000-0000-4000-8000-00000000000b'
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally { await db.query('reset role') }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, email text);
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      select id from businesses where lower(email)=lower(auth.email()) $$;
    -- Column types as on the LIVE tables (read 2026-10-27).
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text);
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text not null, client_name text default 'Walk-in',
      client_id uuid, total numeric default 0, amount_paid numeric default 0, balance numeric default 0,
      is_credit boolean default false, is_on_hold boolean default false, payment_method text default 'Cash');
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, supplier_name text not null, product_name text,
      quantity integer default 0, cost_price numeric default 0, total_cost numeric default 0);
    do $$ declare t text; begin foreach t in array array['clients','sales','purchases'] loop
      execute format('alter table %I enable row level security', t);
      execute format('create policy "%s of own business" on %I for all to public using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()))', t, t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
    end loop; end $$;
    insert into businesses values ('${A}','a@x.com'), ('${B}','b@x.com');
    insert into clients (id, business_id, full_name) values ('${CLIENT_A}','${A}','Mama Ngozi'), ('${CLIENT_B}','${B}','Other Shop Customer');
    -- A credit sale recorded before the guard, with no customer: it must stay valid.
    insert into sales (business_id, txn_no, total, balance, is_credit) values ('${A}','OLD-CREDIT',500,500,true);
  `)
  await db.exec(MIGRATION)
})

describe('credit sales need a customer record', () => {
  it('a credit sale with the business\'s own customer is recorded', async () => {
    await as('a@x.com', (q) => q(`insert into sales (business_id, txn_no, client_id, client_name, total, balance, is_credit) values ('${A}','CR-1','${CLIENT_A}','Mama Ngozi',1000,1000,true)`))
    expect((await db.query(`select client_id from sales where txn_no='CR-1'`)).rows[0].client_id).toBe(CLIENT_A)
  })

  it('a credit sale with no customer is refused with a sentence the till can show', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`insert into sales (business_id, txn_no, total, balance, is_credit) values ('${A}','CR-2',1000,1000,true)`)).rejects.toThrow('Select the customer for this credit sale.')
    })
  })

  it('another business\'s customer, or an id that does not exist, is refused', async () => {
    await as('a@x.com', async (q) => {
      await expect(q(`insert into sales (business_id, txn_no, client_id, total, balance, is_credit) values ('${A}','CR-3','${CLIENT_B}',1000,1000,true)`)).rejects.toThrow(/not in this business's records/)
      await expect(q(`insert into sales (business_id, txn_no, client_id, total, balance, is_credit) values ('${A}','CR-4',gen_random_uuid(),1000,1000,true)`)).rejects.toThrow(/not in this business's records/)
    })
  })

  it('cash sales, held sales and existing credit sales are unaffected', async () => {
    await as('a@x.com', async (q) => {
      await q(`insert into sales (business_id, txn_no, total) values ('${A}','CASH-1',300)`)
      await q(`insert into sales (business_id, txn_no, total, is_credit, is_on_hold) values ('${A}','HLD-1',300,true,true)`)
      await q(`update sales set balance = 0, is_credit = false where txn_no = 'OLD-CREDIT'`)
    })
    expect(Number((await db.query(`select count(*) c from sales where txn_no in ('CASH-1','HLD-1','OLD-CREDIT')`)).rows[0].c)).toBe(3)
  })

  it('the guard cannot be called directly', async () => {
    await as('a@x.com', async (q) => {
      await expect(q('select sales_require_credit_customer()')).rejects.toThrow()
    })
  })
})

describe('purchase line items', () => {
  it('a purchase keeps its lines; older purchases have none; a non-array is refused', async () => {
    const lines = [{ name: 'Amoxil 500mg', qty: 10, cost: 1200 }, { name: 'Panadol', qty: 5, cost: 300 }]
    await as('a@x.com', (q) => q(`insert into purchases (business_id, supplier_name, product_name, quantity, total_cost, items) values ('${A}','Emzor','Amoxil 500mg, Panadol',15,13500,$1)`, [JSON.stringify(lines)]))
    const r = (await db.query(`select items from purchases where supplier_name='Emzor'`)).rows[0]
    expect(r.items).toEqual(lines)
    await db.query(`insert into purchases (business_id, supplier_name) values ('${A}','Old Supplier')`)
    expect((await db.query(`select items from purchases where supplier_name='Old Supplier'`)).rows[0].items).toBeNull()
    await expect(db.query(`insert into purchases (business_id, supplier_name, items) values ('${A}','Bad','{"a":1}')`)).rejects.toThrow(/purchases_items_is_array/)
  })

  it('re-running the migration is safe', async () => {
    await db.exec(MIGRATION)
    expect(Number((await db.query(`select count(*) c from pg_trigger where tgname='sales_require_credit_customer'`)).rows[0].c)).toBe(1)
  })
})
