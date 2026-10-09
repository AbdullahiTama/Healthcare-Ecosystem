import { describe, it, expect } from 'vitest'
import { createDirectoryRepository } from '../repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    directory_categories: [
      { id: 'c-ph', business_id: null, name: 'Pharmacy', is_active: true, sort_order: 10 },
      { id: 'c-own', business_id: A, name: 'Veterinary Pharmacy', is_active: true, sort_order: 1000 },
      { id: 'c-other', business_id: B, name: 'Other tenant category', is_active: true, sort_order: 1000 },
    ],
    directory_businesses: [
      { id: 'd1', business_id: A, name: 'Alpha Pharmacy', name_normalized: 'alpha pharmacy', city: 'Yaba', state: 'Lagos', category_id: 'c-ph', is_active: true, latitude: 6.5, longitude: 3.4, verification_status: 'verified', data_source: 'manual' },
      { id: 'd2', business_id: A, name: 'Beta Clinic', name_normalized: 'beta clinic', city: 'Ikeja', state: 'Lagos', category_id: 'c-own', is_active: false, latitude: 6.6, longitude: 3.35, verification_status: 'unverified', data_source: 'import' },
      { id: 'd3', business_id: A, name: 'Far Away Pharmacy', name_normalized: 'far away pharmacy', state: 'Kano', category_id: 'c-ph', is_active: true, latitude: 12, longitude: 8.5, verification_status: 'unverified', data_source: 'import' },
      { id: 'x1', business_id: B, name: 'Other Tenant Pharmacy', name_normalized: 'other tenant pharmacy', state: 'Lagos', category_id: 'c-ph', is_active: true, latitude: 6.5, longitude: 3.4, verification_status: 'verified', data_source: 'manual' },
    ],
  })
  return { client, repo: createDirectoryRepository(client) }
}

