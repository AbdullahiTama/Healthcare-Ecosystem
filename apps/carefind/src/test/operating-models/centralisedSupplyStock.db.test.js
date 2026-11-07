// @vitest-environment node
// carehub_20270106_centralised_supply_takes_stock on PGlite: starts on the earlier Centralised rule (goods supplied to a
// representative stayed in company stock), records an entry under it, then applies the migration and checks the
// one-time conversion, the new rule for supplies, returns and reversals, and both switches reconciling with custody
// outside company stock. Same fixture as operatingModels.db.test.js.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { bootOperatingModels, CENTRALISED_STOCK, CO, M, P, S, USERS, OWNER } from './operatingModelsFixture.js'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
let db
let ada
let oldSupply

async function as(email, fn) {
  const sub = `10000000-0000-4000-8000-${String(USERS[email]).padStart(12, '0')}`
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const call = (sql, params = []) => as(OWNER, (q) => q(sql, params)).then((rows) => rows[0] && Object.values(rows[0])[0])
const one = async (s, p) => (await db.query(s, p)).rows[0]
const stock = async (id) => (await one('select stock from products where id = $1', [id])).stock
const custody = async (product) => (await one('select quantity from rep_custody where representative_id = $1 and company_product_id = $2', [ada, product]))?.quantity ?? 0
const j = (v) => JSON.stringify(v)
const supply = (qty) => call('select record_rep_supply($1, $2, $3::jsonb)', [CO, ada, j([{ product_id: P.amox, qty, unit_value: 900 }])])

beforeAll(async () => {
  db = await bootOperatingModels({ centralisedStock: false })
  ada = (await call('select add_company_representative($1, $2)', [CO, S.ada])).id
  oldSupply = await supply(10)
})

describe('the earlier rule, and the move to the new one', () => {
  it('before the migration a Centralised supply left company stock untouched', async () => {
    expect(await stock(P.amox)).toBe(100)
    expect(await custody(P.amox)).toBe(10)
    expect((await one('select stock_effect from rep_ledger_entries where id = $1', [oldSupply.id])).stock_effect).toBe('custody')
  })

  it('applying it takes custody held under the earlier rule out of company stock, once', async () => {
    await db.exec(CENTRALISED_STOCK)
    expect(await stock(P.amox)).toBe(90)
    expect(await custody(P.amox)).toBe(10)
    await db.exec(CENTRALISED_STOCK) // re-run: the conversion is keyed per custody row
    expect(await stock(P.amox)).toBe(90)
  })

  it('an entry recorded under the earlier rule is not reversed automatically', async () => {
    await expect(call(`select reverse_rep_entry($1, 'Wrong')`, [oldSupply.id])).rejects.toThrow(/earlier stock rule/)
  })
})

describe('Centralised under the new rule', () => {
  it('a supply takes the goods out of company stock into custody; its reversal puts them back', async () => {
    const r = await supply(5)
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([85, 15])
    expect(await one('select stock_effect from rep_ledger_entries where id = $1', [r.id])).toEqual({ stock_effect: 'custody_out' })
    expect(await one(`select movement_type, quantity, source_type from stock_movements where source_id = $1`, [r.id]))
      .toEqual({ movement_type: 'transfer', quantity: -5, source_type: 'rep_supply' })
    await call(`select reverse_rep_entry($1, 'Entered twice')`, [r.id])
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([90, 10])
  })

  it('a good return goes back into company stock; a damaged one only leaves custody', async () => {
    await call('select record_rep_return($1, $2, $3::jsonb, $4)', [CO, ada, j([{ product_id: P.amox, qty: 2, unit_value: 900 }]), 'good'])
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([92, 8])
    await call('select record_rep_return($1, $2, $3::jsonb, $4)', [CO, ada, j([{ product_id: P.amox, qty: 1, unit_value: 0 }]), 'damaged'])
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([92, 7])
  })

  it('a supply larger than company stock is refused', async () => {
    await expect(supply(500)).rejects.toThrow(/INSUFFICIENT_STOCK/)
  })
})

describe('switching with custody outside company stock', () => {
  let account

  it('to Decentralised: planned custody becomes account stock, the rest goes back to company stock, and it reconciles', async () => {
    const p = await call(`select operating_model_preview($1, 'decentralised')`, [CO])
    expect(p.representatives.find((r) => r.id === ada).stock.find((s) => s.company_product_id === P.amox)).toMatchObject({ custody: 7, carry: 7 })
    const res = await call(`select switch_operating_model($1, 'decentralised', $2, $3::jsonb)`,
      [CO, p.token, j([{ representative_id: ada, company_product_id: P.amox, qty: 3 }])])
    expect(res.reconciliation.balanced).toBe(true)
    expect(res.reconciliation.after.stock_units).toBe(res.reconciliation.before.stock_units)
    account = (await one('select rep_account_id from company_representatives where id = $1', [ada])).rep_account_id
    expect((await one('select stock from products where business_id = $1 and master_product_id = $2', [account, M.amox])).stock).toBe(3)
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([96, 0])
  })

  it('to Centralised: account stock becomes custody without being added to company stock, and it reconciles', async () => {
    const p = await call(`select operating_model_preview($1, 'centralised')`, [CO])
    const res = await call(`select switch_operating_model($1, 'centralised', $2)`, [CO, p.token])
    expect(res.reconciliation.balanced).toBe(true)
    expect((await one('select stock from products where business_id = $1 and master_product_id = $2', [account, M.amox])).stock).toBe(0)
    expect([await stock(P.amox), await custody(P.amox)]).toEqual([96, 3])
  })
})
