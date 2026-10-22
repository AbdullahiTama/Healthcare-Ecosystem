import { describe, it, expect } from 'vitest'
import { createDirectoryRepository, PLATFORM } from '../repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'
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