describe('directoryRepository — tenancy', () => {
  it('categories: built-ins plus own, never another tenant\'s', async () => {
    const { repo } = seeded()
    const names = (await repo.getCategories(A)).map((c) => c.name).sort()
    expect(names).toEqual(['Pharmacy', 'Veterinary Pharmacy'])
  })

  it('list never returns another tenant\'s rows', async () => {
    const { repo } = seeded()
    const rows = await repo.list(A, { active: 'all' })
    expect(rows.map((r) => r.id).sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('getById is tenant-scoped', async () => {
    const { repo } = seeded()
    expect(await repo.getById('x1', A)).toBeNull()
    expect((await repo.getById('d1', A)).name).toBe('Alpha Pharmacy')
  })

  it('update cannot touch another tenant\'s record', async () => {
    const { repo, client } = seeded()
    await repo.update('x1', A, { description: 'hijack' })
    expect(client.rows('directory_businesses').find((r) => r.id === 'x1').description).toBeUndefined()
  })

  it('dedup index rows include deactivated records and exclude other tenants', async () => {
    const { repo } = seeded()
    const ids = (await repo.getDedupIndexRows(A)).map((r) => r.id).sort()
    expect(ids).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('directoryRepository — filters', () => {
  it('defaults to active only; inactive is explicit', async () => {
    const { repo } = seeded()
    expect((await repo.list(A)).map((r) => r.id).sort()).toEqual(['d1', 'd3'])
    expect((await repo.list(A, { active: 'inactive' })).map((r) => r.id)).toEqual(['d2'])
  })

  it('category, state and verification filters combine', async () => {
    const { repo } = seeded()
    expect((await repo.list(A, { categoryId: 'c-ph', state: 'Lagos', verification: 'verified' })).map((r) => r.id)).toEqual(['d1'])
  })

  it('free-text search matches name or city, case-insensitively', async () => {
    const { repo } = seeded()
    expect((await repo.list(A, { search: 'yaba' })).map((r) => r.id)).toEqual(['d1'])
    expect((await repo.list(A, { search: 'FAR AWAY' })).map((r) => r.id)).toEqual(['d3'])
  })

  it('search text cannot smuggle extra PostgREST filters', async () => {
    const paths = []
    const repo = createDirectoryRepository(async (p) => { paths.push(p); return [] })
    await repo.list(A, { search: 'x),business_id.neq.' + A + ',(y' })
    // Delimiters are stripped, so the text stays inside the ilike pattern: exactly the
    // five intended clauses, and the tenant filter is untouched.
    const group = paths[0].match(/or=\((.*?)\)&/)[1]
    expect(group.split(',')).toHaveLength(5)
    expect(group.split(',').every((c) => /^(name|address|phone|city|lga)\.ilike\./.test(c))).toBe(true)
    expect(paths[0]).toContain(`business_id=eq.${A}&`)
  })

  it('radius candidates come from a bounding box, scoped to the tenant, active only', async () => {
    const { repo } = seeded()
    const rows = await repo.searchWithinBox(A, { lat: 6.5, lng: 3.4, radiusKm: 5 })
    expect(rows.map((r) => r.id)).toEqual(['d1']) // d2 inactive, d3 far, x1 other tenant
  })

  it('place-name fallback matches state/LGA/city text', async () => {
    const { repo } = seeded()
    expect((await repo.searchByPlaceName(A, 'ikeja')).map((r) => r.id)).toEqual([]) // d2 inactive
    expect((await repo.searchByPlaceName(A, 'kano')).map((r) => r.id)).toEqual(['d3'])
  })
})

describe('directoryRepository — writes', () => {
  it('create injects the tenant, derives normalised columns and strips server-owned fields', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { name: 'Gamma Pharmacy Ltd', phone: '+234 803 111 2222', website: 'https://www.gamma.ng/x', address: '5 Main St', id: 'evil', verified_at: 'x', business_id: B }, 'me@x.co')
    const row = client.rows('directory_businesses').find((r) => r.name === 'Gamma Pharmacy Ltd')
    expect(row).toMatchObject({ business_id: A, name_normalized: 'gamma pharmacy', phone_normalized: '08031112222', website_host: 'gamma.ng', address_normalized: '5 main street', created_by: 'me@x.co' })
    expect(row.id).not.toBe('evil')
    expect(row.verified_at).toBeUndefined()
  })

  it('update re-derives only the normalised columns for the fields it changes', async () => {
    const { repo, client } = seeded()
    await repo.update('d1', A, { name: 'Alpha Pharmacy Plus Limited' })
    const row = client.rows('directory_businesses').find((r) => r.id === 'd1')
    expect(row.name_normalized).toBe('alpha pharmacy plus')
    expect(row.phone_normalized).toBeUndefined()
  })

  it('deactivate/reactivate and verification go through update', async () => {
    const { repo, client } = seeded()
    await repo.setActive('d1', A, false)
    await repo.setVerification('d3', A, 'verified')
    const rows = client.rows('directory_businesses')
    expect(rows.find((r) => r.id === 'd1').is_active).toBe(false)
    expect(rows.find((r) => r.id === 'd3').verification_status).toBe('verified')
  })

  it('insertMany stamps the batch and tenant on every row', async () => {
    const { repo, client } = seeded()
    await repo.insertMany(A, 'batch-1', [{ name: 'One' }, { name: 'Two', data_source: 'import' }])
    const added = client.rows('directory_businesses').filter((r) => r.import_batch_id === 'batch-1')
    expect(added).toHaveLength(2)
    expect(added.every((r) => r.business_id === A && r.data_source === 'import')).toBe(true)
  })

  it('ensureSubcategory finds before it creates', async () => {
    const { repo, client } = seeded()
    const a = await repo.ensureSubcategory(A, 'c-ph', 'Community Pharmacy')
    const b = await repo.ensureSubcategory(A, 'c-ph', 'community pharmacy')
    expect(b.id).toBe(a.id)
    expect(client.rows('directory_subcategories')).toHaveLength(1)
  })
})

describe('directoryRepository — paging', () => {
  it('probe fetches one extra row so callers can detect a next page', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, business_id: A, name: 'n' + i, is_active: true }))
    const repo = createDirectoryRepository(createInMemoryClient({ directory_businesses: rows }))
    expect((await repo.list(A, {}, { page: 0, pageSize: 2, probe: true })).map((r) => r.id)).toEqual(['r0', 'r1', 'r2'])
    expect((await repo.list(A, {}, { page: 2, pageSize: 2, probe: true })).map((r) => r.id)).toEqual(['r4'])
  })
})
