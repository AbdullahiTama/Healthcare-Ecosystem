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
