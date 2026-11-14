// @vitest-environment node
// carehub_20270117_debt_and_supplier_accounts on PGlite, on top of the migrations it builds on
// (carehub_20261212_supplier_payments, carehub_20270112 member_can_delete, carehub_20270113_debt_bulk_delete) and
// the live record_sale_payment(), purchases_guard_direct_write(), current_business_ids(), pos_actor() and
// stamp_recorded_by() (read 2026-11-14).
//
// What it proves: hand-recorded debts get a payment history and can only move through record_debt_payment; bulk
// delete / restore keep that history; supplier accounts add supply records to purchases and reconcile; one payment
// to a supplier or on a customer's account is spread oldest first through the existing payment functions, all or
// nothing; import matches or creates customers and suppliers without duplicates, and a dry run changes nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER, UID, D, C, LIVE_HELPERS_SQL } from './debtsFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (name) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + name, import.meta.url)), 'utf8')
const MIGRATION = read('carehub_20270117_debt_and_supplier_accounts.sql')
const SUPPLIER_PAYMENTS = read('carehub_20261212_supplier_payments.sql')
const BULK_DELETE = read('carehub_20270113_debt_bulk_delete.sql')
const MEMBER_CAN_DELETE = read('carehub_20270112_expense_bulk_delete.sql').match(/create or replace function public\.member_can_delete[\s\S]*?\$\$;\nrevoke[^\n]*\n/)[0]

// record_sale_payment and purchases_guard_direct_write exactly as live on 2026-11-14.
const LIVE_SALES_SQL = `
CREATE OR REPLACE FUNCTION public.record_sale_payment(p_sale_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_shift uuid;
  v_paid numeric;
  v_outstanding numeric;
  v_applied numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Payment method must be Cash, Transfer or POS' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Payments can only be recorded against a completed sale' USING ERRCODE = '22023';
  END IF;
  v_paid := least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0));
  v_outstanding := greatest(COALESCE(v_sale.total, 0) - v_paid, 0);
  IF v_outstanding <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on this sale' USING ERRCODE = '22023'; END IF;
  v_applied := least(round(p_amount, 2), v_outstanding);
  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  SELECT sh.id INTO v_shift FROM public.pos_shifts sh
   WHERE sh.business_id = v_sale.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL LIMIT 1;
  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id)
  VALUES (v_sale.business_id, v_sale.id, 'collection', p_method, v_applied, auth.uid(), v_actor.staff_id, v_actor.staff_name, v_shift);
  UPDATE public.sales SET amount_paid = v_paid + v_applied, balance = v_outstanding - v_applied, is_credit = (v_outstanding - v_applied) > 0
   WHERE id = v_sale.id;
  UPDATE public.debts SET amount_paid = v_paid + v_applied, balance = v_outstanding - v_applied,
         status = CASE WHEN v_outstanding - v_applied <= 0 THEN 'paid' ELSE 'pending' END
   WHERE business_id = v_sale.business_id AND source = 'credit_sale' AND source_ref = v_sale.txn_no AND status IS DISTINCT FROM 'paid';
  RETURN jsonb_build_object('sale_id', v_sale.id, 'applied', v_applied, 'amount_paid', v_paid + v_applied, 'balance', v_outstanding - v_applied);
END $function$;
CREATE OR REPLACE FUNCTION public.purchases_guard_direct_write() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Purchases are changed with Edit purchase, which keeps stock, payments and debts in step.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
create trigger purchases_guard_direct_write before delete or update on purchases for each row execute function purchases_guard_direct_write();
`

const P = (n) => 'e0000000-0000-4000-8000-00000000000' + n
const S = (n) => 'f0000000-0000-4000-8000-00000000000' + n
let db

