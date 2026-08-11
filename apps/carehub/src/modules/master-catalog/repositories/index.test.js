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
})
