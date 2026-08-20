import { describe, it, expect } from 'vitest'
import { deriveExpiryRows, filterExpiryRows } from './expiryAlertsHelper.js'

// Fixed "today" so horizon math is deterministic regardless of when the suite runs.
const TODAY = '2026-08-19'

// Minimal fixtures shaped like what the repositories actually return.
const product = (overrides) => ({ id: 'p1', name: 'Paracetamol 500mg', cost_price: 750, ...overrides })
const batch = (overrides) => ({
  id: 'b1', business_id: 'biz', location_id: 'loc1', product_id: 'p1', product_name: 'Paracetamol 500mg',
  batch_number: 'B-1', quantity: 10, cost_price: 500, expiry_date: '2026-08-31', status: 'available',
  ...overrides,
})

const derive = (batches, products, today = TODAY) => deriveExpiryRows(batches, products, { today })

describe('deriveExpiryRows', () => {
  // HAPPY_PATH: qty 10, cost_price 500, expiry in 12 days, status available.
  it('derives daysLeft and expectedLoss for a normal available batch', () => {
    const rows = derive([batch({})], [product({})])
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.daysLeft).toBe(12)
    expect(row.unitCost).toBe(500)
    expect(row.expectedLoss).toBe(5000)
    expect(row.productName).toBe('Paracetamol 500mg')
    expect(row.status).toBe('available')
  })

  // BATCH_COST_ZERO: batch cost 0 → falls back to the product cost (750).
  it('falls back to the product cost when the batch cost is zero', () => {
    const rows = derive([batch({ cost_price: 0 })], [product({})])
    expect(rows[0].unitCost).toBe(750)
    expect(rows[0].expectedLoss).toBe(7500)
  })

  // BATCH_COST_ZERO also when the batch cost is missing entirely (the live
  // table historically had no cost column — undefined must behave like 0).
  it('falls back to the product cost when the batch has no cost at all', () => {
    const rows = derive([batch({ cost_price: undefined })], [product({})])
    expect(rows[0].expectedLoss).toBe(7500)
  })

  // BOTH_ZERO: batch cost 0 and product cost 0 → the row still appears, loss 0.
  it('still shows a row when both costs are zero, with loss 0', () => {
    const rows = derive([batch({ cost_price: 0 })], [product({ cost_price: 0 })])
    expect(rows).toHaveLength(1)
    expect(rows[0].expectedLoss).toBe(0)
  })

  // BOTH_ZERO also when the product is absent from the list entirely: batch
  // cost is not positive (0) AND there is no product to fall back to → loss 0.
  it('still shows a row when the product is missing and the batch cost is 0', () => {
    const rows = derive([batch({ cost_price: 0 })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].expectedLoss).toBe(0)
  })

  // ALREADY_EXPIRED: expiry 3 days ago, still available, qty 5, cost 200.
  it('reports a negative daysLeft for an already-expired available batch', () => {
    const rows = derive([batch({ quantity: 5, cost_price: 200, expiry_date: '2026-08-16' })], [product({})])
    expect(rows[0].daysLeft).toBe(-3)
    expect(rows[0].expectedLoss).toBe(1000)
  })

  // STATUS_EXPIRED: status 'expired' is a definite loss and stays included.
  it('includes batches already marked expired (definite loss)', () => {
    const rows = derive([batch({ status: 'expired', quantity: 8, expiry_date: '2026-08-01', cost_price: 200 })], [product({})])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('expired')
    expect(rows[0].expectedLoss).toBe(1600)
  })

  // NO_EXPIRY: a batch with no expiry date is excluded.
  it('excludes batches with no expiry date', () => {
    const rows = derive([batch({ expiry_date: null })], [product({})])
    expect(rows).toHaveLength(0)
  })

  // ZERO_QTY: a batch with zero quantity is excluded.
  it('excludes zero-quantity batches', () => {
    const rows = derive([batch({ quantity: 0 })], [product({})])
    expect(rows).toHaveLength(0)
  })

  // ZERO_QTY also when quantity is negative.
  it('excludes negative-quantity batches', () => {
    const rows = derive([batch({ quantity: -5 })], [product({})])
    expect(rows).toHaveLength(0)
  })

  // OTHER_STATUS: reserved/damaged/returned batches are excluded.
  it('excludes reserved/damaged/returned batches', () => {
    for (const status of ['reserved', 'damaged', 'returned']) {
      const rows = derive([batch({ status })], [product({})])
      expect(rows, `${status} should be excluded`).toHaveLength(0)
    }
  })

  // NO_PRODUCT_MATCH: product_id not in the list → productName falls back to
  // batch.product_name and the cost fallback yields 0 (no product to fall back
  // to, and the batch cost here is not positive either).
  it('falls back to batch.product_name when the product is not in the list', () => {
    const rows = derive([batch({ cost_price: 0, product_id: 'ghost', product_name: 'Legacy Drug' })], [product({ id: 'p1' })])
    expect(rows[0].productName).toBe('Legacy Drug')
    expect(rows[0].unitCost).toBe(0)
    expect(rows[0].expectedLoss).toBe(0)
  })

  // A batch without a product_id at all keeps its own product_name.
  it('keeps batch.product_name when the batch has no product_id', () => {
    const rows = derive([batch({ product_id: null, product_name: 'Direct Batch' })], [product({})])
    expect(rows[0].productName).toBe('Direct Batch')
  })

  // derive is a projection: the raw fields the dashboard renders survive.
  it('carries through batchNumber, expiryDate and locationId', () => {
    const rows = derive([batch({})], [product({})])
    expect(rows[0]).toMatchObject({ id: 'b1', batchNumber: 'B-1', expiryDate: '2026-08-31', locationId: 'loc1' })
  })
})