async function scenario(email, sql, checks = []) {
  await db.exec('begin')
  try {
    if (email) await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
    await db.exec('reset role')
    const seen = []
    for (const c of checks) seen.push((await db.query(c)).rows)
    return { out, seen }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const q = async (sql) => (await db.query(sql)).rows

beforeEach(async () => {
  db = new PGlite()
  await db.exec(LIVE_HELPERS_SQL)
  await db.exec(`
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text, created_at timestamp default now());
    create unique index clients_phone_unique_per_business on clients (business_id, regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null and btrim(phone) <> '';
    alter table clients enable row level security;
    create policy "clients of own business" on clients for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, direction text, party_name text, amount numeric default 0,
      amount_paid numeric default 0, balance numeric default 0, due_date text, status text default 'pending', description text,
      created_at timestamp default now(), source text default 'manual', source_ref text default '', client_id uuid references clients(id) on delete set null,
      recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    create trigger stamp_recorded_by_ins before insert on debts for each row execute function stamp_recorded_by();
    create trigger stamp_recorded_by_upd before update on debts for each row execute function keep_recorded_by();
    alter table debts enable row level security;
    create policy "debts of own business" on debts for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, supplier_name text, product_name text, quantity integer default 0,
      total_cost numeric default 0, amount_paid numeric default 0, balance numeric default 0, supply_date text, due_date text, status text default 'pending',
      notes text, created_at timestamp default now(), items jsonb);
    alter table purchases enable row level security;
    create policy "purchases of own business" on purchases for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text, client_name text, client_id uuid, total numeric,
      amount_paid numeric, balance numeric, is_credit boolean, is_on_hold boolean default false, status text, created_at timestamp default now(), deleted_at timestamptz);
    alter table sales enable row level security;
    create policy "sales of own business" on sales for all using (business_id in (select current_business_ids()));
    create table sale_payments (id uuid primary key default gen_random_uuid(), business_id uuid, sale_id uuid, kind text, method text, amount numeric,
      received_at timestamptz default now(), received_by uuid, staff_id uuid, staff_name text, shift_id uuid, note text, backfilled boolean default false);
    create table pos_shifts (id uuid primary key default gen_random_uuid(), business_id uuid, opened_by uuid, closed_at timestamptz);
    grant all on debts, clients, purchases, sales to anon, authenticated, service_role;
    grant select on sale_payments to authenticated;
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());
  `)
  await db.exec(SUPPLIER_PAYMENTS)
  await db.exec(LIVE_SALES_SQL)
  await db.exec(MEMBER_CAN_DELETE)
  await db.exec(BULK_DELETE)
  // Live-like data from before the migration: a hand-recorded debt part paid, a credit sale and its debt, purchases.
  await db.exec(`
    insert into clients (id, business_id, full_name, phone, created_at) values
      ('${C(1)}', '${BIZ}', 'Ada Obi', '0803 111 2222', '2026-01-01'), ('${C(2)}', '${BIZ}', 'Ben', null, '2026-01-02'),
      ('${C(3)}', '${BIZ}', 'Chi', null, '2026-01-03'), ('${C(4)}', '${BIZ}', 'chi ', null, '2026-01-04');
    insert into debts (id, business_id, direction, party_name, amount, amount_paid, balance, status, description, source, source_ref, client_id, created_at) values
      ('${D(1)}', '${BIZ}', 'owes_us', 'Ada Obi', 5000, 1000, 4000, 'pending', 'Borrowed cash', 'manual', '', '${C(1)}', '2026-03-01'),
      ('${D(2)}', '${BIZ}', 'we_owe', 'Emzor Ltd', 7000, 0, 7000, 'pending', 'Opening balance', 'manual', '', null, '2026-02-01'),
      ('${D(3)}', '${BIZ}', 'owes_us', 'Ben', 3000, 0, 3000, 'pending', 'Credit sale', 'credit_sale', 'TXN-1', '${C(2)}', '2026-03-02'),
      ('${D(4)}', '${BIZ}', 'we_owe', 'Emzor Ltd', 10000, 0, 10000, 'pending', 'Purchase', 'purchase', '${P(1)}', null, '2026-01-10'),
      ('${D(9)}', '${OTHER}', 'owes_us', 'X', 100, 0, 100, 'pending', null, 'manual', '', null, '2026-01-01');
    insert into purchases (id, business_id, supplier_name, product_name, total_cost, amount_paid, balance, status, created_at) values
      ('${P(1)}', '${BIZ}', 'Emzor Ltd', 'Paracetamol', 10000, 0, 10000, 'pending', '2026-01-10'),
      ('${P(2)}', '${BIZ}', ' emzor ltd', 'Amoxicillin', 4000, 1000, 3000, 'partial', '2026-03-05'),
      ('${P(3)}', '${BIZ}', 'Fidson', 'ORS', 2000, 2000, 0, 'paid', '2026-03-06');
    insert into sales (id, business_id, txn_no, client_name, client_id, total, amount_paid, balance, is_credit, status, created_at) values
      ('${S(1)}', '${BIZ}', 'TXN-1', 'Ben', '${C(2)}', 3000, 0, 3000, true, 'completed', '2026-03-02'),
      ('${S(2)}', '${BIZ}', 'TXN-2', 'Ben', '${C(2)}', 2000, 500, 1500, true, 'completed', '2026-03-04'),
      ('${S(3)}', '${OTHER}', 'TXN-9', 'X', null, 900, 0, 900, true, 'completed', '2026-03-04');
  `)
  await db.exec(MIGRATION)
})

const pay = (id, amount, method = 'Cash') => `select record_debt_payment('${id}', ${amount}, '${method}') r`

describe('payment history for hand-recorded debts', () => {
  it('existing paid amounts get one before-history row; sale and purchase debts get none', async () => {
    expect(await q(`select debt_id, amount::float8 amount, kind, balance_after::float8 b from debt_payments`)).toEqual([
      { debt_id: D(1), amount: 1000, kind: 'before_history', b: 4000 },
    ])
  })

  it('part then full payment, each with a history row; over-payment and paying a closed debt refused', async () => {
    const r = await scenario(CASHIER, [pay(D(1), 1500), pay(D(1), 2500, 'Transfer')], [
      `select amount::float8 amount, amount_paid::float8 paid, balance::float8 balance, status from debts where id = '${D(1)}'`,
      `select kind, amount::float8 amount, method, balance_after::float8 b, staff_name, recorded_by from debt_payments where debt_id = '${D(1)}' order by balance_after desc`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[0][0].r).toMatchObject({ amount: 1500, balance: 2500, status: 'pending' })
    expect(r.seen[0]).toEqual([{ amount: 5000, paid: 5000, balance: 0, status: 'paid' }])
    expect(r.seen[1].map((x) => [x.kind, x.amount, x.b])).toEqual([['before_history', 1000, 4000], ['payment', 1500, 2500], ['payment', 2500, 0]])
    expect(r.seen[1][1].recorded_by).toBe(UID[CASHIER])
    expect((await scenario(OWNER, pay(D(1), 4000.01))).error).toMatch(/more than the 4,000.00 still owed/)
    expect((await scenario(OWNER, [pay(D(1), 4000), pay(D(1), 1)])).error).toMatch(/already paid in full/)
  })

  it('amounts of a hand-recorded debt cannot be edited directly; due date and description can', async () => {
    expect((await scenario(OWNER, `update debts set amount_paid = 5000, balance = 0, status = 'paid' where id = '${D(1)}'`)).error).toMatch(/Record payment/)
    expect((await scenario(OWNER, `update debts set source = 'credit_sale' where id = '${D(1)}'`)).error).toMatch(/Record payment/)
    const r = await scenario(OWNER, `update debts set due_date = '2026-12-31', description = 'Loan' where id = '${D(1)}' returning due_date`)
    expect(r.out[0]).toEqual([{ due_date: '2026-12-31' }])
    // A sale's debt is still moved by its sale (record_sale_payment), untouched by the guard.
    const s = await scenario(OWNER, `select record_sale_payment('${S(1)}', 1000, 'Cash')`, [`select balance::float8 b from debts where id = '${D(3)}'`])
    expect(s.seen[0]).toEqual([{ b: 2000 }])
  })

  it('a sale or purchase debt is refused with where to pay it; another business and anon refused', async () => {
    expect((await scenario(OWNER, pay(D(3), 100))).error).toMatch(/credit sale TXN-1/)
    expect((await scenario(OWNER, pay(D(4), 100))).error).toMatch(/belongs to a purchase/)
    expect((await scenario(STRANGER, pay(D(1), 100))).error).toMatch(/not found/)
    expect((await scenario(null, pay(D(1), 100))).error).toMatch(/permission denied/)
    expect((await scenario(STRANGER, `select count(*)::int n from debt_payments`)).out[0]).toEqual([{ n: 0 }])
    expect((await scenario(OWNER, `insert into debt_payments (business_id, debt_id, amount, balance_after) values ('${BIZ}', '${D(1)}', 1, 0)`)).error).toMatch(/permission denied/)
  })

  it('a new debt derives its balance and status; paid at recording becomes the first row; impossible values refused', async () => {
    const r = await scenario(OWNER, `insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status) values ('${BIZ}', 'owes_us', 'Kemi', 900, 300, 12345, 'paid') returning id, balance::float8 b, status`, [
      `select kind, amount::float8 amount, balance_after::float8 b from debt_payments where kind = 'at_recording'`,
    ])
    expect(r.out[0][0]).toMatchObject({ b: 600, status: 'pending' })
    expect(r.seen[0]).toEqual([{ kind: 'at_recording', amount: 300, b: 600 }])
    expect((await scenario(OWNER, `insert into debts (business_id, direction, party_name, amount, amount_paid) values ('${BIZ}', 'owes_us', 'K', 100, 200)`)).error).toMatch(/more than the amount owed/)
    expect((await scenario(OWNER, `insert into debts (business_id, direction, party_name, amount) values ('${BIZ}', 'sideways', 'K', 100)`)).error).toMatch(/owes_us/)
  })
})

describe('bulk delete and restore keep the payment history', () => {
  it('restoring puts back the same debt and payment rows, inventing none', async () => {
    const before = await q(`select id, kind, amount::float8 amount from debt_payments where debt_id = '${D(1)}' order by id`)
    const r = await scenario(OWNER, [
      pay(D(1), 500),
      `select delete_debts('${BIZ}', array['${D(1)}']::uuid[]) r`,
      `select count(*)::int n from debt_payments where debt_id = '${D(1)}'`,
      `select restore_deleted_debts('${BIZ}', (select deletion_id from deleted_debts limit 1)) r`,
    ], [
      `select kind, amount::float8 amount from debt_payments where debt_id = '${D(1)}' order by created_at`,
      `select amount_paid::float8 paid, balance::float8 b, status from debts where id = '${D(1)}'`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[2]).toEqual([{ n: 0 }])
    expect(r.out[3][0].r).toMatchObject({ restored: 1 })
    expect(r.seen[0]).toEqual([{ kind: 'before_history', amount: 1000 }, { kind: 'payment', amount: 500 }])
    expect(r.seen[1]).toEqual([{ paid: 1500, b: 3500, status: 'pending' }])
    expect(before).toHaveLength(1)
  })
})

describe('supplier accounts', () => {
  it('purchases plus supply records per supplier; the purchase\'s own debt is not counted twice; figures reconcile', async () => {
    const r = await scenario(MANAGER, `select supplier_key, supplier_name, purchase_count::int pc, supply_count::int sc, supplied_total::float8 supplied,
      paid_total::float8 paid, balance::float8 balance, open_count::int open, mismatch_count::int mismatch from get_supplier_accounts('${BIZ}')`)
    expect(r.out[0]).toEqual([
      { supplier_key: 'emzor ltd', supplier_name: 'emzor ltd', pc: 2, sc: 1, supplied: 21000, paid: 1000, balance: 20000, open: 3, mismatch: 0 },
      { supplier_key: 'fidson', supplier_name: 'Fidson', pc: 1, sc: 0, supplied: 2000, paid: 2000, balance: 0, open: 0, mismatch: 0 },
    ])
    expect((await scenario(STRANGER, `select count(*)::int n from get_supplier_accounts('${BIZ}')`)).out[0]).toEqual([{ n: 0 }])
  })

  it('one payment is applied oldest first across purchases and supply records, traceable as one payment', async () => {
    const r = await scenario(CASHIER, `select record_supplier_payment('${BIZ}', 'EMZOR LTD ', 12500, 'Transfer', null, 'March cheque', 'Bisi') r`, [
      `select id, balance::float8 b, status from purchases where id in ('${P(1)}', '${P(2)}') order by created_at`,
      `select balance::float8 b, status from debts where id in ('${D(4)}', '${D(2)}') order by created_at`,
      `select count(distinct allocation_id)::int a, count(*)::int n, sum(amount)::float8 total from (
         select allocation_id, amount from purchase_payments where kind = 'payment' union all select allocation_id, amount from debt_payments where kind = 'payment') x`,
    ])
    expect(r.error).toBeUndefined()
    // Oldest first: purchase P1 (Jan 10, 10,000), then the supply record D2 (Feb 1, 7,000: 2,500 of it).
    expect(r.out[0][0].r).toMatchObject({ amount: 12500, balance: 7500, allocations: [{ kind: 'purchase', id: P(1), amount: 10000, balance: 0 }, { kind: 'supply', id: D(2), amount: 2500, balance: 4500 }] })
    expect(r.seen[0]).toEqual([{ id: P(1), b: 0, status: 'paid' }, { id: P(2), b: 3000, status: 'partial' }])
    expect(r.seen[1]).toEqual([{ b: 0, status: 'paid' }, { b: 4500, status: 'pending' }])
    expect(r.seen[2]).toEqual([{ a: 1, n: 2, total: 12500 }])
    expect((await scenario(OWNER, `select record_supplier_payment('${BIZ}', 'emzor ltd', 20000.01, 'Cash')`)).error).toMatch(/more than the 20,000.00 owed/)
    expect((await scenario(OWNER, `select record_supplier_payment('${BIZ}', 'fidson', 1, 'Cash')`)).error).toMatch(/Nothing is owed/)
    expect((await scenario(STRANGER, `select record_supplier_payment('${BIZ}', 'emzor ltd', 1, 'Cash')`)).error).toMatch(/not found/)
  })

  it('activity lists supplies and payments of that supplier only', async () => {
    const r = await scenario(OWNER, `select get_supplier_activity('${BIZ}', 'emzor ltd') a`)
    const a = r.out[0][0].a
    expect(a.supplies.map((s) => [s.kind, s.amount])).toEqual([['purchase', 4000], ['supply', 7000], ['purchase', 10000]])
    expect(a.payments.map((p) => [p.source, p.kind, p.amount])).toEqual([['purchase', 'at_purchase', 1000]])
  })
})

describe('one payment on a customer account', () => {
  it('is spread over the account\'s credit sales oldest first through the POS ledger', async () => {
    const r = await scenario(CASHIER, `select record_customer_payment('${BIZ}', array['${S(2)}', '${S(1)}']::uuid[], 4000, 'Cash') r`, [
      `select txn_no, amount_paid::float8 paid, balance::float8 b, is_credit from sales where business_id = '${BIZ}' order by created_at`,
      `select s.txn_no, p.amount::float8 amount, p.kind, p.staff_name from sale_payments p join sales s on s.id = p.sale_id order by s.created_at`,
      `select balance::float8 b, status from debts where id = '${D(3)}'`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[0][0].r).toMatchObject({ amount: 4000, balance: 500 })
    expect(r.seen[0]).toEqual([{ txn_no: 'TXN-1', paid: 3000, b: 0, is_credit: false }, { txn_no: 'TXN-2', paid: 1500, b: 500, is_credit: true }])
    expect(r.seen[1]).toEqual([{ txn_no: 'TXN-1', amount: 3000, kind: 'collection', staff_name: 'Bisi' }, { txn_no: 'TXN-2', amount: 1000, kind: 'collection', staff_name: 'Bisi' }])
    expect(r.seen[2]).toEqual([{ b: 0, status: 'paid' }])
  })

  it('refuses more than is owed, and never touches another business\'s sale', async () => {
    expect((await scenario(OWNER, `select record_customer_payment('${BIZ}', array['${S(1)}', '${S(2)}']::uuid[], 4500.01, 'Cash')`)).error).toMatch(/more than the 4,500.00/)
    const r = await scenario(OWNER, `select record_customer_payment('${BIZ}', array['${S(3)}', '${S(1)}']::uuid[], 3000, 'Cash') r`, [`select balance::float8 b from sales where id = '${S(3)}'`])
    expect(r.out[0][0].r.allocations).toEqual([{ sale_id: S(1), txn_no: 'TXN-1', amount: 3000, balance: 0 }])
    expect(r.seen[0]).toEqual([{ b: 900 }])
    expect((await scenario(STRANGER, `select record_customer_payment('${BIZ}', array['${S(1)}']::uuid[], 10, 'Cash')`)).error).toMatch(/not found/)
    expect((await scenario(OWNER, `select record_customer_payment('${BIZ}', array['${S(1)}']::uuid[], 10, 'Cheque')`)).error).toMatch(/Cash, Transfer or POS/)
  })
})

describe('import_debts', () => {
  const rows = (list) => `'${JSON.stringify(list).replace(/'/g, "''")}'::jsonb`
  const imp = (direction, list, dry = true, dups = false) => `select import_debts('${BIZ}', '${direction}', ${rows(list)}, ${dry}, ${dups}) r`
  const RECEIVABLES = [
    { row: 2, party: 'Ada  obi', amount: 2000, date: '2026-04-01', description: 'Old tab' }, // name match
    { row: 3, party: 'Adaeze', phone: '+234 803-111-2222', amount: 1000 }, // phone match → Ada Obi
    { row: 4, party: 'Ngozi', phone: '0809 000 0000', amount: 1500, paid: 500, reference: 'INV-1' }, // new customer
    { row: 5, party: 'ngozi', amount: 700 }, // the customer just created, not a second one
    { row: 6, party: 'Chi', amount: 100 }, // two customers share the name
    { row: 7, party: '', amount: 5 },
    { row: 8, party: 'Ada Obi', paid: 1000, date: '2026-04-02', reference: 'RCPT-9' }, // payment on Ada's recorded debts
    { row: 9, party: 'Ben', paid: 50 }, // Ben owes only on a credit sale
  ]

  it('dry run: every row checked exactly as the import would, nothing kept', async () => {
    const r = await scenario(CASHIER, imp('owes_us', RECEIVABLES), [`select count(*)::int n from clients`, `select count(*)::int n from debts`, `select count(*)::int n from audit_log`])
    expect(r.error).toBeUndefined()
    const out = r.out[0][0].r
    expect(out.dry_run).toBe(true)
    expect(out.rows.map((x) => [x.row, x.status, x.matched_by || null, x.party])).toEqual([
      [2, 'ok', 'name', 'Ada Obi'], [3, 'ok', 'phone', 'Ada Obi'], [4, 'ok', 'created', 'Ngozi'], [5, 'ok', 'name', 'Ngozi'],
      [6, 'ok', 'name', 'Chi'], [7, 'error', null, null], [8, 'ok', 'name', 'Ada Obi'], [9, 'error', null, 'Ben'],
    ])
    expect(out.rows[4].note).toMatch(/2 customers share this name/)
    expect(out.rows[5].message).toMatch(/name is missing/)
    expect(out.rows[7].message).toMatch(/Credit sales are paid at POS/)
    expect(out.summary).toMatchObject({ rows: 8, debts: 5, payments: 1, errors: 2, clients_created: 1, matched: 6, amount: 5300, paid: 1500 })
    expect(r.seen).toEqual([[{ n: 4 }], [{ n: 5 }], [{ n: 0 }]])
  })

  it('import links to existing customers, creates a missing one once, records payments, audits; a re-import is skipped', async () => {
    const r = await scenario(OWNER, [imp('owes_us', RECEIVABLES, false), imp('owes_us', RECEIVABLES.filter((x) => x.row === 4 || x.row === 2), false)], [
      `select full_name, phone from clients where full_name = 'Ngozi'`,
      `select party_name, client_id is not null linked, amount::float8 amount, amount_paid::float8 paid, balance::float8 b, source, source_ref, created_at::date::text d
         from debts where business_id = '${BIZ}' and source = 'manual' and direction = 'owes_us' order by created_at, amount`,
      `select action, metadata ->> 'debts' debts, metadata ->> 'clients_created' created from audit_log order by created_at`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.seen[0]).toEqual([{ full_name: 'Ngozi', phone: '0809 000 0000' }])
    const ada = r.seen[1].filter((d) => d.party_name === 'Ada Obi')
    // Ada's 5,000 (1,000 paid) and the imported 2,000: the 1,000 payment closes the older debt's balance first.
    expect(ada.map((d) => [d.amount, d.paid, d.b])).toEqual([[5000, 2000, 3000], [2000, 0, 2000], [1000, 0, 1000]])
    expect(r.seen[1].find((d) => d.party_name === 'Ngozi' && d.amount === 1500)).toMatchObject({ source_ref: 'import:inv-1', paid: 500, b: 1000 })
    expect(r.seen[1].every((d) => d.linked)).toBe(true)
    expect(r.out[1][0].r.summary).toMatchObject({ debts: 0, duplicates: 2 })
    expect(r.seen[2]).toEqual([{ action: 'debts.imported', debts: '5', created: '1' }, { action: 'debts.imported', debts: '0', created: '0' }])
  })

  it('payables: the existing supplier spelling is kept, a new supplier starts its account, payments go through the supplier account', async () => {
    const r = await scenario(OWNER, imp('we_owe', [
      { row: 2, party: 'EMZOR LTD', amount: 3000, date: '2026-04-01', description: 'Invoice 77' },
      { row: 3, party: 'New Pharma', amount: 800 },
      { row: 4, party: 'new pharma', paid: 300, reference: 'TRF-1', method: 'Transfer' },
      { row: 5, party: 'Unknown Co', paid: 10 },
      { row: 6, party: 'Fidson', amount: 100, paid: 200 },
    ], false), [
      `select supplier_key, supplier_name, supply_count::int sc, balance::float8 b, mismatch_count::int m from get_supplier_accounts('${BIZ}') order by supplier_key`,
      `select count(*)::int n from clients`,
    ])
    expect(r.error).toBeUndefined()
    const out = r.out[0][0].r
    expect(out.rows.map((x) => [x.row, x.status, x.matched_by || null, x.party])).toEqual([
      [2, 'ok', 'name', 'emzor ltd'], [3, 'ok', 'created', 'New Pharma'], [4, 'ok', 'name', 'New Pharma'], [5, 'error', null, 'Unknown Co'], [6, 'error', null, 'Fidson'],
    ])
    expect(out.rows[4].message).toMatch(/more than the amount owed/)
    expect(out.summary).toMatchObject({ suppliers_created: 1, clients_created: 0 })
    expect(r.seen[0]).toEqual([
      { supplier_key: 'emzor ltd', supplier_name: 'emzor ltd', sc: 2, b: 23000, m: 0 },
      { supplier_key: 'fidson', supplier_name: 'Fidson', sc: 0, b: 0, m: 0 },
      { supplier_key: 'new pharma', supplier_name: 'New Pharma', sc: 1, b: 500, m: 0 },
    ])
    expect(r.seen[1]).toEqual([{ n: 4 }])
  })

  it('another business and anon cannot import; limits', async () => {
    expect((await scenario(STRANGER, imp('owes_us', [{ row: 2, party: 'A', amount: 1 }]))).error).toMatch(/not found/)
    expect((await scenario(null, imp('owes_us', [{ row: 2, party: 'A', amount: 1 }]))).error).toMatch(/permission denied/)
    expect((await scenario(OWNER, imp('sideways', [{ row: 2, party: 'A', amount: 1 }]))).error).toMatch(/receivables/)
    expect((await scenario(OWNER, `select import_debts('${BIZ}', 'owes_us', '[]'::jsonb)`)).error).toMatch(/no rows/)
  })
})

describe('export audit', () => {
  it('knows the new export types; supplier accounts count as cost data', async () => {
    const fn = MIGRATION.match(/CREATE OR REPLACE FUNCTION public\.record_export_audit[\s\S]*?END \$function\$;/)[0]
    expect(fn).toContain("'debts.xlsx', 'debts.csv', 'supplier_accounts.xlsx', 'supplier_accounts.csv', 'credit_accounts.xlsx', 'credit_accounts.csv'")
    const r = await scenario(OWNER, [`select record_export_audit('${BIZ}', 'supplier_accounts.csv', 3, '{}')`, `select record_export_audit('${BIZ}', 'debts.xlsx', 3, '{}')`],
      [`select metadata ->> 'export_type' t, metadata ->> 'includes_cost_data' cost from audit_log order by metadata ->> 'export_type'`])
    expect(r.error).toBeUndefined()
    expect(r.seen[0]).toEqual([{ t: 'debts.xlsx', cost: 'false' }, { t: 'supplier_accounts.csv', cost: 'true' }])
    expect((await scenario(CASHIER, `select record_export_audit('${BIZ}', 'debts.csv', 1, '{}')`)).error).toMatch(/not allowed to export/)
  })
})
