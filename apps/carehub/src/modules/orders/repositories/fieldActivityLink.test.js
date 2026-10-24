import { describe, it, expect, vi } from 'vitest'
import { createOrderRepository } from './index.js'

// An order raised from a field visit carries field_activity_id (draft carehub_20261026_orders_field_activity_link).
// Until that column exists the app must keep working: an order is never lost because of the link.

const UNKNOWN_COLUMN = "Supabase error (400): Could not find the 'field_activity_id' column of 'orders' in the schema cache (PGRST204)"

function backend(firstOrdersPost) {
  const calls = []
  let ordersPosts = 0
  const request = vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    if (path === 'orders' && opts.method === 'POST') {
      ordersPosts++
      if (ordersPosts === 1 && firstOrdersPost) return firstOrdersPost()
      return [{ id: 'o1' }]
    }
    return []
  })
  return { calls, repo: createOrderRepository({ request, notify: vi.fn(async () => 'sent') }) }
}
const ORDER = { business_id: 'b1', customer_name: 'Allen Pharmacy', created_by_name: 'Ada', field_activity_id: 'act-1' }

describe('create with a visit link', () => {
  it('sends the link when the column exists', async () => {
    const { repo, calls } = backend()
    await repo.create(ORDER, [], [], [])
    const posts = calls.filter((c) => c.path === 'orders' && c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].body.field_activity_id).toBe('act-1')
  })

  it('when the project does not have the column yet, saves the order without the link instead of failing', async () => {
    const { repo, calls } = backend(() => { throw new Error(UNKNOWN_COLUMN) })
    const saved = await repo.create(ORDER, [], [], [])
    const posts = calls.filter((c) => c.path === 'orders' && c.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[1].body).not.toHaveProperty('field_activity_id')
    expect(posts[1].body.customer_name).toBe('Allen Pharmacy')
    expect(saved.id).toBe('o1')
  })

  it('a refusal is a refusal: it is not retried without the link', async () => {
    const refusal = 'Supabase error (403): An order can only be linked to a field report of the same company that you can see 42501'
    const { repo, calls } = backend(() => { throw new Error(refusal) })
    await expect(repo.create(ORDER, [], [], [])).rejects.toThrow('same company')
    expect(calls.filter((c) => c.path === 'orders' && c.method === 'POST')).toHaveLength(1)
  })
})

describe('listForActivities', () => {
  it('asks for the orders linked to the shown reports, with only what the card needs', async () => {
    const request = vi.fn(async () => [{ id: 'o1', order_ref: 'ORD-1', status: 'submitted', field_activity_id: 'a1' }])
    const repo = createOrderRepository({ request })
    const rows = await repo.listForActivities('b1', ['a1', 'a2'])
    expect(request).toHaveBeenCalledWith('orders?business_id=eq.b1&field_activity_id=in.(a1,a2)&select=id,order_ref,status,field_activity_id&order=created_at.desc')
    expect(rows).toHaveLength(1)
  })

  it('no reports asks nothing', async () => {
    const request = vi.fn()
    const repo = createOrderRepository({ request })
    expect(await repo.listForActivities('b1', [])).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('before the column exists it quietly reports no linked orders', async () => {
    const request = vi.fn(async () => { throw new Error('Supabase error (400): column orders.field_activity_id does not exist 42703') })
    const repo = createOrderRepository({ request })
    expect(await repo.listForActivities('b1', ['a1'])).toEqual([])
  })

  it('any other failure is passed on', async () => {
    const request = vi.fn(async () => { throw new Error('Failed to fetch') })
    const repo = createOrderRepository({ request })
    await expect(repo.listForActivities('b1', ['a1'])).rejects.toThrow('Failed to fetch')
  })
})