describe('filterExpiryRows', () => {
  const rows = derive([
    batch({ id: 'b-12', quantity: 10, cost_price: 500, expiry_date: '2026-08-31' }),  // 12 days left
    batch({ id: 'b-6', quantity: 4, cost_price: 100, expiry_date: '2026-08-25' }),    // 6 days left
    batch({ id: 'b-0', quantity: 5, cost_price: 200, expiry_date: '2026-08-16' }),    // -3 days (expired)
    batch({ id: 'b-90', quantity: 3, cost_price: 50, expiry_date: '2026-11-17' }),    // 90 days left
  ], [product({})])

  it('includes in 30-day everything with 0 < daysLeft <= 30, and in "all" everything', () => {
    // The spec horizon rule is explicit: 7/15/30 = `0 < daysLeft <= N`, so an
    // already-expired batch (daysLeft <= 0) is only ever in the 0-day and All
    // horizons.
    const in30 = filterExpiryRows(rows, { horizon: 30 })
    expect(in30.rows.map(r => r.id).sort()).toEqual(['b-12', 'b-6'])
    expect(in30.summary.count).toBe(2)
    expect(in30.summary.expiredCount).toBe(0)

    const all = filterExpiryRows(rows, { horizon: 'all' })
    expect(all.rows).toHaveLength(4)
    expect(all.summary.count).toBe(4)
    expect(all.summary.expiredCount).toBe(1)
  })

  it('excludes an expiring-soon batch from the 7-day horizon', () => {
    const in7 = filterExpiryRows(rows, { horizon: 7 })
    expect(in7.rows.map(r => r.id)).toEqual(['b-6'])
  })

  it('0-day horizon is exactly the already-expired batches', () => {
    const in0 = filterExpiryRows(rows, { horizon: 0 })
    expect(in0.rows.map(r => r.id)).toEqual(['b-0'])
    expect(in0.summary.expectedLoss).toBe(1000)
  })

  it('a batch expiring today is in the 0-day horizon, not the 30-day', () => {
    const todayRow = derive([batch({ id: 'b-today', quantity: 2, cost_price: 300, expiry_date: '2026-08-19' })], [product({})])
    expect(todayRow[0].daysLeft).toBe(0)
    expect(filterExpiryRows(todayRow, { horizon: 0 }).rows.map(r => r.id)).toEqual(['b-today'])
    expect(filterExpiryRows(todayRow, { horizon: 30 }).rows).toHaveLength(0)
    expect(filterExpiryRows(todayRow, { horizon: 'all' }).rows.map(r => r.id)).toEqual(['b-today'])
  })

  it('aggregates expectedLoss and expiredCount per horizon', () => {
    const in7 = filterExpiryRows(rows, { horizon: 7 })
    expect(in7.summary.expectedLoss).toBe(4 * 100)
    expect(in7.summary.expiredCount).toBe(0)

    const all = filterExpiryRows(rows, { horizon: 'all' })
    expect(all.summary.expectedLoss).toBe(10 * 500 + 4 * 100 + 5 * 200 + 3 * 50)
    expect(all.summary.expiredCount).toBe(1)
  })

  // WAREHOUSE_FILTER: null-location batches only under 'unassigned', never a
  // specific warehouse.
  it('shows null-location batches only under the Unassigned scope', () => {
    const mixed = derive([
      batch({ id: 'assigned', location_id: 'loc1' }),
      batch({ id: 'unassigned', location_id: null }),
    ], [product({})])

    expect(filterExpiryRows(mixed, { warehouseId: 'loc1' }).rows.map(r => r.id)).toEqual(['assigned'])
    expect(filterExpiryRows(mixed, { warehouseId: 'unassigned' }).rows.map(r => r.id)).toEqual(['unassigned'])
    expect(filterExpiryRows(mixed, { warehouseId: 'other-warehouse' }).rows).toHaveLength(0)
    expect(filterExpiryRows(mixed, { warehouseId: 'all' }).rows).toHaveLength(2)
  })

  it('combines horizon and warehouse scope together', () => {
    const mixed = derive([
      batch({ id: 'loc1-12', location_id: 'loc1', expiry_date: '2026-08-31' }),
      batch({ id: 'null-3', location_id: null, expiry_date: '2026-08-16' }),
    ], [product({})])
    const out = filterExpiryRows(mixed, { horizon: 0, warehouseId: 'unassigned' })
    expect(out.rows.map(r => r.id)).toEqual(['null-3'])
  })

  // EMPTY: no rows match → empty list and a zeroed summary.
  it('returns an empty set with a zeroed summary when nothing matches', () => {
    const out = filterExpiryRows(rows, { horizon: 'all', warehouseId: 'no-such-warehouse' })
    expect(out.rows).toHaveLength(0)
    expect(out.summary).toEqual({ count: 0, expectedLoss: 0, expiredCount: 0 })

    const out2 = filterExpiryRows(rows, { horizon: 7 })
    expect(out2.summary.expiredCount).toBe(0)
  })

  it('treats null/undefined horizon and warehouse as no filter', () => {
    const out = filterExpiryRows(rows, {})
    expect(out.rows).toHaveLength(4)
    expect(out.summary.count).toBe(4)
  })
})