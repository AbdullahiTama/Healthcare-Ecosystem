import { describe, it, expect, vi } from 'vitest'
import { createLocationsRepository } from '../index.js'

// A new branch gets its main business's catalogue and roles copied in. A copy that partly fails used to be swallowed,
// leaving staff without their roles and the shelf half-empty with nobody told.

function backend({ failProducts = [], failRoles = false, masters = 3, roles = 2 } = {}) {
  const calls = []
  const request = vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    if (path.startsWith('master_products?')) return Array.from({ length: masters }, (_, i) => ({ id: 'm' + i }))
    if (path === 'rpc/activate_branch_product') {
      const id = JSON.parse(opts.body).p_master_product_id
      if (failProducts.includes(id)) throw new Error('Supabase error (400): product inactive')
      return null
    }
    if (path.startsWith('roles?')) return Array.from({ length: roles }, (_, i) => ({ name: 'Role ' + i, permissions: { nav: [] } }))
    if (path === 'roles') { if (failRoles) throw new Error('Supabase error (403): denied'); return null }
    return []
  })
  return { calls, repo: createLocationsRepository(request) }
}

describe('cloneBranchData', () => {
  it('copies every product and every role into the branch', async () => {
    const { repo, calls } = backend()
    await repo.cloneBranchData('root', 'new')
    expect(calls.filter((c) => c.path === 'rpc/activate_branch_product').map((c) => c.body)).toEqual([
      { p_branch_id: 'new', p_master_product_id: 'm0', p_override_price: null },
      { p_branch_id: 'new', p_master_product_id: 'm1', p_override_price: null },
      { p_branch_id: 'new', p_master_product_id: 'm2', p_override_price: null },
    ])
    expect(calls.find((c) => c.path === 'roles' && c.method === 'POST').body).toEqual([
      { business_id: 'new', name: 'Role 0', permissions: { nav: [] } },
      { business_id: 'new', name: 'Role 1', permissions: { nav: [] } },
    ])
  })

  it('when some products fail, the roles are still copied and the failure is reported with a count', async () => {
    const { repo, calls } = backend({ failProducts: ['m1'] })
    await expect(repo.cloneBranchData('root', 'new')).rejects.toThrow('1 of 3 products could not be copied')
    expect(calls.some((c) => c.path === 'roles' && c.method === 'POST')).toBe(true)
  })

  it('when the roles fail, that is reported too', async () => {
    const { repo } = backend({ failRoles: true })
    await expect(repo.cloneBranchData('root', 'new')).rejects.toThrow(/roles could not be copied/)
  })

  it('a large catalogue is copied a few at a time, not all at once', async () => {
    let inFlight = 0
    let peak = 0
    const request = vi.fn(async (path) => {
      if (path.startsWith('master_products?')) return Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i }))
      if (path === 'rpc/activate_branch_product') {
        inFlight++; peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        inFlight--
        return null
      }
      return []
    })
    await createLocationsRepository(request).cloneBranchData('root', 'new')
    expect(peak).toBeLessThanOrEqual(10)
    expect(request.mock.calls.filter((c) => c[0] === 'rpc/activate_branch_product')).toHaveLength(40)
  })
})
