import { describe, it, expect } from 'vitest'
import { createWarehouseRepository, warehouseRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    enterprise_locations: [
      { id: '1', business_id: A, name: 'Lagos HQ', location_type: 'Headquarters', parent_location_id: null },
      { id: '2', business_id: A, name: 'Ikeja Warehouse', location_type: 'Warehouse', parent_location_id: '1' },
      { id: '9', business_id: B, name: 'Other tenant hub', location_type: 'Warehouse', parent_location_id: null },
    ],
  })
  return { client, repo: createWarehouseRepository(client) }
}

const loc = (client, id) => client.rows('enterprise_locations').find((r) => r.id === id)

describe('warehouseRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { name: 'Abuja Hub', location_type: 'Distribution Hub' })
    expect(client.rows('enterprise_locations').find((r) => r.name === 'Abuja Hub').business_id).toBe(A)
  })

  it('create keeps the parent link that makes the location tree', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { name: 'Sub-depot', location_type: 'Branch', parent_location_id: '2' })
    expect(client.rows('enterprise_locations').find((r) => r.name === 'Sub-depot').parent_location_id).toBe('2')
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('2', A, { name: 'Ikeja Main Warehouse' })
    expect(loc(client, '2').name).toBe('Ikeja Main Warehouse')
  })

  it('update leaves siblings in the same business untouched', async () => {
    const { repo, client } = seeded()
    await repo.update('2', A, { name: 'Renamed' })
    expect(loc(client, '1').name).toBe('Lagos HQ')
  })

  it('update never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.update('9', A, { name: 'Hijacked' })
    expect(loc(client, '9').name).toBe('Other tenant hub')
  })

  it('delete scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.delete('2', A)
    expect(client.rows('enterprise_locations').map((r) => r.id)).not.toContain('2')
  })

  // Destructive, and this row is referenced by stock batches, stock movements
  // and orders — deleting the wrong tenant's would be the worst outcome in the
  // aggregate.
  it('delete never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.delete('9', A)
    expect(client.rows('enterprise_locations').map((r) => r.id)).toContain('9')
  })

  // The database refuses to delete a location that is still referenced — four
  // foreign keys point at this table and none cascade. That refusal is right;
  // what reached the user was a raw Postgres violation in a toast.
  describe('delete failure messages', () => {
    const fkError = (constraint) =>
      new Error(`Supabase error (409): update or delete on table "enterprise_locations" violates foreign key constraint "${constraint}" on table "x"`)

    const failingWith = (constraint) =>
      createWarehouseRepository(async () => { throw fkError(constraint) })

    it('explains a location that still holds stock', async () => {
      await expect(failingWith('stock_batches_location_id_fkey').delete('1', A, 'Ikeja Warehouse'))
        .rejects.toThrow('"Ikeja Warehouse" still holds stock. Transfer or remove its batches first.')
    })

    it('explains a location with orders against it', async () => {
      await expect(failingWith('orders_location_id_fkey').delete('1', A, 'Lagos HQ'))
        .rejects.toThrow('"Lagos HQ" has orders raised against it.')
    })

    it('explains a location kept by its movement history', async () => {
      await expect(failingWith('stock_movements_from_location_id_fkey').delete('1', A, 'Old Depot'))
        .rejects.toThrow('audit record')
    })

    it('names the location even when the page passes none', async () => {
      await expect(failingWith('stock_batches_location_id_fkey').delete('1', A))
        .rejects.toThrow('"This location" still holds stock')
    })

    // An unrecognised failure must not be flattened into a confident, wrong
    // explanation — a network error is not "this location is in use".
    it('rethrows an unrecognised error untouched', async () => {
      const repo = createWarehouseRepository(async () => { throw new Error('NetworkError: connection reset') })
      await expect(repo.delete('1', A, 'Ikeja Warehouse')).rejects.toThrow('NetworkError: connection reset')
    })

    it('does not interfere with a delete that succeeds', async () => {
      const { repo, client } = seeded()
      await repo.delete('2', A, 'Ikeja Warehouse')
      expect(client.rows('enterprise_locations').map((r) => r.id)).not.toContain('2')
    })
  })

  it('exports a default warehouseRepository instance', () => {
    for (const m of ['getAll', 'create', 'update', 'delete']) {
      expect(typeof warehouseRepository[m]).toBe('function')
    }
  })
})
