import { describe, it, expect } from 'vitest'
import { createDirectoryRepository, PLATFORM } from '../repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'
import { searchBusinesses } from '../services/search'
import { commitImport, analyseImport } from '../services/importService'
import { RESOLUTION } from '../services/deduplication'
import { toExportRow } from '../services/exportService'

const A = 'biz-A'
const B = 'biz-B'
const row = (id, business_id, o = {}) => ({ id, business_id, name: id, name_normalized: id, is_active: true, verification_status: 'verified', data_source: 'manual', latitude: 6.5, longitude: 3.4, ...o })

function seeded() {
  const client = createInMemoryClient({
    directory_categories: [
      { id: 'c-ph', business_id: null, name: 'Pharmacy', is_active: true },
      { id: 'c-own', business_id: A, name: 'Own category', is_active: true },
    ],
    directory_subcategories: [{ id: 's1', business_id: null, category_id: 'c-ph', name: 'Community Pharmacy', is_active: true }],
    directory_businesses: [
      row('own1', A, { name_normalized: 'own one' }),
      row('plat1', null, { name_normalized: 'platform one' }),
      row('plat2', null, { name_normalized: 'platform two', latitude: 6.5001 }),
      row('other', B),
    ],
  })
  return { client, repo: createDirectoryRepository(client) }
}

describe('PLATFORM scope addressing', () => {
  it('lists only platform rows (business_id IS NULL), never a company\'s', async () => {
    const { repo } = seeded()
    expect((await repo.list(PLATFORM)).map((r) => r.id).sort()).toEqual(['plat1', 'plat2'])
    expect((await repo.list(A)).map((r) => r.id)).toEqual(['own1'])
  })
  it('radius search, place search, dedup index and getById honour the scope', async () => {
    const { repo } = seeded()
    expect((await repo.searchWithinBox(PLATFORM, { lat: 6.5, lng: 3.4, radiusKm: 5 })).map((r) => r.id).sort()).toEqual(['plat1', 'plat2'])
    expect((await repo.getDedupIndexRows(PLATFORM)).map((r) => r.id).sort()).toEqual(['plat1', 'plat2'])
    expect(await repo.getById('own1', PLATFORM)).toBeNull()
    expect((await repo.getById('plat1', PLATFORM)).id).toBe('plat1')
  })
  it('platform categories are the built-ins only', async () => {
    const { repo } = seeded()
    expect((await repo.getCategories(PLATFORM)).map((c) => c.name)).toEqual(['Pharmacy'])
    expect((await repo.getCategories(A)).map((c) => c.name).sort()).toEqual(['Own category', 'Pharmacy'])
    expect((await repo.getSubcategories(PLATFORM)).map((s) => s.name)).toEqual(['Community Pharmacy'])
  })
  it('create/insertMany in platform scope write business_id NULL', async () => {
    const { repo, client } = seeded()
    await repo.create(PLATFORM, { name: 'New Platform Biz' }, 'admin@x.co')
    await repo.insertMany(PLATFORM, 'batch-1', [{ name: 'Bulk One' }])
    const added = client.rows('directory_businesses').filter((r) => ['New Platform Biz', 'Bulk One'].includes(r.name))
    expect(added).toHaveLength(2)
    expect(added.every((r) => r.business_id === null)).toBe(true)
  })
  it('update/verify/deactivate in platform scope cannot touch a company\'s record', async () => {
    const { repo, client } = seeded()
    await repo.setVerification('own1', PLATFORM, 'unverified')
    await repo.setActive('plat1', PLATFORM, false)
    const rows = client.rows('directory_businesses')
    expect(rows.find((r) => r.id === 'own1').verification_status).toBe('verified')
    expect(rows.find((r) => r.id === 'plat1').is_active).toBe(false)
  })
})

describe('copyFromPlatform', () => {
  it('creates a private, UNVERIFIED copy with provenance, and never copies twice', async () => {
    const { repo, client } = seeded()
    const plat = (await repo.getById('plat1', PLATFORM))
    const first = await repo.copyFromPlatform(A, { ...plat, phone: '0803', origin: 'platform', distance_km: 3, id: 'plat1' }, 'me@x.co')
    expect(first.alreadyHad).toBe(false)
    const copy = client.rows('directory_businesses').find((r) => r.source_detail === 'platform:plat1')
    expect(copy).toMatchObject({ business_id: A, data_source: 'external', verification_status: 'unverified', created_by: 'me@x.co', phone: '0803' })
    expect(copy.id).not.toBe('plat1')
    expect(copy.origin).toBeUndefined() // UI-only fields never reach the database
    expect(copy.distance_km).toBeUndefined()
    const again = await repo.copyFromPlatform(A, plat, 'me@x.co')
    expect(again.alreadyHad).toBe(true)
    expect(client.rows('directory_businesses').filter((r) => r.source_detail === 'platform:plat1')).toHaveLength(1)
    // the platform record itself is untouched
    expect(client.rows('directory_businesses').find((r) => r.id === 'plat1').business_id).toBeNull()
  })
  it('another company can copy the same platform business independently', async () => {
    const { repo, client } = seeded()
    const plat = await repo.getById('plat1', PLATFORM)
    await repo.copyFromPlatform(A, plat)
    await repo.copyFromPlatform(B, plat)
    expect(client.rows('directory_businesses').filter((r) => r.source_detail === 'platform:plat1').map((r) => r.business_id).sort()).toEqual([A, B])
  })
})

