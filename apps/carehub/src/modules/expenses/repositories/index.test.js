import { describe, it, expect } from 'vitest'
import { createExpenseRepository, expenseRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    expenses: [
      { id: '1', business_id: A, label: 'Rent', amount: 500 },
      { id: '2', business_id: A, label: 'Power', amount: 80 },
      { id: '9', business_id: B, label: 'Other-biz expense', amount: 42 },
    ],
  })
  return { client, repo: createExpenseRepository(client) }
}

describe('expenseRepository', () => {
  it('getById is tenant-scoped', async () => {
    const { repo } = seeded()
    expect((await repo.getById(A, '2')).label).toBe('Power')
    expect(await repo.getById(A, '9')).toBeNull()
  })

  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { id: 'n1', label: 'Internet', amount: 60 })
    const created = client.rows('expenses').find((r) => r.label === 'Internet')
    expect(created.business_id).toBe(A)
  })

  it('delete scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.delete('2', A)
    expect(client.rows('expenses').map((r) => r.id)).not.toContain('2')
  })

  it('delete never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    // expense '9' belongs to B; deleting it under A's scope must be a no-op
    await repo.delete('9', A)
    expect(client.rows('expenses').map((r) => r.id)).toContain('9')
  })

  it('exports a default expenseRepository instance', () => {
    expect(typeof expenseRepository.getAll).toBe('function')
    expect(typeof expenseRepository.create).toBe('function')
    expect(typeof expenseRepository.delete).toBe('function')
  })

  it('create returns the stored row so the caller can confirm the save', async () => {
    const { repo } = seeded()
    const row = await repo.create(A, { id: 'n2', category: 'Rent', amount: 10, date: '2026-10-01' })
    expect(row).toMatchObject({ id: 'n2', business_id: A, amount: 10 })
  })

  it('create refuses a payload with no id (idempotency needs one)', async () => {
    const { repo } = seeded()
    await expect(repo.create(A, { amount: 5 })).rejects.toThrow(/id/)
  })

  it('saving the same expense twice stores one row and still reports success', async () => {
    const { repo, client } = seeded()
    const first = await repo.create(A, { id: 'dup', category: 'Rent', amount: 25 })
    const second = await repo.create(A, { id: 'dup', category: 'Rent', amount: 25 })
    expect(client.rows('expenses').filter((r) => r.id === 'dup')).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('a duplicate id owned by another tenant is not reported as saved', async () => {
    const { repo } = seeded()
    // id 9 exists for B; A re-using it is ignored by the database and must not read back as A's row
    await expect(repo.create(A, { id: '9', category: 'Rent', amount: 5 })).rejects.toThrow(/could not be confirmed/)
  })

  it('a failed insert rejects, so the caller can never show success', async () => {
    const repo = createExpenseRepository(async () => { throw new Error('Supabase error (500): boom') })
    await expect(repo.create(A, { id: 'x', amount: 1 })).rejects.toThrow(/boom/)
  })

  it('a failed read rejects instead of resolving to an empty list', async () => {
    const repo = createExpenseRepository(async () => { throw new Error('Supabase error (400): structure of query does not match function result type') })
    await expect(repo.getPage(A, { month: '2026-10' })).rejects.toThrow(/does not match/)
    await expect(repo.getTotals(A)).rejects.toThrow()
  })

  it('getAll pages past the 1000-row PostgREST cap', async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({ id: 'r' + i, business_id: A, amount: 1 }))
    const repo = createExpenseRepository(createInMemoryClient({ expenses: rows }))
    expect(await repo.getAll(A)).toHaveLength(2300)
  })

  it('month and range queries are tenant-scoped RPC calls', async () => {
    const seen = []
    const repo = createExpenseRepository(async (path) => { seen.push(path); return [] })
    await repo.getPage(A, { month: '2026-10', offset: 50, limit: 50 })
    await repo.getTotals(A, '2026-10')
    await repo.getCategories(A)
    expect(seen).toEqual([
      `rpc/get_expenses_page?p_business_id=${A}&p_offset=50&p_limit=50&p_month=2026-10`,
      `rpc/get_expense_totals?p_business_id=${A}&p_month=2026-10`,
      `rpc/get_expense_summary?p_business_id=${A}`,
    ])
  })
})
