import { describe, it, expect } from 'vitest'
import { createStockRepository, stockRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'
const WAREHOUSE_1 = 'loc-1'
const WAREHOUSE_2 = 'loc-2'

function seeded() {
  const client = createInMemoryClient({
    stock_batches: [
      { id: '1', business_id: A, location_id: WAREHOUSE_1, product_id: 'p1', product_name: 'Amoxicillin', batch_number: 'B-01', quantity: 100, status: 'available', expiry_date: '2027-01-01', received_by: 'Ada' },
      { id: '2', business_id: A, location_id: WAREHOUSE_2, product_name: 'Paracetamol', quantity: 40, status: 'available' },
      { id: '9', business_id: B, location_id: 'loc-9', product_name: 'Other tenant', quantity: 7, status: 'available' },
    ],
    stock_movements: [],
  })
  return { client, repo: createStockRepository({ request: client }) }
}

const batch = (client, id) => client.rows('stock_batches').find((r) => r.id === id)

describe('stockRepository', () => {
  describe('batches', () => {
    it('getBatches returns only the calling tenant', async () => {
      const { repo } = seeded()
      const rows = await repo.getBatches(A)
      expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    })

    it('createBatch injects business_id', async () => {
      const { repo, client } = seeded()
      await repo.createBatch(A, { product_name: 'Ibuprofen', quantity: 10, location_id: WAREHOUSE_1 })
      expect(client.rows('stock_batches').find((r) => r.product_name === 'Ibuprofen').business_id).toBe(A)
    })

    it('updateBatch scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.updateBatch('1', A, { status: 'damaged' })
      expect(batch(client, '1').status).toBe('damaged')
      expect(batch(client, '2').status).toBe('available')
    })

    it('updateBatch never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.updateBatch('9', A, { status: 'damaged' })
      expect(batch(client, '9').status).toBe('available')
    })

    it('deleteBatch scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.deleteBatch('1', A)
      expect(client.rows('stock_batches').map((r) => r.id)).not.toContain('1')
    })

    it('deleteBatch never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.deleteBatch('9', A)
      expect(client.rows('stock_batches').map((r) => r.id)).toContain('9')
    })
  })

  describe('transfer', () => {
    it('moving the whole batch relocates it rather than splitting', async () => {
      const { repo, client } = seeded()
      await repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 100, movedBy: 'Ada' })
      expect(batch(client, '1')).toMatchObject({ location_id: WAREHOUSE_2, quantity: 100 })
      // No second batch was created — the same row moved.
      expect(client.rows('stock_batches').filter((r) => r.product_name === 'Amoxicillin')).toHaveLength(1)
    })

    it('moving part of the batch splits it, conserving the total', async () => {
      const { repo, client } = seeded()
      await repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 30, movedBy: 'Ada' })

      const amox = client.rows('stock_batches').filter((r) => r.product_name === 'Amoxicillin')
      expect(amox).toHaveLength(2)
      expect(amox.reduce((s, r) => s + r.quantity, 0)).toBe(100)

      const source = amox.find((r) => r.id === '1')
      const destination = amox.find((r) => r.id !== '1')
      expect(source).toMatchObject({ location_id: WAREHOUSE_1, quantity: 70 })
      expect(destination).toMatchObject({ location_id: WAREHOUSE_2, quantity: 30, business_id: A })
    })

    it('carries the batch identity onto the split-off batch', async () => {
      const { repo, client } = seeded()
      await repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 30, movedBy: 'Ada' })
      const destination = client.rows('stock_batches').find((r) => r.location_id === WAREHOUSE_2 && r.product_name === 'Amoxicillin')
      // Expiry and batch number must follow the stock, or the split half
      // becomes untraceable and never expires.
      expect(destination).toMatchObject({ batch_number: 'B-01', expiry_date: '2027-01-01', product_id: 'p1' })
    })

    it('journals the move', async () => {
      const { repo, client } = seeded()
      await repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 30, movedBy: 'Ada' })
      expect(client.rows('stock_movements')[0]).toMatchObject({
        business_id: A,
        batch_id: '1',
        from_location_id: WAREHOUSE_1,
        to_location_id: WAREHOUSE_2,
        movement_type: 'transfer',
        quantity: 30,
        moved_by: 'Ada',
      })
    })

    // These messages are rendered straight into a toast, so they are part of
    // the contract, not incidental.
    it('refuses a non-positive quantity without writing anything', async () => {
      const { repo, client } = seeded()
      await expect(repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 0 }))
        .rejects.toThrow('Enter a quantity greater than zero.')
      expect(client.rows('stock_movements')).toHaveLength(0)
      expect(batch(client, '1').quantity).toBe(100)
    })

    it('refuses to move more than the batch holds', async () => {
      const { repo, client } = seeded()
      await expect(repo.transfer(A, { batch: batch(client, '1'), toLocationId: WAREHOUSE_2, qty: 101 }))
        .rejects.toThrow('You only have 100 units in this batch.')
      expect(client.rows('stock_movements')).toHaveLength(0)
      expect(batch(client, '1').quantity).toBe(100)
    })

    it('cannot move another tenant batch', async () => {
      const { repo, client } = seeded()
      await repo.transfer(A, { batch: batch(client, '9'), toLocationId: WAREHOUSE_2, qty: 7, movedBy: 'Ada' })
      // The scoped update matched nothing, so B's batch is untouched.
      expect(batch(client, '9')).toMatchObject({ location_id: 'loc-9', quantity: 7 })
    })
  })

  describe('adjust', () => {
    it('sets the counted quantity and journals the signed difference', async () => {
      const { repo, client } = seeded()
      await repo.adjust(A, { batch: batch(client, '1'), newQty: 92, reason: 'Physical count', movedBy: 'Ada' })
      expect(batch(client, '1').quantity).toBe(92)
      expect(client.rows('stock_movements')[0]).toMatchObject({
        business_id: A,
        batch_id: '1',
        movement_type: 'adjustment',
        quantity: -8,
        reason: 'Physical count',
        to_location_id: null,
      })
    })

    it('journals a positive difference when the count is higher', async () => {
      const { repo, client } = seeded()
      await repo.adjust(A, { batch: batch(client, '1'), newQty: 110, movedBy: 'Ada' })
      expect(client.rows('stock_movements')[0].quantity).toBe(10)
    })

    it('allows adjusting to zero', async () => {
      const { repo, client } = seeded()
      await repo.adjust(A, { batch: batch(client, '1'), newQty: 0, movedBy: 'Ada' })
      expect(batch(client, '1').quantity).toBe(0)
      expect(client.rows('stock_movements')[0].quantity).toBe(-100)
    })

    it('refuses a negative or non-numeric quantity without writing anything', async () => {
      const { repo, client } = seeded()
      await expect(repo.adjust(A, { batch: batch(client, '1'), newQty: -1 })).rejects.toThrow('Enter a valid quantity.')
      await expect(repo.adjust(A, { batch: batch(client, '1'), newQty: 'abc' })).rejects.toThrow('Enter a valid quantity.')
      expect(client.rows('stock_movements')).toHaveLength(0)
      expect(batch(client, '1').quantity).toBe(100)
    })

    it('cannot adjust another tenant batch', async () => {
      const { repo, client } = seeded()
      await repo.adjust(A, { batch: batch(client, '9'), newQty: 999, movedBy: 'Ada' })
      expect(batch(client, '9').quantity).toBe(7)
    })
  })

  it('exports a default stockRepository instance', () => {
    for (const m of ['getBatches', 'createBatch', 'updateBatch', 'deleteBatch', 'transfer', 'adjust']) {
      expect(typeof stockRepository[m]).toBe('function')
    }
  })
})
