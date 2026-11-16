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
import { BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER, UID, D, C, P, S, MIGRATION, createDebtsDb } from './debtsFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
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
  db = await createDebtsDb()
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
