import { describe, it, expect } from 'vitest'
import { createDedupIndex, classify, classifyBatch, compareRecords, buildMergePatch, DUP_STATUS } from '../services/deduplication'
import { deriveNormalized } from '../services/normalize'

const rec = (id, o) => ({ id, ...o, ...deriveNormalized(o) })
const existing = [
  rec('e1', { name: 'Alpha Pharmacy Ltd', address: '12 Herbert Macaulay Road, Yaba', phone: '0803 111 2222', website: 'https://alphapharmacy.ng', latitude: 6.5095, longitude: 3.3711, category_id: 'cat-ph' }),
  rec('e2', { name: 'Beta Medical Centre', address: '4 Allen Avenue, Ikeja', phone: '0802 333 4444', latitude: 6.6018, longitude: 3.3515, category_id: 'cat-mc' }),
  rec('e3', { name: 'Alpha Pharmacy Ikeja', address: '90 Obafemi Awolowo Way, Ikeja', phone: '0803 111 2222', latitude: 6.6, longitude: 3.35, category_id: 'cat-ph' }),
]

describe('duplicate classification', () => {
  const index = createDedupIndex(existing)

  it('different spelling of the same name at the same address is a confirmed duplicate', () => {
    const c = rec('c', { name: 'ALPHA PHARMACY LIMITED', address: '12 Herbert Macaulay Rd, Yaba', latitude: 6.5096, longitude: 3.3712 })
    const r = classify(c, index)
    expect(r.status).toBe(DUP_STATUS.CONFIRMED)
    expect(r.match.id).toBe('e1')
  })

  it('same phone + near-identical name is confirmed even with no address', () => {
    const r = classify(rec('c', { name: 'Alpha Pharmacy', phone: '+234 803 111 2222' }), index)
    expect(r.status).toBe(DUP_STATUS.CONFIRMED)
  })

  it('a typo in the name at the same spot is flagged at least as possible', () => {
    const r = classify(rec('c', { name: 'Alfa Pharmcy', address: '12 Herbert Macaulay Road Yaba', latitude: 6.5095, longitude: 3.3711 }), index)
    expect(r.status).not.toBe(DUP_STATUS.NEW)
  })

  it('same chain, same phone, branches > 1 km apart is NOT auto-confirmed', () => {
    const c = rec('c', { name: 'Alpha Pharmacy Yaba', phone: '08031112222', address: 'Somewhere else', latitude: 6.62, longitude: 3.5 })
    const r = classify(c, index)
    expect(r.status).not.toBe(DUP_STATUS.CONFIRMED)
  })

  it('shared phone with a different name is a possible duplicate for review', () => {
    const r = classify(rec('c', { name: 'Gamma Stores', phone: '0802 333 4444' }), index)
    expect(r.status).toBe(DUP_STATUS.POSSIBLE)
    expect(r.reasons).toContain('same phone')
  })

  it('an unrelated business is new', () => {
    expect(classify(rec('c', { name: 'Delta Diagnostics', address: '1 Marina', phone: '09011112222', latitude: 6.45, longitude: 3.39 }), index).status).toBe(DUP_STATUS.NEW)
  })

  it('same name across cities is not a duplicate when the places differ', () => {
    const r = classify(rec('c', { name: 'Beta Medical Centre', address: '7 Ahmadu Bello Way, Kano', latitude: 12.0, longitude: 8.52 }), index)
    expect(r.status).not.toBe(DUP_STATUS.CONFIRMED)
  })

  it('compareRecords explains itself', () => {
    const r = compareRecords(existing[0], existing[0])
    expect(r.level).toBe(2)
    expect(r.reasons).toEqual(expect.arrayContaining(['same name', 'same phone']))
  })

  it('social-media hosts do not link unrelated businesses', () => {
    const idx = createDedupIndex([rec('x', { name: 'Zed Clinic', website: 'https://facebook.com/zed' })])
    expect(classify(rec('c', { name: 'Yankee Labs', website: 'https://facebook.com/yankee' }), idx).status).toBe(DUP_STATUS.NEW)
  })
})

