import { describe, it, expect } from 'vitest'
import { createOrderRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

// Builds a repository wired to an in-memory transport plus spy collaborators, so
// every assertion is about the orders aggregate's own behaviour — never the
// network, storage or notification stack.
function build(seed = {}) {
  const client = createInMemoryClient(seed)
  const notifyCalls = []
  const uploadCalls = []
  const repo = createOrderRepository({
    request: client,
    notify: async (...args) => { notifyCalls.push(args) },
    upload: async (...args) => { uploadCalls.push(args); return 'https://files/uploaded' },
  })
  return { client, repo, notifyCalls, uploadCalls }
}

describe('orderRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = build({
      orders: [
        { id: '1', business_id: A, customer_name: 'Acme' },
        { id: '9', business_id: B, customer_name: 'Other biz' },
      ],
    })
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id)).toEqual(['1'])
  })

  it('getItems/getWatchers/getFiles are no-ops on an empty id list', async () => {
    let called = false
    const repo = createOrderRepository({ request: async () => { called = true; return [] } })
    expect(await repo.getItems([])).toEqual([])
    expect(await repo.getWatchers([])).toEqual([])
    expect(await repo.getFiles([])).toEqual([])
    expect(called).toBe(false)
  })

  it('create writes the order, its children, a submitted event, and notifies', async () => {
    const { repo, client, notifyCalls } = build()
    const order = {
      business_id: A,
      customer_name: 'Acme',
      created_by_name: 'Alice',
      approver_staff_id: 'staff-appr',
    }
    const items = [{ product_id: 'p1', quantity: 2, unit_price: 10 }]
    const watchers = [{ staff_id: 'w1' }, { staff_id: 'w2' }]

    const saved = await repo.create(order, items, watchers, [])

    expect(saved.id).toBeTruthy()
    // children stamped with the new order id
    expect(client.rows('order_items').every((i) => i.order_id === saved.id)).toBe(true)
    expect(client.rows('order_watchers').map((w) => w.staff_id).sort()).toEqual(['w1', 'w2'])
    // a submitted event was logged
    const events = client.rows('order_events')
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('submitted')
    // approval notification + one copy notification (watchers present)
    expect(notifyCalls.map((c) => c[2])).toEqual(['order_approval', 'order_copy'])
  })

  it('create sends no copy notification when there are no watchers', async () => {
    const { repo, notifyCalls } = build()
    await repo.create({ business_id: A, customer_name: 'Acme', created_by_name: 'Al' }, [], [], [])
    expect(notifyCalls.map((c) => c[2])).toEqual(['order_approval'])
  })

  it('create throws when the order row comes back without an id', async () => {
    const repo = createOrderRepository({
      request: async () => [],
      notify: async () => {},
    })
    await expect(repo.create({ business_id: A }, [], [], [])).rejects.toThrow(/no id returned/)
  })

  // ── The landmine: advance must scope its PATCH to the one order ─────────────
  it('advance changes only the target order, never the whole table', async () => {
    const { repo, client } = build({
      orders: [
        { id: '1', business_id: A, status: 'submitted', customer_name: 'One', created_by_staff_id: 's1' },
        { id: '2', business_id: A, status: 'submitted', customer_name: 'Two', created_by_staff_id: 's2' },
      ],
    })
    await repo.advance('1', A, 'approved', { approver_name: 'Boss' }, 'Boss', 'ok')

    const byId = Object.fromEntries(client.rows('orders').map((o) => [o.id, o]))
    expect(byId['1'].status).toBe('approved')
    expect(byId['1'].approver_name).toBe('Boss')
    expect(byId['2'].status).toBe('submitted') // untouched
  })

  it('advance cannot move another tenant’s order', async () => {
    const { repo, client, notifyCalls } = build({
      orders: [{ id: '9', business_id: B, status: 'submitted', customer_name: 'Other biz', created_by_staff_id: 's9' }],
    })
    await repo.advance('9', A, 'approved', null, 'Intruder', null)

    expect(client.rows('orders')[0].status).toBe('submitted')
    // nothing moved, so no phantom audit event and nobody notified
    expect(client.rows('order_events')).toHaveLength(0)
    expect(notifyCalls).toHaveLength(0)
  })

  it('getById is scoped to the tenant', async () => {
    const { repo } = build({
      orders: [{ id: '9', business_id: B, customer_name: 'Other biz' }],
    })
    expect(await repo.getById('9', B)).toMatchObject({ customer_name: 'Other biz' })
    expect(await repo.getById('9', A)).toBeNull()
  })

  it('advance logs an event and notifies the raiser plus watchers', async () => {
    const { repo, client, notifyCalls } = build({
      orders: [{ id: '1', business_id: A, status: 'submitted', customer_name: 'One', created_by_staff_id: 's1' }],
      order_watchers: [{ id: 'wA', order_id: '1', staff_id: 'w1' }],
    })
    await repo.advance('1', A, 'dispatched', null, 'Dan', 'on the truck')

    const events = client.rows('order_events')
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('dispatched')
    expect(notifyCalls).toHaveLength(1)
    const targets = notifyCalls[0][1].map((t) => t.staffId).sort()
    expect(targets).toEqual(['s1', 'w1'])
  })

  it('uploadFile stores into the order-files bucket', async () => {
    const { repo, uploadCalls } = build()
    const url = await repo.uploadFile({ name: 'p o.pdf', type: 'application/pdf' })
    expect(url).toBe('https://files/uploaded')
    expect(uploadCalls[0][0]).toBe('order-files')
    // filename is sanitised into the storage path
    expect(uploadCalls[0][1]).toMatch(/p_o\.pdf$/)
  })
})
