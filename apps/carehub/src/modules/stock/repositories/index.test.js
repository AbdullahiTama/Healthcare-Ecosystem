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

  // `transfer` and `adjust` are single RPC calls into transfer_stock_batch /
  // adjust_stock_batch (20260805_atomic_stock_transfer.sql). The splitting,
  // journalling, row locking and tenant scoping all happen inside one database
  // transaction, so what is assertable here is the *call* — that the repository
  // issues exactly one write and hands the database the right arguments, rather
  // than reassembling a multi-step sequence on the client.
  //
  // The transactional behaviour itself was verified against the live database,
  // inside a DO block that raised at the end so the test rolled back: a 30-of-100
  // split conserved the total, carried batch_number/expiry/cost_price/sales_unit/
  // notes onto the destination, journalled one transfer row, refused an
  // over-transfer against the CURRENT quantity (70, not the stale 100), returned
  // null cross-tenant, and adjusted 70 -> 64 journalling exactly -6. Re-run the
  // block in that SQL file's header to re-verify. Faking that logic in the
  // in-memory adapter would only test the fake.
  function recording(returns = [null]) {
    const calls = []
    const repo = createStockRepository({
      request: async (path, options) => {
        calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
        return returns
      },
    })
    return { calls, repo }
  }

  const aBatch = { id: 'b1', quantity: 100, location_id: WAREHOUSE_1 }

  describe('transfer', () => {
    it('issues exactly one RPC call with the tenant, destination and quantity', async () => {
      const { calls, repo } = recording(['new-batch-id'])
      const result = await repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: 30, movedBy: 'Ada' })

      expect(calls).toHaveLength(1) // not a decrement-then-insert sequence
      expect(calls[0].path).toBe('rpc/transfer_stock_batch')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].body).toEqual({
        p_batch_id: 'b1',
        p_business_id: A,
        p_to_location_id: WAREHOUSE_2,
        p_qty: 30,
        p_moved_by: 'Ada',
      })
      // The destination batch id the function returns.
      expect(result).toBe('new-batch-id')
    })

    it('coerces a string quantity from the form input', async () => {
      const { calls, repo } = recording()
      await repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: '30', movedBy: 'Ada' })
      expect(calls[0].body.p_qty).toBe(30)
    })

    it('sends null rather than undefined when nobody is named', async () => {
      const { calls, repo } = recording()
      await repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: 5 })
      expect(calls[0].body.p_moved_by).toBeNull()
    })

    it('surfaces a null return as null (foreign or deleted batch)', async () => {
      const { repo } = recording([null])
      expect(await repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: 5 })).toBeNull()
    })

    // These messages are rendered straight into a toast, so they are part of
    // the contract. They fail fast for a better message; the RPC re-checks
    // against the locked row, which is the authoritative test.
    it('refuses a non-positive quantity without calling the database', async () => {
      const { calls, repo } = recording()
      await expect(repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: 0 }))
        .rejects.toThrow('Enter a quantity greater than zero.')
      expect(calls).toHaveLength(0)
    })

    it('refuses to move more than the batch holds, without calling the database', async () => {
      const { calls, repo } = recording()
      await expect(repo.transfer(A, { batch: aBatch, toLocationId: WAREHOUSE_2, qty: 101 }))
        .rejects.toThrow('You only have 100 units in this batch.')
      expect(calls).toHaveLength(0)
    })
  })

  describe('adjust', () => {
    it('issues exactly one RPC call and does not compute the difference here', async () => {
      const { calls, repo } = recording([-8])
      const diff = await repo.adjust(A, { batch: aBatch, newQty: 92, reason: 'Physical count', movedBy: 'Ada' })

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('rpc/adjust_stock_batch')
      expect(calls[0].body).toEqual({
        p_batch_id: 'b1',
        p_business_id: A,
        p_qty: 92,
        p_reason: 'Physical count',
        p_moved_by: 'Ada',
      })
      // The difference is absent from the request — the database derives it
      // from the locked row, so a stale page cannot journal a change that
      // never happened. It only comes back in the response.
      expect(calls[0].body).not.toHaveProperty('p_diff')
      expect(diff).toBe(-8)
    })

    it('allows adjusting to zero', async () => {
      const { calls, repo } = recording([-100])
      await repo.adjust(A, { batch: aBatch, newQty: 0, movedBy: 'Ada' })
      expect(calls).toHaveLength(1)
      expect(calls[0].body.p_qty).toBe(0)
    })

    it('coerces a string quantity and nulls an empty reason', async () => {
      const { calls, repo } = recording()
      await repo.adjust(A, { batch: aBatch, newQty: '64', reason: '', movedBy: 'Ada' })
      expect(calls[0].body.p_qty).toBe(64)
      expect(calls[0].body.p_reason).toBeNull()
    })

    it('refuses a negative or non-numeric quantity without calling the database', async () => {
      const { calls, repo } = recording()
      await expect(repo.adjust(A, { batch: aBatch, newQty: -1 })).rejects.toThrow('Enter a valid quantity.')
      await expect(repo.adjust(A, { batch: aBatch, newQty: 'abc' })).rejects.toThrow('Enter a valid quantity.')
      expect(calls).toHaveLength(0)
    })
  })

  it('exports a default stockRepository instance', () => {
    for (const m of ['getBatches', 'createBatch', 'updateBatch', 'deleteBatch', 'transfer', 'adjust']) {
      expect(typeof stockRepository[m]).toBe('function')
    }
  })
})
