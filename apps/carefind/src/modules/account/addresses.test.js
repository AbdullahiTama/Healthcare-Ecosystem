import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAddressesRepository } from './addressesRepository'

function createMockClient(initialRows = []) {
  const store = [...initialRows]

  const client = {
    _store: store,
    from: vi.fn(() => createQueryBuilder(store, client)),
    rpc: vi.fn((fn, params) => {
      if (fn === 'set_default_address') {
        const addr = store.find(r => r.id === params.p_address_id && !r.is_deleted)
        if (!addr) return Promise.resolve({ data: null, error: { message: 'Address not found' } })
        store.forEach(r => { if (r.user_id === addr.user_id && !r.is_deleted) r.is_default = false })
        addr.is_default = true
        return Promise.resolve({ data: 'ok', error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }),
  }
  return client
}

function createQueryBuilder(store, client) {
  let _filters = {}
  let _orders = []
  let _limit = null

  function getFiltered() {
    let rows = [...store]
    for (const [col, val] of Object.entries(_filters)) {
      rows = rows.filter(r => r[col] === val)
    }
    for (const { col, asc } of _orders) {
      rows.sort((a, b) => {
        const av = a[col], bv = b[col]
        if (av === bv) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return asc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
      })
    }
    if (_limit) rows = rows.slice(0, _limit)
    return rows
  }

  const builder = {}

  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((col, val) => { _filters[col] = val; return builder })
  builder.order = vi.fn((col, opts) => { _orders.push({ col, asc: opts?.ascending ?? true }); return builder })
  builder.limit = vi.fn((n) => { _limit = n; return builder })

  builder.maybeSingle = vi.fn(() => {
    const rows = getFiltered()
    return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null })
  })

  builder.single = vi.fn(() => {
    const rows = getFiltered()
    return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null })
  })

  builder.insert = vi.fn((row) => {
    const activeForUser = store.filter(r => r.user_id === row.user_id && !r.is_deleted)
    if (activeForUser.length >= 10) {
      const errBuilder = {}
      errBuilder.select = vi.fn(() => {
        const sb = {}
        sb.single = vi.fn(() => Promise.resolve({ data: null, error: { message: 'Maximum 10 addresses reached. Delete one to add another.' } }))
        return sb
      })
      return errBuilder
    }
    const hasDefault = activeForUser.some(r => r.is_default)
    const newRow = { id: `addr-${store.length + 1}`, is_deleted: false, country: 'Nigeria', is_default: !hasDefault, created_at: new Date().toISOString(), ...row }
    if (!hasDefault) newRow.is_default = true
    store.push(newRow)
    const insBuilder = {}
    insBuilder.select = vi.fn(() => {
      const sb = {}
      sb.single = vi.fn(() => Promise.resolve({ data: newRow, error: null }))
      return sb
    })
    return insBuilder
  })

  builder.update = vi.fn((fields) => {
    const updBuilder = {}
    updBuilder.eq = vi.fn((col, val) => {
      const target = store.find(r => r.id === val)
      if (target) Object.assign(target, fields)
      const eqBuilder = {}
      eqBuilder.select = vi.fn(() => {
        const sb = {}
        sb.single = vi.fn(() => Promise.resolve({ data: target ? { ...target } : null, error: null }))
        return sb
      })
      return eqBuilder
    })
    return updBuilder
  })

  builder.then = vi.fn((resolve) => {
    const rows = getFiltered()
    resolve({ data: rows, error: null })
  })

  return builder
}

