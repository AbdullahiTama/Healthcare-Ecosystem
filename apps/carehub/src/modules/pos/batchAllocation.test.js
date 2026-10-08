import { describe, it, expect } from 'vitest'
import { allocateBatches, isSellableBatch, sellableBatches } from './batchAllocation.js'

const DATE = '2026-08-19'

// A batch is sellable only when available and not past its expiry.
const batch = (overrides) => ({ id: 'b1', product_id: 'p1', batch_number: 'B-1', quantity: 5, status: 'available', expiry_date: '2027-01-01', ...overrides })

describe('isSellableBatch', () => {
  it('is sellable when available and not yet expired', () => {
    expect(isSellableBatch(batch({}), DATE)).toBe(true)
  })

  it('is sellable on its expiry day', () => {
    expect(isSellableBatch(batch({ expiry_date: DATE }), DATE)).toBe(true)
  })

  it('is NOT sellable once expired', () => {
    expect(isSellableBatch(batch({ expiry_date: '2026-08-01' }), DATE)).toBe(false)
  })

  it('is NOT sellable when status is reserved/damaged/returned/expired', () => {
    for (const status of ['reserved', 'damaged', 'returned', 'expired']) {
      expect(isSellableBatch(batch({ status }), DATE)).toBe(false)
    }
  })

  it('treats a missing expiry as never-expiring (Purchases only writes one when supplied)', () => {
    expect(isSellableBatch(batch({ expiry_date: null }), DATE)).toBe(true)
  })
})

describe('sellableBatches', () => {
  it('excludes batches that are expired or non-available even when quantity > 0', () => {
    const out = sellableBatches([
      batch({ id: 'ok', quantity: 5 }),
      batch({ id: 'expired', quantity: 5, expiry_date: '2026-08-01' }),
      batch({ id: 'damaged', quantity: 5, status: 'damaged' }),
    ], DATE)
    expect(out.map(b => b.id)).toEqual(['ok'])
  })

  it('excludes a zero-quantity batch even when available and unexpired', () => {
    const out = sellableBatches([batch({ id: 'empty', quantity: 0 })], DATE)
    expect(out).toHaveLength(0)
  })

  it('sorts the result FEFO-first (soonest expiry)', () => {
    const out = sellableBatches([
      batch({ id: 'later', quantity: 2, expiry_date: '2028-01-01' }),
      batch({ id: 'sooner', quantity: 2, expiry_date: '2026-12-01' }),
    ], DATE)
    expect(out.map(b => b.id)).toEqual(['sooner', 'later'])
  })
})

