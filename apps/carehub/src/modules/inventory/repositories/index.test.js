import { describe, it, expect } from 'vitest'
import { createProductRepository, productRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    products: [
      { id: '1', business_id: A, name: 'Paracetamol', stock: 10 },
      { id: '2', business_id: A, name: 'Amoxicillin', stock: 4 },
      { id: '3', business_id: A, name: 'Ibuprofen', stock: 0 },
      { id: '9', business_id: B, name: 'Other-biz product', stock: 7 },
    ],
  })
  return { client, repo: createProductRepository(client) }
}

describe('productRepository', () => {
  it('getAll returns only the calling business tenant, ordered query aside', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2', '3'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('getById scopes by id AND business, returning null when absent', async () => {
    const { repo } = seeded()
    expect((await repo.getById('1', A)).name).toBe('Paracetamol')
    // product 9 belongs to B — must not leak to A
    expect(await repo.getById('9', A)).toBeNull()
    expect(await repo.getById('does-not-exist', A)).toBeNull()
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { name: 'Vitamin C', stock: 20 })
    const created = client.rows('products').find((r) => r.name === 'Vitamin C')
    expect(created.business_id).toBe(A)
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { stock: 99 })
    expect(client.rows('products').find((r) => r.id === '1').stock).toBe(99)
    // cannot update another business's row through A's scope
    await repo.update('9', A, { stock: 0 })
    expect(client.rows('products').find((r) => r.id === '9').stock).toBe(7)
  })

  it('delete scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.delete('2', A)
    expect(client.rows('products').map((r) => r.id)).not.toContain('2')
    // A cannot delete B's row
    await repo.delete('9', A)
    expect(client.rows('products').map((r) => r.id)).toContain('9')
  })

  // ── Bug 1: deleteBulk was called by the cleanup flow but never defined ──────
  it('deleteBulk removes exactly the given ids for the tenant', async () => {
    const { repo, client } = seeded()
    await repo.deleteBulk(['1', '3'], A)
    expect(client.rows('products').map((r) => r.id).sort()).toEqual(['2', '9'])
  })

  it('deleteBulk never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    // id '9' belongs to B; passing it under A's scope must not delete it
    await repo.deleteBulk(['1', '9'], A)
    expect(client.rows('products').map((r) => r.id).sort()).toEqual(['2', '3', '9'])
  })

  it('deleteBulk is a no-op on an empty list (issues no request)', async () => {
    let called = false
    const repo = createProductRepository(async () => {
      called = true
      return []
    })
    await repo.deleteBulk([], A)
    expect(called).toBe(false)
  })

  // ── Bug 2: updateStock was dead and malformed (unscoped PATCH with a
  // non-PostgREST { increment } body). It is removed; stock changes go through
  // update() with a read-modify-written value. Guard against reintroduction.
  it('does not expose the malformed updateStock', () => {
    const { repo } = seeded()
    expect(repo.updateStock).toBeUndefined()
  })

  // ── Atomic replenishment (C5/C12) ──────────────────────────────────────────
  // The point of this method is that the addition happens in the database, not
  // in JavaScript — a read-modify-write here would clobber the sale trigger's
  // decrement. So the assertion is about the call it makes, not a resulting
  // row: it must post to the RPC with the tenant and quantity, and never read
  // stock first.
  it('incrementStock calls the RPC with the tenant and quantity, reading nothing first', async () => {
    const calls = []
    const repo = createProductRepository(async (path, options) => {
      calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
      return 12
    })

    const newStock = await repo.incrementStock('prod-1', A, 5)

    expect(calls).toHaveLength(1) // no read-modify-write
    expect(calls[0].path).toBe('rpc/increment_product_stock')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ p_product_id: 'prod-1', p_business_id: A, p_qty: 5 })
    expect(newStock).toBe(12)
  })

  it('incrementStock is a no-op for a zero or negative quantity', async () => {
    let called = false
    const repo = createProductRepository(async () => { called = true; return null })
    expect(await repo.incrementStock('prod-1', A, 0)).toBeNull()
    expect(await repo.incrementStock('prod-1', A, -3)).toBeNull()
    expect(called).toBe(false)
  })

  it('exports a default productRepository instance', () => {
    expect(typeof productRepository.getAll).toBe('function')
    expect(typeof productRepository.deleteBulk).toBe('function')
    expect(typeof productRepository.incrementStock).toBe('function')
  })
})
