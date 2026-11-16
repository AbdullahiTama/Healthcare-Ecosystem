// @vitest-environment node
// carehub_20270120_client_opening_balances on PGlite, over carehub_20270117 (debtsFixture) with the live helpers.
// A client's opening balance is a hand-recorded debt linked to the client (source 'manual', source_ref
// 'opening_balance'). What it proves: a "We owe client" balance no longer shows up as a supplier or takes a supplier
// payment; supplier accounts are otherwise unchanged; one opening balance per client; an opening balance is paid
// like any hand-recorded debt; the migration refuses to run twice; function grants are kept.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BIZ, OWNER, CASHIER, STRANGER, UID, C, read, createDebtsDb } from './debtsFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = read('carehub_20270120_client_opening_balances.sql')

let db
async function as(email, sql) {
  await db.exec('begin')
  try {
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: UID[email], email, role: 'authenticated' })])
    await db.exec('set local role authenticated')
    const out = []
    for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
    return { out }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const q = async (sql) => (await db.query(sql)).rows
const accounts = `select supplier_key k, balance::float8 b, supply_count::int n from get_supplier_accounts('${BIZ}') order by 1`
// "We owe client": Ada Obi (C1) paid in advance; recorded as her opening balance.
const weOweAda = `insert into debts (business_id, direction, party_name, amount, description, source, source_ref, client_id, created_at)
  values ('${BIZ}', 'we_owe', 'Ada Obi', 2500, 'Opening balance', 'manual', 'opening_balance', '${C(1)}', '2026-01-01') returning id, balance::float8 b, status`
const grants = `select proname, proacl::text acl, prosecdef from pg_proc where proname in ('get_supplier_accounts','get_supplier_activity','record_supplier_payment') order by 1`

beforeEach(async () => { db = await createDebtsDb() })

describe('before the migration (the problem)', () => {
  it('a client\'s "we owe" balance shows up as a supplier account', async () => {
    const r = await as(CASHIER, [weOweAda, accounts])
    expect(r.out[1].map((a) => a.k)).toContain('ada obi')
  })
})

describe('carehub_20270120_client_opening_balances', () => {
  let before
  beforeEach(async () => {
    before = { accounts: await q(accounts), grants: await q(grants) }
    await db.exec(MIGRATION)
  })

  it('leaves existing supplier accounts and the functions\' grants exactly as they were', async () => {
    expect(await q(accounts)).toEqual(before.accounts)
    expect(await q(grants)).toEqual(before.grants)
  })

  it('a client\'s "we owe" balance is not a supplier: not listed, no activity, no supplier payment', async () => {
    const r = await as(CASHIER, [
      weOweAda, accounts,
      `select get_supplier_activity('${BIZ}', 'ada obi') a`,
      `select balance::float8 b from debts where client_id = '${C(1)}' and direction = 'we_owe'`,
    ])
    expect(r.out[0]).toEqual([expect.objectContaining({ b: 2500, status: 'pending' })])
    expect(r.out[1].map((a) => a.k)).not.toContain('ada obi')
    expect(r.out[2][0].a).toEqual({ supplies: [], payments: [] })
    const pay = await as(OWNER, [weOweAda, `select record_supplier_payment('${BIZ}', 'ada obi', 100)`])
    expect(pay.error).toMatch(/Nothing is owed to this supplier/)
  })

  it('a supplier payment still reaches supply records without a client', async () => {
    const r = await as(OWNER, [weOweAda, `select record_supplier_payment('${BIZ}', 'emzor ltd', 100) r`])
    expect(r.error).toBeUndefined()
    expect(r.out[1][0].r.allocations.length).toBeGreaterThan(0)
  })

  it('one opening balance per client, in either direction', async () => {
    const second = `insert into debts (business_id, direction, party_name, amount, description, source, source_ref, client_id)
      values ('${BIZ}', 'owes_us', 'Ada Obi', 900, 'Opening balance', 'manual', 'opening_balance', '${C(1)}')`
    expect((await as(CASHIER, [weOweAda, second])).error).toMatch(/debts_one_opening_balance_per_client/)
    // Another client, and other hand-recorded debts of the same client, are unaffected.
    const ok = await as(CASHIER, [
      weOweAda,
      `insert into debts (business_id, direction, party_name, amount, source, source_ref, client_id) values ('${BIZ}', 'owes_us', 'Ben', 300, 'manual', 'opening_balance', '${C(2)}')`,
      `insert into debts (business_id, direction, party_name, amount, source, client_id) values ('${BIZ}', 'owes_us', 'Ada Obi', 700, 'manual', '${C(1)}')`,
    ])
    expect(ok.error).toBeUndefined()
  })

  it('an opening balance is checked and paid like any hand-recorded debt', async () => {
    const owes = `insert into debts (business_id, direction, party_name, amount, amount_paid, balance, status, description, source, source_ref, client_id)
      values ('${BIZ}', 'owes_us', 'Ben', 3000, 0, 0, 'paid', 'Opening balance', 'manual', 'opening_balance', '${C(2)}') returning id, balance::float8 b, status`
    const r = await as(CASHIER, [owes])
    // debt_manual_defaults derives balance and status: a forged "paid" is corrected.
    expect(r.out[0][0]).toMatchObject({ b: 3000, status: 'pending' })
    const paid = await as(CASHIER, [owes, `select record_debt_payment((select id from debts where source_ref = 'opening_balance' and client_id = '${C(2)}'), 1000, 'Cash') p`])
    expect(paid.out[1][0].p).toMatchObject({ balance: 2000 })
    expect((await as(CASHIER, [owes, `update debts set balance = 0 where source_ref = 'opening_balance'`])).error).toMatch(/Record payment/)
    expect((await as(CASHIER, `insert into debts (business_id, direction, party_name, amount, source, source_ref, client_id) values ('${BIZ}', 'owes_us', 'Ben', -5, 'manual', 'opening_balance', '${C(2)}')`)).error).toMatch(/negative/)
  })

  it('another business cannot add or see a client\'s opening balance', async () => {
    await db.exec(weOweAda.replace(' returning id, balance::float8 b, status', ''))
    expect((await as(STRANGER, `select count(*)::int n from debts where source_ref = 'opening_balance'`)).out[0]).toEqual([{ n: 0 }])
    expect((await as(STRANGER, `insert into debts (business_id, direction, party_name, amount, source, source_ref, client_id) values ('${BIZ}', 'owes_us', 'X', 1, 'manual', 'opening_balance', '${C(2)}')`)).error).toMatch(/row-level security/)
  })

  it('refuses to run twice', async () => {
    await expect(db.exec(MIGRATION)).rejects.toThrow(/already excludes client debts/)
  })
})
