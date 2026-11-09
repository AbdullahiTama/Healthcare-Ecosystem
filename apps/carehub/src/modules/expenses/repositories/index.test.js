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

  it('budget reads are tenant-scoped and take the latest month on or before the one shown', async () => {
    const calls = []
    const repo = createExpenseRepository(async (path, opts) => {
      calls.push([path, opts])
      if (path.startsWith('expense_budgets?') && path.includes('month=lte')) return [{ month: '2026-10', amount: '50000.00', updated_at: 't' }]
      if (path.startsWith('expense_budgets?')) return [{ month: '2026-09' }, { month: '2026-10' }]
      return null
    })
    expect(await repo.getBudget(A, '2026-11')).toEqual({ month: '2026-10', amount: 50000, updatedAt: 't' })
    expect(await repo.getBudgetMonths(A)).toEqual(['2026-09', '2026-10'])
    expect(calls.map((c) => c[0])).toEqual([
      `expense_budgets?business_id=eq.${A}&month=lte.2026-11&order=month.desc&limit=1&select=month,amount,updated_at`,
      `expense_budgets?business_id=eq.${A}&select=month&order=month.asc&limit=1000`,
    ])
  })

  it('no stored budget reads as null', async () => {
    const repo = createExpenseRepository(async () => [])
    expect(await repo.getBudget(A, '2026-11')).toBeNull()
  })

  it('setBudget goes through the Owner-only database function and confirms what was stored', async () => {
    const calls = []
    const repo = createExpenseRepository(async (path, opts) => { calls.push([path, JSON.parse(opts.body)]); return { business_id: A, month: '2026-11', amount: 50000 } })
    expect(await repo.setBudget(A, '2026-11', 50000)).toEqual({ month: '2026-11', amount: 50000, updatedAt: null })
    expect(calls).toEqual([['rpc/set_expense_budget', { p_business_id: A, p_month: '2026-11', p_amount: 50000 }]])
    const silent = createExpenseRepository(async () => [])
    await expect(silent.setBudget(A, '2026-11', 50000)).rejects.toThrow('could not be confirmed')
  })
})

describe('expenseRepository: payment status', () => {
  // A recording transport: answers each call from `reply(path, opts)` and keeps every call.
  function recording(reply) {
    const calls = []
    const request = async (path, opts = {}) => { calls.push({ path, ...opts, body: opts.body ? JSON.parse(opts.body) : undefined }); return reply(path, opts, calls.length) }
    return { calls, repo: createExpenseRepository(request) }
  }
  const missing = new Error("Supabase error (400): Could not find the 'amount_paid' column of 'expenses' in the schema cache")

  it('create sends amount_paid and payment_method with the expense', async () => {
    const { calls, repo } = recording(async () => [{ id: 'x' }])
    await repo.create(A, { id: 'x', category: 'Rent', amount: 1000, amount_paid: 0, payment_method: null })
    expect(calls[0].body).toMatchObject({ id: 'x', business_id: A, amount_paid: 0, payment_method: null })
  })

  it('before the update is installed, a paid expense is saved without the new columns', async () => {
    const { calls, repo } = recording(async (_p, _o, n) => { if (n === 1) throw missing; return [{ id: 'x' }] })
    await repo.create(A, { id: 'x', category: 'Rent', amount: 1000, amount_paid: 1000, payment_method: 'Cash' })
    expect(calls).toHaveLength(2)
    expect(calls[1].body).not.toHaveProperty('amount_paid')
    expect(calls[1].body).not.toHaveProperty('payment_method')
  })

  it('before the update is installed, an unpaid expense is refused, never stored as paid', async () => {
    const { calls, repo } = recording(async () => { throw missing })
    await expect(repo.create(A, { id: 'x', category: 'Rent', amount: 1000, amount_paid: 0 })).rejects.toMatchObject({ name: 'ExpensePaymentsUnavailable' })
    expect(calls).toHaveLength(1)
  })

  it('other errors are not swallowed by the fallback', async () => {
    const { calls, repo } = recording(async () => { throw new Error('Supabase error (403): row-level security') })
    await expect(repo.create(A, { id: 'x', amount: 1, amount_paid: 1 })).rejects.toThrow(/row-level/)
    expect(calls).toHaveLength(1)
  })

  it('recordPayment calls record_expense_payment; getPayments is scoped to the business and expense', async () => {
    const { calls, repo } = recording(async () => [])
    await repo.recordPayment('e1', { amount: 400, method: 'Transfer', paidOn: '2026-11-08', note: 'rcpt 9', staffName: 'Bisi' })
    expect(calls[0]).toMatchObject({ path: 'rpc/record_expense_payment', method: 'POST',
      body: { p_expense_id: 'e1', p_amount: 400, p_method: 'Transfer', p_paid_on: '2026-11-08', p_note: 'rcpt 9', p_staff_name: 'Bisi' } })
    await repo.getPayments(A, 'e1')
    expect(calls[1].path).toBe(`expense_payments?business_id=eq.${A}&expense_id=eq.e1&order=created_at.asc,id.asc&select=*`)
  })
})

describe('expenseRepository.getUnpaid', () => {
  it('returns only expenses not fully paid, for this business, reading just the needed columns', async () => {
    const calls = []
    const repo = createExpenseRepository(async (path) => {
      calls.push(path)
      return [
        { id: 'a', amount: 100, amount_paid: 100 },
        { id: 'b', amount: 100, amount_paid: 40 },
        { id: 'c', amount: 100, amount_paid: 0 },
        { id: 'd', amount: 100 },
      ]
    })
    expect((await repo.getUnpaid(A)).map((e) => e.id)).toEqual(['b', 'c'])
    expect(calls[0]).toContain(`business_id=eq.${A}`)
    expect(calls[0]).toContain('select=id,category,description,amount,amount_paid,date,created_at')
  })
  it('before the payment columns exist there is nothing unpaid; other errors still surface', async () => {
    const missing = createExpenseRepository(async () => { throw new Error('Supabase error (400): column expenses.amount_paid does not exist') })
    expect(await missing.getUnpaid(A)).toEqual([])
    const down = createExpenseRepository(async () => { throw new Error('Failed to fetch') })
    await expect(down.getUnpaid(A)).rejects.toThrow('Failed to fetch')
  })
})