describe('addressesRepository', () => {
  let repo, client

  beforeEach(() => {
    client = createMockClient()
    repo = createAddressesRepository(client)
  })

  describe('list', () => {
    it('returns non-deleted addresses for a user', async () => {
      client._store.push(
        { id: 'a1', user_id: 'u1', label: 'Home', street: '1 Main', city: 'Lagos', state: 'Lagos', is_deleted: false, is_default: true, created_at: '2026-01-01' },
        { id: 'a2', user_id: 'u1', label: 'Work', street: '2 Office', city: 'Abuja', state: 'FCT', is_deleted: false, is_default: false, created_at: '2026-01-02' },
        { id: 'a3', user_id: 'u1', label: 'Old', street: '3 Gone', city: 'Kano', state: 'Kano', is_deleted: true, is_default: false, created_at: '2025-12-01' },
      )
      const result = await repo.list('u1')
      expect(result).toHaveLength(2)
      expect(result.every(a => !a.is_deleted)).toBe(true)
    })
  })

  describe('create', () => {
    it('creates an address with structured fields', async () => {
      const addr = await repo.create({
        user_id: 'u1', label: 'Home', street: '1 Main St', city: 'Lagos', state: 'Lagos',
      })
      expect(addr).toBeDefined()
      expect(addr.street).toBe('1 Main St')
      expect(addr.city).toBe('Lagos')
      expect(addr.country).toBe('Nigeria')
    })

    it('first address is automatically marked as default by DB trigger', async () => {
      const addr = await repo.create({
        user_id: 'u1', label: 'Home', street: '1 Main St', city: 'Lagos', state: 'Lagos',
      })
      expect(addr.is_default).toBe(true)
    })

    it('throws max-10 error when limit reached', async () => {
      for (let i = 0; i < 10; i++) {
        client._store.push({ id: `a${i}`, user_id: 'u1', is_deleted: false, label: 'Home', street: `${i} St`, city: 'Lagos', state: 'Lagos' })
      }
      await expect(
        repo.create({ user_id: 'u1', label: 'Work', street: '11th', city: 'Abuja', state: 'FCT' })
      ).rejects.toThrow('Maximum 10 addresses reached')
    })
  })

  describe('remove (soft-delete)', () => {
    it('sets is_deleted to true instead of hard-deleting', async () => {
      client._store.push(
        { id: 'a1', user_id: 'u1', label: 'Home', street: '1 Main', city: 'Lagos', state: 'Lagos', is_deleted: false, is_default: true, created_at: '2026-01-01' },
      )
      await repo.remove('a1')
      const addr = client._store.find(r => r.id === 'a1')
      expect(addr.is_deleted).toBe(true)
    })

    it('reassigns default to next oldest address when default is deleted', async () => {
      client._store.push(
        { id: 'a1', user_id: 'u1', label: 'Home', street: '1 Main', city: 'Lagos', state: 'Lagos', is_deleted: false, is_default: true, created_at: '2026-01-01' },
        { id: 'a2', user_id: 'u1', label: 'Work', street: '2 Office', city: 'Abuja', state: 'FCT', is_deleted: false, is_default: false, created_at: '2026-01-02' },
      )
      await repo.remove('a1')
      expect(client.rpc).toHaveBeenCalledWith('set_default_address', { p_address_id: 'a2' })
    })

    it('does not call set_default_address RPC when deleting the only address', async () => {
      client._store.push(
        { id: 'a1', user_id: 'u1', label: 'Home', street: '1 Main', city: 'Lagos', state: 'Lagos', is_deleted: false, is_default: true, created_at: '2026-01-01' },
      )
      await repo.remove('a1')
      expect(client.rpc).not.toHaveBeenCalled()
      const addr = client._store.find(r => r.id === 'a1')
      expect(addr.is_deleted).toBe(true)
    })
  })

  describe('setDefault', () => {
    it('calls the set_default_address RPC', async () => {
      client._store.push(
        { id: 'a1', user_id: 'u1', is_deleted: false, is_default: true },
        { id: 'a2', user_id: 'u1', is_deleted: false, is_default: false },
      )
      await repo.setDefault('a2')
      expect(client.rpc).toHaveBeenCalledWith('set_default_address', { p_address_id: 'a2' })
    })
  })
})
