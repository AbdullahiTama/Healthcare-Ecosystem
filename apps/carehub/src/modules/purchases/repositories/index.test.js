import { describe, it, expect } from 'vitest'
import { createPurchaseRepository, purchaseRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    purchases: [
      { id: '1', business_id: A, supplier_name: 'MedSupply', total_cost: 800, amount_paid: 800, balance: 0, status: 'paid' },
      { id: '2', business_id: A, supplier_name: 'PharmaCo', total_cost: 500, amount_paid: 200, balance: 300, status: 'pending' },
      { id: '9', business_id: B, supplier_name: 'Other tenant', total_cost: 42, amount_paid: 0, balance: 42, status: 'pending' },
    ],
  })
  return { client, repo: createPurchaseRepository(client) }
}

describe('purchaseRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('create injects business_id and returns the created row', async () => {
    const { repo, client } = seeded()
    // Purchases.jsx reads the new id off the response to link an auto-raised
    // debt back to the purchase, so create must return rows, not minimal.
    const created = await repo.create(A, { supplier_name: 'NewCo', total_cost: 90 })
    expect(created[0].id).toBeDefined()
    expect(client.rows('purchases').find((r) => r.supplier_name === 'NewCo').business_id).toBe(A)
  })

  it('create persists expiry and batch on the created row', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { supplier_name: 'ExpiryCo', total_cost: 90, expiry: '2026-12-01', batch: 'B-1, B-2' })
    expect(client.rows('purchases').find((r) => r.supplier_name === 'ExpiryCo')).toMatchObject({ expiry: '2026-12-01', batch: 'B-1, B-2' })
  })

  it('create keeps expiry and batch null when none are supplied', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { supplier_name: 'NoExpiryCo', total_cost: 90, expiry: null, batch: null })
    expect(client.rows('purchases').find((r) => r.supplier_name === 'NoExpiryCo')).toMatchObject({ expiry: null, batch: null })
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('2', A, { amount_paid: 500, balance: 0, status: 'paid' })
    expect(client.rows('purchases').find((r) => r.id === '2')).toMatchObject({ balance: 0, status: 'paid' })
  })

  it('update leaves sibling purchases in the same business untouched', async () => {
    const { repo, client } = seeded()
    await repo.update('2', A, { status: 'paid' })
    expect(client.rows('purchases').find((r) => r.id === '1').amount_paid).toBe(800)
  })

  it('update never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.update('9', A, { status: 'paid' })
    expect(client.rows('purchases').find((r) => r.id === '9').status).toBe('pending')
  })

  it('exports a default purchaseRepository instance', () => {
    for (const m of ['getAll', 'create', 'update']) {
      expect(typeof purchaseRepository[m]).toBe('function')
    }
  })
})

describe('purchaseRepository.getAll paging and range', () => {
  it('pages past the 1000-row cap and applies [from, to)', async () => {
    const rows = Array.from({ length: 1100 }, (_, i) => ({ id: 'p' + i, business_id: 'biz-A', created_at: i < 1000 ? '2026-10-10T00:00:00' : '2026-09-10T00:00:00' }))
    const repo = createPurchaseRepository(createInMemoryClient({ purchases: rows }))
    expect(await repo.getAll('biz-A')).toHaveLength(1100)
    expect(await repo.getAll('biz-A', { from: '2026-10-01T00:00:00', to: '2026-11-01T00:00:00' })).toHaveLength(1000)
  })
})

describe('purchaseRepository supplier payments', () => {
  it('recordPayment calls record_purchase_payment with amount, method, date, note and staff', async () => {
    const calls = []
    const repo = createPurchaseRepository(async (path, opts) => { calls.push([path, opts]); return { balance: 0, status: 'paid' } })
    expect(await repo.recordPayment('p-1', { amount: 500, method: 'Cheque', paidOn: '2026-10-20', note: 'chq 12', staffName: 'Ada' })).toEqual({ balance: 0, status: 'paid' })
    expect(calls[0][0]).toBe('rpc/record_purchase_payment')
    expect(JSON.parse(calls[0][1].body)).toEqual({ p_purchase_id: 'p-1', p_amount: 500, p_method: 'Cheque', p_paid_on: '2026-10-20', p_note: 'chq 12', p_staff_name: 'Ada' })
  })

  it('getPayments reads by purchase or by supplier key, scoped to the business, newest first', async () => {
    const client = createInMemoryClient({ purchase_payments: [
      { id: 'a', business_id: 'biz-A', purchase_id: 'p-1', supplier_key: 'emzor ltd', created_at: '2026-10-01' },
      { id: 'b', business_id: 'biz-A', purchase_id: 'p-2', supplier_key: 'emzor ltd', created_at: '2026-10-02' },
      { id: 'c', business_id: 'biz-B', purchase_id: 'p-1', supplier_key: 'emzor ltd', created_at: '2026-10-03' },
    ] })
    const repo = createPurchaseRepository(client)
    expect((await repo.getPayments('biz-A', { purchaseId: 'p-1' })).map((r) => r.id)).toEqual(['a'])
    expect((await repo.getPayments('biz-A', { supplierKey: 'emzor ltd' })).map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('getSupplierBalances and getBySupplier call their database functions', async () => {
    const calls = []
    const repo = createPurchaseRepository(async (path, opts) => { calls.push([path, opts ? JSON.parse(opts.body || 'null') : null]); return [] })
    await repo.getSupplierBalances('biz-A')
    await repo.getBySupplier('biz-A', 'emzor ltd')
    expect(calls).toEqual([
      ['rpc/get_supplier_balances?p_business_id=biz-A', null],
      ['rpc/get_supplier_purchases', { p_business_id: 'biz-A', p_supplier_key: 'emzor ltd' }],
    ])
  })
})

describe('purchaseRepository.create invoice lines', () => {
  const lines = [{ name: 'Amoxil', qty: 5, cost: 1200 }]
  it('saves the lines with the purchase', async () => {
    const bodies = []
    const repo = createPurchaseRepository(async (path, opts) => { bodies.push(JSON.parse(opts.body)); return [{ id: 'p-1' }] })
    expect(await repo.create('biz', { supplier_name: 'Emzor', items: lines })).toEqual([{ id: 'p-1' }])
    expect(bodies).toEqual([{ supplier_name: 'Emzor', items: lines, business_id: 'biz' }])
  })
  it('before the items column exists, saves the purchase without its lines instead of failing', async () => {
    const bodies = []
    const repo = createPurchaseRepository(async (path, opts) => {
      const body = JSON.parse(opts.body); bodies.push(body)
      if ('items' in body) throw new Error("Supabase error (400): Could not find the 'items' column of 'purchases' in the schema cache")
      return [{ id: 'p-2' }]
    })
    expect(await repo.create('biz', { supplier_name: 'Emzor', items: lines })).toEqual([{ id: 'p-2' }])
    expect(bodies[1]).toEqual({ supplier_name: 'Emzor', business_id: 'biz' })
  })
  it('any other failure is not retried', async () => {
    let calls = 0
    const repo = createPurchaseRepository(async () => { calls++; throw new Error('Supabase error (400): new row violates row-level security policy') })
    await expect(repo.create('biz', { supplier_name: 'Emzor', items: lines })).rejects.toThrow(/row-level security/)
    expect(calls).toBe(1)
  })
})