describe('allocateBatches', () => {
  // HAPPY_PATH: qty 5 across FEFO batches of 3 and 2 → two lines, correct ids.
  it('splits a line across FEFO batches in expiry order', () => {
    const lines = allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 500, qty: 5 }],
      { p1: [
        batch({ id: 'B-A', batch_number: 'A', quantity: 3, expiry_date: '2027-01-01' }),
        batch({ id: 'B-B', batch_number: 'B', quantity: 2, expiry_date: '2027-02-01' }),
      ] },
      { date: DATE, isOwner: false },
    )

    expect(lines).toEqual([
      expect.objectContaining({ id: 'p1', qty: 3, batch_id: 'B-A', batch_number: 'A', batch_expiry: '2027-01-01' }),
      expect.objectContaining({ id: 'p1', qty: 2, batch_id: 'B-B', batch_number: 'B', batch_expiry: '2027-02-01' }),
    ])
    // the sum is conserved — splitting never changes the amount sold
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(5)
  })

  // FEFO order is by expiry, NOT insertion order: the batch expiring soonest
  // is drained first even when listed last.
  it('picks the soonest-expiring batch first regardless of input order', () => {
    const lines = allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: 4 }],
      { p1: [
        batch({ id: 'later', batch_number: 'L', quantity: 10, expiry_date: '2028-01-01' }),
        batch({ id: 'sooner', batch_number: 'S', quantity: 4, expiry_date: '2026-12-01' }),
      ] },
      { date: DATE, isOwner: false },
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].batch_id).toBe('sooner')
  })

  // EXPIRED_BLOCK / overflow: a non-owner cannot cover the qty with sellable
  // batches → the helper throws (the server guard is the authoritative backstop).
  it('throws for a non-owner when qty exceeds the sellable batches', () => {
    const call = () => allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: 6 }],
      { p1: [
        batch({ id: 'B-A', batch_number: 'A', quantity: 3, expiry_date: '2027-01-01' }),
        batch({ id: 'B-X', batch_number: 'X', quantity: 30, expiry_date: '2026-01-01' }),
      ] },
      { date: DATE, isOwner: false },
    )

    expect(call).toThrow(/Not enough unexpired stock/)
    expect(call).toThrow(/Drug A/)
  })

  // OVERRIDE: an owner may fill the shortfall from expired batches, and every
  // such line is flagged so the database guard accepts it.
  it('allows an owner to dip into expired batches with override_expired: true', () => {
    const lines = allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: 5 }],
      { p1: [
        batch({ id: 'B-A', batch_number: 'A', quantity: 3, expiry_date: '2027-01-01' }),
        batch({ id: 'B-X', batch_number: 'X', quantity: 30, expiry_date: '2026-01-01' }),
      ] },
      { date: DATE, isOwner: true },
    )

    expect(lines).toHaveLength(2)
    // sellable line first, un-flagged
    expect(lines[0]).toMatchObject({ qty: 3, batch_id: 'B-A' })
    expect(lines[0].override_expired).toBeUndefined()
    // expired fill, flagged
    expect(lines[1]).toMatchObject({ qty: 2, batch_id: 'B-X', batch_number: 'X', override_expired: true })
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(5)
  })

  // OVERRIDE edge: an owner whose qty exceeds even the expired stock is still
  // told the truth — there is literally nothing left to allocate.
  it('throws for an owner too when qty exceeds every batch combined', () => {
    const call = () => allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: 100 }],
      { p1: [
        batch({ id: 'B-A', quantity: 3, expiry_date: '2027-01-01' }),
        batch({ id: 'B-X', quantity: 4, expiry_date: '2026-01-01' }),
      ] },
      { date: DATE, isOwner: true },
    )

    expect(call).toThrow(/ANY batch/)
  })

  // NO_BATCHES: a product with no batches passes through unchanged — no batch
  // keys, same object, and the server behaves exactly as before.
  it('passes a product with no batches through untouched', () => {
    const item = { id: 'p-no-batches', name: 'Legacy product', price: 50, qty: 2 }
    const out = allocateBatches([item], {}, { date: DATE, isOwner: false })
    expect(out).toEqual([item])
    expect(out[0].batch_id).toBeUndefined()
  })

  // BATCH_OTHER_TENANT: the map is already tenant-scoped (getBatches is
  // business-scoped), so a foreign batch never appears and the line passes
  // through as if unbatched — never blocked.
  it('ignores a batch that is not in the (already tenant-scoped) map', () => {
    const item = { id: 'p1', name: 'Drug A', price: 100, qty: 2 }
    const out = allocateBatches([item], { p_other: [batch({ id: 'foreign', quantity: 99 })] }, { date: DATE, isOwner: false })
    expect(out).toEqual([item])
  })

  // Services and non-positive quantities pass through untouched too.
  it('passes a service line and a zero-qty line through untouched', () => {
    const service = { id: 'svc', name: 'Consultation', price: 5000, qty: 1, cat: 'Services' }
    const zero = { id: 'p1', name: 'Drug A', price: 100, qty: 0 }
    const out = allocateBatches([service, zero], { p1: [batch({})] }, { date: DATE, isOwner: false })
    expect(out).toEqual([service, zero])
  })

  // A line with a qty string from an older cart still allocates numerically.
  it('coerces a string quantity from a held-sale cart', () => {
    const lines = allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: '4' }],
      { p1: [batch({ id: 'B-A', quantity: 4, expiry_date: '2027-01-01' })] },
      { date: DATE, isOwner: false },
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ qty: 4, batch_id: 'B-A' })
  })

  // A product whose only 'available' batch has quantity 0 is not sellable to a
  // non-owner — same predicate the POS add-gate now uses (sellableBatches), so
  // the gate and the allocation can never disagree.
  it('throws for a non-owner when the only batch has zero quantity', () => {
    const call = () => allocateBatches(
      [{ id: 'p1', name: 'Drug A', price: 100, qty: 1 }],
      { p1: [batch({ id: 'B-0', quantity: 0, expiry_date: '2027-01-01' })] },
      { date: DATE, isOwner: false },
    )
    expect(call).toThrow(/Not enough unexpired stock/)
  })
})