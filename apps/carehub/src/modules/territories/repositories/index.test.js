import { describe, it, expect } from 'vitest'
import { createTerritoryRepository, territoryRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    territories: [
      { id: 't1', business_id: A, name: 'South West', level: 'Region', parent_territory_id: null },
      { id: 't2', business_id: A, name: 'Lagos', level: 'State', parent_territory_id: 't1' },
      { id: 't9', business_id: B, name: 'Other tenant region', level: 'Region', parent_territory_id: null },
    ],
    rep_territories: [
      { id: 'r1', staff_id: 's1', territory_id: 't1' },
      { id: 'r2', staff_id: 's2', territory_id: 't2' },
      { id: 'r9', staff_id: 's9', territory_id: 't9' },
    ],
  })
  return { client, repo: createTerritoryRepository(client) }
}

const terr = (client, id) => client.rows('territories').find((r) => r.id === id)

function recording(returns = []) {
  const calls = []
  const repo = createTerritoryRepository(async (path, options) => {
    calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
    return returns
  })
  return { calls, repo }
}

describe('territoryRepository', () => {
  describe('territories', () => {
    it('getAll returns only the calling tenant', async () => {
      const { repo } = seeded()
      const rows = await repo.getAll(A)
      expect(rows.map((r) => r.id).sort()).toEqual(['t1', 't2'])
    })

    it('create injects business_id and keeps the parent link', async () => {
      const { repo, client } = seeded()
      await repo.create(A, { name: 'Ikeja', level: 'City', parent_territory_id: 't2' })
      const created = client.rows('territories').find((r) => r.name === 'Ikeja')
      expect(created).toMatchObject({ business_id: A, parent_territory_id: 't2' })
    })

    // ── Bulk import (CSV upload) — same contract as clients.createMany ────────
    it('createMany inserts every row with the tenant stamped', async () => {
      const { repo, client } = seeded()
      const result = await repo.createMany(A, [
        { name: 'Ikeja', level: 'City', parent_territory_id: 't2' },
        { name: 'Ibadan', level: 'City', parent_territory_id: null },
      ])
      expect(result).toEqual({ added: 2, skipped: 0, failed: [] })
      expect(client.rows('territories').filter((r) => r.name === 'Ikeja' || r.name === 'Ibadan'))
        .toEqual([
          expect.objectContaining({ name: 'Ikeja', business_id: A }),
          expect.objectContaining({ name: 'Ibadan', business_id: A }),
        ])
    })

    it('createMany captures per-row failures without losing the rest', async () => {
      let n = 0
      const repo = createTerritoryRepository(async (path, options) => {
        n++
        if (n === 1) throw new Error('network blip')
        return []
      })
      const result = await repo.createMany(A, [
        { name: 'Broken' },
        { name: 'Fine' },
      ])
      expect(result.added).toBe(1)
      expect(result.failed).toEqual([{ name: 'Broken', message: 'network blip' }])
    })

    it('createMany is a no-op for an empty list (issues no request)', async () => {
      let called = false
      const repo = createTerritoryRepository(async () => { called = true; return [] })
      const result = await repo.createMany(A, [])
      expect(result).toEqual({ added: 0, skipped: 0, failed: [] })
      expect(called).toBe(false)
    })

    it('createMany counts a server duplicate as skipped, not failed', async () => {
      const repo = createTerritoryRepository(async () => {
        throw new Error('Supabase error (409): duplicate key value violates unique constraint')
      })
      const result = await repo.createMany(A, [{ name: 'South West' }])
      expect(result).toEqual({ added: 0, skipped: 1, failed: [] })
    })

    it('update scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.update('t2', A, { name: 'Lagos State' })
      expect(terr(client, 't2').name).toBe('Lagos State')
      expect(terr(client, 't1').name).toBe('South West')
    })

    it('update never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.update('t9', A, { name: 'Hijacked' })
      expect(terr(client, 't9').name).toBe('Other tenant region')
    })

    it('delete scopes by id and business', async () => {
      const { repo, client } = seeded()
      await repo.delete('t2', A, 'Lagos')
      expect(client.rows('territories').map((r) => r.id)).not.toContain('t2')
    })

    it('delete never crosses the tenant boundary', async () => {
      const { repo, client } = seeded()
      await repo.delete('t9', A, 'Other tenant region')
      expect(client.rows('territories').map((r) => r.id)).toContain('t9')
    })
  })

  // rep_territories has no business_id — RLS derives tenancy through the
  // parent territory, so the territory is the boundary this repository uses.
  describe('rep assignments', () => {
    it('getAssignments returns only rows for the territories asked for', async () => {
      const { repo } = seeded()
      const rows = await repo.getAssignments(['t1', 't2'])
      expect(rows.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
      expect(rows.some((r) => r.territory_id === 't9')).toBe(false)
    })

    it('getAssignments embeds the rep so the page needs no second lookup', async () => {
      const { calls, repo } = recording()
      await repo.getAssignments(['t1'])
      expect(calls[0].path).toContain('staff:staff_id(id,full_name,public_title)')
    })

    // An unscoped `in.()` is a malformed PostgREST request, so this must not
    // reach the network at all.
    it('getAssignments is a no-op for an empty or missing territory list', async () => {
      const { calls, repo } = recording()
      expect(await repo.getAssignments([])).toEqual([])
      expect(await repo.getAssignments(null)).toEqual([])
      expect(await repo.getAssignments(undefined)).toEqual([])
      expect(calls).toHaveLength(0)
    })

    it('assignRep writes the join row', async () => {
      const { repo, client } = seeded()
      await repo.assignRep('s3', 't1')
      expect(client.rows('rep_territories').some((r) => r.staff_id === 's3' && r.territory_id === 't1')).toBe(true)
    })

    it('unassignRep removes the assignment', async () => {
      const { repo, client } = seeded()
      await repo.unassignRep('r1', 't1')
      expect(client.rows('rep_territories').map((r) => r.id)).not.toContain('r1')
    })

    it('unassignRep is scoped by the parent territory, not the row id alone', async () => {
      const { repo, client } = seeded()
      // r9 belongs to another tenant's territory; deleting it under t1's scope
      // must match nothing.
      await repo.unassignRep('r9', 't1')
      expect(client.rows('rep_territories').map((r) => r.id)).toContain('r9')
    })
  })

  describe('delete failure messages', () => {
    const failingWith = (constraint) =>
      createTerritoryRepository(async () => {
        throw new Error(`Supabase error (409): update or delete on table "territories" violates foreign key constraint "${constraint}" on table "x"`)
      })

    // The reachable one: assigning a rep is a normal action on this very page,
    // and it silently makes the territory undeletable.
    it('explains a territory that still has reps assigned', async () => {
      await expect(failingWith('rep_territories_territory_id_fkey').delete('t1', A, 'South West'))
        .rejects.toThrow('"South West" has reps assigned to it. Unassign them first.')
    })

    it('explains a territory with orders against it', async () => {
      await expect(failingWith('orders_territory_id_fkey').delete('t1', A, 'Lagos'))
        .rejects.toThrow('"Lagos" has orders raised against it.')
    })

    it('explains a territory held by field activity history', async () => {
      await expect(failingWith('field_activities_territory_id_fkey').delete('t1', A, 'Lagos'))
        .rejects.toThrow('audit record')
    })

    it('rethrows an unrecognised error untouched', async () => {
      const repo = createTerritoryRepository(async () => { throw new Error('NetworkError: connection reset') })
      await expect(repo.delete('t1', A, 'Lagos')).rejects.toThrow('NetworkError: connection reset')
    })
  })

  it('exports a default territoryRepository instance', () => {
    for (const m of ['getAll', 'create', 'update', 'delete', 'getAssignments', 'assignRep', 'unassignRep']) {
      expect(typeof territoryRepository[m]).toBe('function')
    }
  })
})
