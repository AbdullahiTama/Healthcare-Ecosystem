import { describe, it, expect, vi } from 'vitest'
import { createCustomerRepository } from '../repository.js'

// Customers are derived from field visits by two database readers (draft carehub_20261027_directory_field_link).
// Until that draft is applied the readers do not exist, and the screens say so instead of failing.

const MISSING_FN = 'Supabase error (404): Could not find the function public.field_customers(p_business_id, p_staff_id) in the schema cache (PGRST202)'

function backend(answer = async () => []) {
  const calls = []
  const request = vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    return answer(path)
  })
  return { calls, repo: createCustomerRepository({ request }) }
}

describe('customerRepository', () => {
  it('list asks for the whole team (p_staff_id null) when no staff id is given', async () => {
    const { repo, calls } = backend(async () => [{ key: 'f:a@1,2' }])
    const rows = await repo.list('biz-1')
    expect(rows).toEqual([{ key: 'f:a@1,2' }])
    expect(calls[0]).toEqual({ path: 'rpc/field_customers', method: 'POST', body: { p_business_id: 'biz-1', p_staff_id: null, p_quiet_days: null } })
  })

  it('list narrows to one rep when a staff id is given', async () => {
    const { repo, calls } = backend()
    await repo.list('biz-1', { staffId: 'rep-1' })
    expect(calls[0].body).toEqual({ p_business_id: 'biz-1', p_staff_id: 'rep-1', p_quiet_days: null })
  })

  it('list asks the database for customers not visited in N days (filtered before its 500 limit)', async () => {
    const { repo, calls } = backend()
    await repo.list('biz-1', { quietDays: 30 })
    expect(calls[0].body).toEqual({ p_business_id: 'biz-1', p_staff_id: null, p_quiet_days: 30 })
    await repo.list('biz-1', { quietDays: 0 })
    expect(calls[1].body.p_quiet_days).toBeNull()
  })

  it('visits sends the customer key', async () => {
    const { repo, calls } = backend()
    await repo.visits('biz-1', 'd:123')
    expect(calls[0]).toEqual({ path: 'rpc/field_customer_visits', method: 'POST', body: { p_business_id: 'biz-1', p_key: 'd:123' } })
  })

  it('a missing reader becomes NOT_AVAILABLE with a plain message', async () => {
    const { repo } = backend(async () => { throw new Error(MISSING_FN) })
    await expect(repo.list('biz-1')).rejects.toMatchObject({ code: 'NOT_AVAILABLE', message: 'Customers are not available yet.' })
    await expect(repo.visits('biz-1', 'k')).rejects.toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('a 42883 (function does not exist) also becomes NOT_AVAILABLE', async () => {
    const { repo } = backend(async () => { throw new Error('Supabase error (404): function public.field_customers does not exist (42883)') })
    await expect(repo.list('biz-1')).rejects.toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('any other failure is passed on unchanged', async () => {
    const boom = new Error('Supabase error (500): timeout')
    const { repo } = backend(async () => { throw boom })
    await expect(repo.list('biz-1')).rejects.toBe(boom)
  })

  it('a non-array answer reads as no rows', async () => {
    const { repo } = backend(async () => null)
    expect(await repo.list('biz-1')).toEqual([])
    expect(await repo.visits('biz-1', 'k')).toEqual([])
  })
})
