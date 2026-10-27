import { describe, it, expect } from 'vitest'
import { createMasterCatalogRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const PARENT = 'biz-PARENT'
const BRANCH = 'biz-BRANCH'
const OTHER = 'biz-OTHER'

// Builds a repository wired to the in-memory transport, so every assertion is
// about the repository's own query shape and tenant scoping — never the
// network.
function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createMasterCatalogRepository(client) }
}

// The in-memory adapter does not speak rpc/ paths, so RPC call shapes are
// asserted with a recording adapter: each call's path, method, and body are
// captured for the test to inspect.
function recordingRepo() {
  const calls = []
  const repo = createMasterCatalogRepository(async (path, options) => {
    calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
    return []
  })
  return { calls, repo }
}

describe('masterCatalogRepository', () => {
  describe('master product reads', () => {
    it('getAll returns only the calling tenant', async () => {
      const { repo } = build({
        master_products: [
          { id: 'm1', business_id: PARENT, name: 'Paracetamol' },
          { id: 'm9', business_id: OTHER, name: 'Other biz product' },
        ],
      })
      const rows = await repo.getAll(PARENT)
      expect(rows.map((r) => r.name)).toEqual(['Paracetamol'])
    })

    // A getById that filtered only on id would leak another tenant's master
    // product the moment a uuid was known. The foreign row with the SAME id is
    // seeded first, so an id-only filter would return it.
    it('getById is scoped to the tenant', async () => {
      const { repo } = build({
        master_products: [
          { id: 'm1', business_id: OTHER, name: 'Other biz product' },
          { id: 'm1', business_id: PARENT, name: 'Paracetamol' },
          { id: 'm9', business_id: OTHER, name: 'Foreign' },
        ],
      })
      expect((await repo.getById('m1', PARENT)).name).toBe('Paracetamol')
      expect(await repo.getById('m9', PARENT)).toBe(null)
    })

    it('getLinks filters by the branch, not the tenant', async () => {
      const { repo } = build({
        branch_products: [
          { id: 'l1', branch_id: BRANCH, master_product_id: 'm1', active: true },
          { id: 'l2', branch_id: OTHER, master_product_id: 'm1', active: true },
        ],
      })
      const rows = await repo.getLinks(BRANCH)
      expect(rows.map((r) => r.id)).toEqual(['l1'])
    })
  })

  describe('master product writes', () => {
    it('create stamps the tenant onto the new row', async () => {
      const { repo, client } = build()
      await repo.create(PARENT, { name: 'Paracetamol', default_price: 500 })
      expect(client.rows('master_products')[0]).toMatchObject({
        name: 'Paracetamol',
        default_price: 500,
        business_id: PARENT,
      })
    })

    it('update is scoped to the tenant', async () => {
      const { repo, client } = build({
        master_products: [
          { id: 'm1', business_id: PARENT, name: 'Paracetamol' },
          { id: 'm9', business_id: OTHER, name: 'Other biz product' },
        ],
      })
      await repo.update('m1', PARENT, { name: 'Paracetamol 500mg' })
      await repo.update('m9', PARENT, { name: 'hacked' }) // wrong tenant — must no-op

      const byId = Object.fromEntries(client.rows('master_products').map((m) => [m.id, m]))
      expect(byId['m1'].name).toBe('Paracetamol 500mg')
      expect(byId['m9'].name).toBe('Other biz product')
    })

    // remove is id AND tenant scoped, so one tenant can never delete another's
    // master row even with the id in hand.
    it('remove is scoped to the tenant', async () => {
      const { repo, client } = build({
        master_products: [
          { id: 'm1', business_id: PARENT, name: 'Paracetamol' },
          { id: 'm9', business_id: OTHER, name: 'Other biz product' },
        ],
      })
      await repo.remove('m9', PARENT) // wrong tenant — must not delete
      await repo.remove('m1', PARENT)

      const rows = client.rows('master_products')
      expect(rows.map((r) => r.id)).toEqual(['m9'])
    })
  })

  describe('activation RPCs', () => {
    it('activate posts to rpc/activate_branch_product with the expected body', async () => {
      const { calls, repo } = recordingRepo()
      await repo.activate(BRANCH, 'm1', 750)
      expect(calls).toEqual([
        {
          path: 'rpc/activate_branch_product',
          method: 'POST',
          body: { p_branch_id: BRANCH, p_master_product_id: 'm1', p_override_price: 750 },
        },
      ])
    })

    it('activate passes null override when none is given', async () => {
      const { calls, repo } = recordingRepo()
      await repo.activate(BRANCH, 'm1', null)
      expect(calls[0].body.p_override_price).toBe(null)
    })

    it('deactivate posts to rpc/deactivate_branch_product', async () => {
      const { calls, repo } = recordingRepo()
      await repo.deactivate(BRANCH, 'm1')
      expect(calls).toEqual([
        {
          path: 'rpc/deactivate_branch_product',
          method: 'POST',
          body: { p_branch_id: BRANCH, p_master_product_id: 'm1' },
        },
      ])
    })

    it('push posts to rpc/push_master_product with the tenant', async () => {
      const { calls, repo } = recordingRepo()
      await repo.push('m1', PARENT)
      expect(calls).toEqual([
        {
          path: 'rpc/push_master_product',
          method: 'POST',
          body: { p_master_product_id: 'm1', p_business_id: PARENT },
        },
      ])
    })
  })

  describe('catalogue screen (carehub_20261215)', () => {
    const MISSING = (name) => new Error(`Supabase error (404): Could not find the function public.${name} in the schema cache`)

    it('getPage calls master_catalog_page with the filters and unwraps items, carried locations and the total', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getPage(PARENT, { search: 'amox', category: 'antibiotics', rx: 'prescription_only', offset: 50 })
      expect(calls[0]).toEqual({
        path: 'rpc/master_catalog_page', method: 'POST',
        body: { p_business_id: PARENT, p_search: 'amox', p_category: 'antibiotics', p_rx: 'prescription_only', p_archived: false, p_offset: 50, p_limit: 50 },
      })
      const repo2 = createMasterCatalogRepository(async () => [
        { item: { id: 'm1', name: 'Amoxil' }, carried: [{ branch_id: BRANCH, price: 1200 }], total: '61' },
      ])
      expect(await repo2.getPage(PARENT)).toEqual({ items: [{ id: 'm1', name: 'Amoxil', carried: [{ branch_id: BRANCH, price: 1200 }] }], total: 61, upgraded: true })
    })

    it('getPage before the migration: the plain tenant list, searched and paged here, without branch details', async () => {
      const request = async (path) => {
        if (path.startsWith('rpc/')) throw MISSING('master_catalog_page')
        return [{ id: 'm1', business_id: PARENT, name: 'Paracetamol' }, { id: 'm2', business_id: PARENT, name: 'Amoxil' }]
      }
      const repo = createMasterCatalogRepository(request)
      expect(await repo.getPage(PARENT, { search: 'amox' })).toEqual({ items: [{ id: 'm2', business_id: PARENT, name: 'Amoxil', carried: [] }], total: 1, upgraded: false })
      expect((await repo.getPage(PARENT, { archived: true })).items).toEqual([])
    })

    it('getPage passes any other failure on', async () => {
      const repo = createMasterCatalogRepository(async () => { throw new Error('Supabase error (500): boom') })
      await expect(repo.getPage(PARENT)).rejects.toThrow('boom')
    })

    it('getCategories reads the standard list in order; empty before the migration', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getCategories()
      expect(calls[0].path).toBe('product_categories?select=code,label,rx_default&order=sort.asc')
      const old = createMasterCatalogRepository(async () => { throw new Error('Supabase error (404): relation "public.product_categories" does not exist') })
      expect(await old.getCategories()).toEqual([])
    })

    it('carry sends every id in one call and returns the count', async () => {
      const calls = []
      const repo = createMasterCatalogRepository(async (path, o) => { calls.push({ path, body: JSON.parse(o.body) }); return 2 })
      expect(await repo.carry(BRANCH, ['m1', 'm2'], 1500)).toBe(2)
      expect(calls).toEqual([{ path: 'rpc/carry_master_items', body: { p_branch_id: BRANCH, p_master_ids: ['m1', 'm2'], p_price: 1500 } }])
      expect(await repo.carry(BRANCH, [])).toBe(0)
    })

    it('carry before the migration activates each item', async () => {
      const calls = []
      const repo = createMasterCatalogRepository(async (path, o) => {
        if (path === 'rpc/carry_master_items') throw MISSING('carry_master_items')
        calls.push(JSON.parse(o.body))
        return 'p'
      })
      expect(await repo.carry(BRANCH, ['m1', 'm2'], 999.6)).toBe(2)
      expect(calls).toEqual([
        { p_branch_id: BRANCH, p_master_product_id: 'm1', p_override_price: 1000 },
        { p_branch_id: BRANCH, p_master_product_id: 'm2', p_override_price: 1000 },
      ])
    })

    it('archive and restore are tenant-scoped updates of archived_at', async () => {
      const { repo, client } = build({
        master_products: [
          { id: 'm1', business_id: PARENT, name: 'Paracetamol', archived_at: null },
          { id: 'm9', business_id: OTHER, name: 'Theirs', archived_at: null },
        ],
      })
      await repo.archive('m1', PARENT)
      await repo.archive('m9', PARENT)
      const byId = () => Object.fromEntries(client.rows('master_products').map((m) => [m.id, m.archived_at]))
      expect(byId().m1).toBeTruthy()
      expect(byId().m9).toBeNull()
      await repo.restore('m1', PARENT)
      expect(byId().m1).toBeNull()
    })
  })
})
