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
  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { label: 'Internet', amount: 60 })
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
})