describe('searchBusinesses with the platform registry', () => {
  const center = { lat: 6.5, lng: 3.4 }
  it('merges own and platform results, tagging each with its origin', async () => {
    const { repo } = seeded()
    const out = await searchBusinesses(repo, A, { center, radiusKm: 5, includePlatform: true })
    expect(Object.fromEntries(out.results.map((r) => [r.id, r.origin]))).toEqual({ own1: 'own', plat1: 'platform', plat2: 'platform' })
    expect(out.platformUnavailable).toBe(false)
  })
  it('is own-only unless asked', async () => {
    const { repo } = seeded()
    const out = await searchBusinesses(repo, A, { center, radiusKm: 5 })
    expect(out.results.map((r) => r.id)).toEqual(['own1'])
  })
  it('shows a copied platform business once, as the company\'s own record', async () => {
    const { repo } = seeded()
    const { copy } = await repo.copyFromPlatform(A, await repo.getById('plat1', PLATFORM))
    await repo.setActive(copy.id, A, true) // the in-memory table has no `is_active DEFAULT true` like Postgres
    const out = await searchBusinesses(repo, A, { center, radiusKm: 5, includePlatform: true })
    const names = out.results.map((r) => r.id + ':' + r.origin)
    expect(names.filter((n) => n.startsWith('plat1'))).toEqual([]) // the platform duplicate is hidden
    expect(out.results.filter((r) => r.source_detail === 'platform:plat1')).toHaveLength(1)
    expect(out.results.find((r) => r.source_detail === 'platform:plat1').origin).toBe('own')
    expect(out.results.some((r) => r.id === 'plat2')).toBe(true)
  })
  it('an inactive or filter-hidden copy still suppresses the platform duplicate', async () => {
    const { repo, client } = seeded()
    const { copy } = await repo.copyFromPlatform(A, await repo.getById('plat1', PLATFORM))
    await repo.setActive(copy.id, A, false)
    const out = await searchBusinesses(repo, A, { center, radiusKm: 5, includePlatform: true })
    expect(out.results.map((r) => r.id)).not.toContain('plat1')
    expect(client.rows('directory_businesses').find((r) => r.id === copy.id).is_active).toBe(false)
  })
  it('getPlatformCopyIds is tenant-scoped', async () => {
    const { repo } = seeded()
    await repo.copyFromPlatform(A, await repo.getById('plat1', PLATFORM))
    await repo.copyFromPlatform(B, await repo.getById('plat2', PLATFORM))
    expect([...await repo.getPlatformCopyIds(A)]).toEqual(['plat1'])
    expect([...await repo.getPlatformCopyIds(B)]).toEqual(['plat2'])
  })
  it('a failing platform lookup never takes down the company\'s own results', async () => {
    const { repo } = seeded()
    const flaky = { ...repo, searchWithinBox: async (id, ...a) => { if (id === PLATFORM) throw new Error('boom'); return repo.searchWithinBox(id, ...a) } }
    const out = await searchBusinesses(flaky, A, { center, radiusKm: 5, includePlatform: true })
    expect(out.results.map((r) => r.id)).toEqual(['own1'])
    expect(out.platformUnavailable).toBe(true)
  })
  it('works for place-name and no-location searches too', async () => {
    const { repo } = seeded()
    const out = await searchBusinesses(repo, A, { includePlatform: true })
    expect(out.mode).toBe('filters')
    expect(out.results.map((r) => r.origin).sort()).toEqual(['own', 'platform', 'platform'])
  })
  it('only ever reads', async () => {
    const methods = []
    const repo = createDirectoryRepository(async (p, o) => { methods.push(o?.method || 'GET'); return [] })
    await searchBusinesses(repo, A, { center, radiusKm: 3, includePlatform: true })
    expect(new Set(methods)).toEqual(new Set(['GET']))
  })
})

describe('platform import', () => {
  it('batch is recorded under the admin\'s company; rows land in the platform registry', async () => {
    const client = createInMemoryClient({ directory_businesses: [], directory_subcategories: [], directory_import_batches: [] })
    const repo = createDirectoryRepository(client)
    const items = await analyseImport([{ name: 'Registry Pharmacy', category: 'Pharmacy', address: '1 Road', state: 'Lagos' }], {
      categories: [{ id: 'c-ph', name: 'Pharmacy' }], subcategories: [], existing: [],
    })
    items.forEach((i) => { i.resolution = RESOLUTION.IMPORT_NEW })
    const out = await commitImport({ items, repo, businessId: 'admin-biz', scope: PLATFORM, createdBy: 'admin@x.co' })
    expect(out.imported).toBe(1)
    expect(client.rows('directory_businesses')[0]).toMatchObject({ business_id: null, name: 'Registry Pharmacy' })
    expect(client.rows('directory_import_batches')[0].business_id).toBe('admin-biz')
  })
})

describe('export label', () => {
  it('platform results are labelled as such', () => {
    expect(toExportRow({ name: 'x', origin: 'platform', data_source: 'manual' }).source).toBe('Platform registry')
    expect(toExportRow({ name: 'x', origin: 'own', data_source: 'import' }).source).toBe('import')
  })
})
