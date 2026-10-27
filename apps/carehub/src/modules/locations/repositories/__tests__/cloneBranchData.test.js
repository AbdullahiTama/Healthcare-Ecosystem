import { describe, it, expect, vi } from 'vitest'
import { createLocationsRepository } from '../index.js'

// A new branch gets its main business's catalogue and roles copied in. A copy that partly fails used to be swallowed,
// leaving staff without their roles and the shelf half-empty with nobody told. Since carehub_20261215 the catalogue is
// carried by id in a few bulk calls (carry_master_items) instead of one call per product.

const MISSING_FN = 'Supabase error (404): Could not find the function public.carry_master_items in the schema cache'

function backend({ failChunks = [], failRoles = false, masters = 3, roles = 2, upgraded = true, failProducts = [] } = {}) {
  const calls = []
  const request = vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    if (path.startsWith('master_products?')) {
      if (!upgraded && path.includes('archived_at')) throw new Error('Supabase error (400): column master_products.archived_at does not exist')
      const offset = Number(/offset=(\d+)/.exec(path)?.[1] || 0)
      return Array.from({ length: Math.max(0, Math.min(1000, masters - offset)) }, (_, i) => ({ id: 'm' + (offset + i) }))
    }
    if (path === 'rpc/carry_master_items') {
      if (!upgraded) throw new Error(MISSING_FN)
      const ids = JSON.parse(opts.body).p_master_ids
      if (failChunks.includes(ids[0])) throw new Error('Supabase error (400): plan limit')
      return ids.length
    }
    if (path === 'rpc/activate_branch_product') {
      if (failProducts.includes(JSON.parse(opts.body).p_master_product_id)) throw new Error('Supabase error (400): product inactive')
      return null
    }
    if (path.startsWith('roles?')) return Array.from({ length: roles }, (_, i) => ({ name: 'Role ' + i, permissions: { nav: [] } }))
    if (path === 'roles') { if (failRoles) throw new Error('Supabase error (403): denied'); return null }
    return []
  })
  return { calls, repo: createLocationsRepository(request) }
}

describe('cloneBranchData', () => {
  it('carries every live master item and copies every role into the branch', async () => {
    const { repo, calls } = backend()
    await repo.cloneBranchData('root', 'new')
    expect(calls.find((c) => c.path.startsWith('master_products?')).path).toContain('archived_at=is.null')
    expect(calls.filter((c) => c.path === 'rpc/carry_master_items').map((c) => c.body)).toEqual([
      { p_branch_id: 'new', p_master_ids: ['m0', 'm1', 'm2'], p_price: null },
    ])
    expect(calls.find((c) => c.path === 'roles' && c.method === 'POST').body).toEqual([
      { business_id: 'new', name: 'Role 0', permissions: { nav: [] } },
      { business_id: 'new', name: 'Role 1', permissions: { nav: [] } },
    ])
  })

  it('a large catalogue goes in calls of 500 items, past the 1000-row page limit', async () => {
    const { repo, calls } = backend({ masters: 1203 })
    await repo.cloneBranchData('root', 'new')
    expect(calls.filter((c) => c.path === 'rpc/carry_master_items').map((c) => c.body.p_master_ids.length)).toEqual([500, 500, 203])
  })

  it('when a call fails, the roles are still copied and the failure is reported with a count', async () => {
    const { repo, calls } = backend({ masters: 1203, failChunks: ['m500'] })
    await expect(repo.cloneBranchData('root', 'new')).rejects.toThrow('500 of 1203 products could not be copied')
    expect(calls.some((c) => c.path === 'roles' && c.method === 'POST')).toBe(true)
  })

  it('when the roles fail, that is reported too', async () => {
    const { repo } = backend({ failRoles: true })
    await expect(repo.cloneBranchData('root', 'new')).rejects.toThrow(/roles could not be copied/)
  })

  it('before the catalogue migration, falls back to one activation per item', async () => {
    const { repo, calls } = backend({ upgraded: false, failProducts: ['m1'] })
    await expect(repo.cloneBranchData('root', 'new')).rejects.toThrow('3 of 3 products could not be copied')
    expect(calls.filter((c) => c.path === 'rpc/activate_branch_product').map((c) => c.body.p_master_product_id)).toEqual(['m0', 'm1'])
  })
})
