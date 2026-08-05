import { describe, it, expect } from 'vitest'
import { createStaffRepository, staffRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    staff: [
      { id: 's1', business_id: A, full_name: 'Ada', email: 'ada@a.test', status: 'active', show_on_carefind: false },
      { id: 's2', business_id: A, full_name: 'Bola', email: 'bola@a.test', status: 'inactive', show_on_carefind: true },
      { id: 's9', business_id: B, full_name: 'Other tenant', email: 'x@b.test', status: 'active' },
    ],
    roles: [
      { id: 'r1', business_id: A, name: 'Cashier', permissions: { canMakeSales: true } },
      { id: 'r9', business_id: B, name: 'Other tenant role', permissions: {} },
    ],
  })
  return { client, repo: createStaffRepository(client) }
}

const row = (client, table, id) => client.rows(table).find((r) => r.id === id)

function recording(returns = []) {
  const calls = []
  const repo = createStaffRepository(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
    return returns
  })
  return { calls, repo }
}

describe('staffRepository', () => {
  describe('staff', () => {
    it('getAll returns only the calling tenant', async () => {
      const { repo } = seeded()
      const rows = await repo.getAll(A)
      expect(rows.map((r) => r.id).sort()).toEqual(['s1', 's2'])
      expect(rows.some((r) => r.business_id === B)).toBe(false)
    })

    it('create injects business_id', async () => {
      const { repo, client } = seeded()
      await repo.create(A, { full_name: 'Chidi', email: 'chidi@a.test', status: 'active' })
      expect(client.rows('staff').find((r) => r.full_name === 'Chidi').business_id).toBe(A)
    })

    it('update scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.update('s1', A, { status: 'inactive' })
      expect(row(client, 'staff', 's1').status).toBe('inactive')
    })

    it('update leaves colleagues untouched', async () => {
      const { repo, client } = seeded()
      await repo.update('s1', A, { show_on_carefind: true })
      expect(row(client, 'staff', 's2').show_on_carefind).toBe(true) // unchanged from seed
      expect(row(client, 'staff', 's1').show_on_carefind).toBe(true)
    })

    it('update never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.update('s9', A, { status: 'inactive' })
      expect(row(client, 'staff', 's9').status).toBe('active')
    })

    it('delete scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.delete('s1', A, 'Ada')
      expect(client.rows('staff').map((r) => r.id)).not.toContain('s1')
    })

    it('delete never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.delete('s9', A, 'Other tenant')
      expect(client.rows('staff').map((r) => r.id)).toContain('s9')
    })
  })

  describe('roles', () => {
    it('getRoles returns only the calling tenant', async () => {
      const { repo } = seeded()
      const rows = await repo.getRoles(A)
      expect(rows.map((r) => r.id)).toEqual(['r1'])
    })

    it('createRole injects business_id and keeps the permission flags', async () => {
      const { repo, client } = seeded()
      await repo.createRole(A, { name: 'Supervisor', permissions: { canViewFinance: true } })
      const created = client.rows('roles').find((r) => r.name === 'Supervisor')
      expect(created).toMatchObject({ business_id: A, permissions: { canViewFinance: true } })
    })

    it('updateRole scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.updateRole('r1', A, { name: 'Senior Cashier' })
      expect(row(client, 'roles', 'r1').name).toBe('Senior Cashier')
    })

    // A role carries permission flags, so writing another tenant's role would
    // be a privilege change in their business.
    it('updateRole never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.updateRole('r9', A, { permissions: { canViewFinance: true } })
      expect(row(client, 'roles', 'r9').permissions).toEqual({})
    })

    it('deleteRole scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.deleteRole('r1', A)
      expect(client.rows('roles').map((r) => r.id)).not.toContain('r1')
    })

    it('deleteRole never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.deleteRole('r9', A)
      expect(client.rows('roles').map((r) => r.id)).toContain('r9')
    })
  })

  describe('claims', () => {
    // The previous query embedded staff WITHOUT !inner, so the business filter
    // constrained the embed instead of the claims — returning every pending
    // claim in the database with a null embed for other businesses'.
    it('getPendingClaims joins staff with !inner so the filter constrains the claims', async () => {
      const { calls, repo } = recording()
      await repo.getPendingClaims(A)
      expect(calls[0].path).toContain('staff!inner(')
      expect(calls[0].path).toContain(`staff.business_id=eq.${A}`)
      expect(calls[0].path).toContain('status=eq.pending')
    })

    it('decideClaim writes the status', async () => {
      const { calls, repo } = recording()
      await repo.decideClaim('c1', 'approved')
      expect(calls[0].path).toBe('staff_claims?id=eq.c1')
      expect(calls[0].method).toBe('PATCH')
      expect(calls[0].body).toEqual({ status: 'approved' })
    })

    it('decideClaim carries a rejection just the same', async () => {
      const { calls, repo } = recording()
      await repo.decideClaim('c1', 'rejected')
      expect(calls[0].body).toEqual({ status: 'rejected' })
    })
  })

  describe('delete failure messages', () => {
    const failingWith = (constraint) =>
      createStaffRepository(async () => {
        throw new Error(`Supabase error (409): update or delete on table "staff" violates foreign key constraint "${constraint}" on table "x"`)
      })

    it('explains a staff member assigned to a territory', async () => {
      await expect(failingWith('rep_territories_staff_id_fkey').delete('s1', A, 'Ada'))
        .rejects.toThrow('"Ada" is assigned to a territory. Unassign them in Territories first.')
    })

    it('explains a staff member who manages a warehouse', async () => {
      await expect(failingWith('enterprise_locations_manager_staff_id_fkey').delete('s1', A, 'Ada'))
        .rejects.toThrow('manages a warehouse')
    })

    // The common case: anyone who has actually used the system has records
    // that are kept, so the honest answer is "deactivate, do not delete".
    it('points at deactivation when the record is one that is kept', async () => {
      await expect(failingWith('orders_created_by_staff_id_fkey').delete('s1', A, 'Ada'))
        .rejects.toThrow('set to inactive but not deleted')
      await expect(failingWith('field_activities_staff_id_fkey').delete('s1', A, 'Ada'))
        .rejects.toThrow('Set the account to inactive instead.')
    })

    it('rethrows an unrecognised error untouched', async () => {
      const repo = createStaffRepository(async () => { throw new Error('NetworkError: connection reset') })
      await expect(repo.delete('s1', A, 'Ada')).rejects.toThrow('NetworkError: connection reset')
    })
  })

  it('exports a default staffRepository instance', () => {
    for (const m of ['getAll', 'create', 'update', 'delete', 'getRoles', 'createRole', 'updateRole', 'deleteRole', 'getPendingClaims', 'decideClaim']) {
      expect(typeof staffRepository[m]).toBe('function')
    }
  })
})