describe('classifyBatch', () => {
  it('catches the second copy inside the same file and reports progress without blocking', async () => {
    const idx = createDedupIndex([])
    // Distinct, spread-out businesses: one-digit name differences next to each other
    // are *meant* to be flagged for review, so they are not a fair "unique" fixture.
    const syl = ['ka', 'lo', 'mi', 'ne', 'su', 'ta', 'vo', 'xe', 'zu', 'bi', 'da', 'fo']
    const uniq = (i) => syl[i % 12] + syl[Math.floor(i / 12) % 12] + syl[Math.floor(i / 144) % 12] + syl[(i * 7) % 12]
    const rows = Array.from({ length: 450 }, (_, i) => rec(undefined, { name: uniq(i) + ' Care', address: 'Plot ' + uniq(i + 5) + ' Avenue', latitude: 6 + i * 0.05, longitude: 3 + (i % 7) * 0.2 }))
    rows.push(rec(undefined, { ...rows[10], name: rows[10].name.toUpperCase() }))
    delete rows[450].id
    const ticks = []
    const out = await classifyBatch(rows.map((r) => { const c = { ...r }; delete c.id; return c }), idx, { chunkSize: 100, onProgress: (d) => ticks.push(d) })
    expect(out[450].status).toBe(DUP_STATUS.CONFIRMED)
    expect(out[450].in_file).toBe(true)
    expect(ticks[0]).toBe(100)
    expect(ticks[ticks.length - 1]).toBe(451)
    expect(out.filter((o) => o.status === DUP_STATUS.NEW).length).toBe(450)
  })

  it('can be cancelled', async () => {
    await expect(classifyBatch([rec(undefined, { name: 'A Clinic' })], createDedupIndex([]), { shouldCancel: () => true })).rejects.toThrow('cancelled')
  })

  it('handles a 3,000 × 3,000 comparison quickly (blocking index, not O(n·m))', async () => {
    const mk = (i, p) => rec(p + i, { name: 'Facility ' + i + ' Healthcare', address: i + ' Road', phone: '080' + String(10000000 + i), latitude: 6 + (i % 300) / 100, longitude: 3 + Math.floor(i / 300) / 100 })
    const idx = createDedupIndex(Array.from({ length: 3000 }, (_, i) => mk(i, 'e')))
    const t0 = Date.now()
    const out = await classifyBatch(Array.from({ length: 3000 }, (_, i) => { const c = mk(i, 'c'); delete c.id; return c }), idx)
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(out.every((o) => o.status === DUP_STATUS.CONFIRMED)).toBe(true)
  })
})

describe('buildMergePatch', () => {
  it('fills blanks only and never overwrites existing values', () => {
    const e = { phone: '0803', email: null, website: '', address: 'Old addr', address_normalized: 'old addr' }
    const inc = { phone: '0999', email: 'x@y.co', website: 'https://z.com', website_host: 'z.com', address: 'New addr', address_normalized: 'new addr' }
    const p = buildMergePatch(e, inc)
    expect(p).toMatchObject({ email: 'x@y.co', website: 'https://z.com', website_host: 'z.com' })
    expect(p.phone).toBeUndefined()
    expect(p.address).toBeUndefined()
    expect(p.address_normalized).toBeUndefined()
  })
  it('returns null when the incoming row adds nothing', () => {
    expect(buildMergePatch({ phone: '1', email: 'a@b.co' }, { phone: '2', email: 'c@d.co' })).toBeNull()
  })
  it('moves latitude/longitude only as a pair', () => {
    expect(buildMergePatch({ latitude: 6, longitude: null }, { latitude: 7, longitude: 3 })).toBeNull()
    expect(buildMergePatch({ latitude: null, longitude: null }, { latitude: 7, longitude: 3 })).toMatchObject({ latitude: 7, longitude: 3 })
  })
})

describe('findDuplicatePairs (reviewing an existing directory)', () => {
  const dir = [
    rec('a', { name: 'Alpha Pharmacy', address: '12 Rd Yaba', phone: '08031112222', latitude: 6.5095, longitude: 3.3711 }),
    rec('b', { name: 'ALPHA PHARMACY LTD', address: '12 Road, Yaba', phone: '+234 803 111 2222', latitude: 6.5096, longitude: 3.3712 }),
    rec('c', { name: 'Totally Different Labs', address: '5 Marina', phone: '09012345678', latitude: 6.45, longitude: 3.39 }),
  ]
  it('reports the later record against the earlier one, best first', async () => {
    const { findDuplicatePairs } = await import('../services/deduplication')
    const pairs = await findDuplicatePairs(dir)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ keep: { id: 'a' }, other: { id: 'b' }, status: DUP_STATUS.CONFIRMED })
  })
  it('does not report dismissed pairs again', async () => {
    const { findDuplicatePairs, pairKey } = await import('../services/deduplication')
    expect(await findDuplicatePairs(dir, { dismissed: new Set([pairKey('b', 'a')]) })).toEqual([])
  })
})
