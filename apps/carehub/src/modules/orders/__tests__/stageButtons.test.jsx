import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// The order's buttons match what the database allows (orders_guard): the person who raised an order never approves
// it or moves it through the warehouse stages; somebody else does. The owner may do either.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repositories', () => ({
  orderRepository: {
    getAll: vi.fn(), listAwaitingApproval: vi.fn(), getItems: vi.fn(), getWatchers: vi.fn(), getFiles: vi.fn(),
    getEvents: vi.fn(), advance: vi.fn(), create: vi.fn(), uploadFile: vi.fn(),
  },
}))
vi.mock('../../inventory/repositories', () => ({ productRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../warehouses/repositories', () => ({ warehouseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../staff/repositories', () => ({ staffRepository: { getAll: vi.fn(async () => []) } }))

import Orders from '../Orders.jsx'
import { orderRepository as repo } from '../repositories'

const order = (status, over = {}) => ({ id: 'o1', order_ref: 'ORD-1', customer_name: 'Allen Pharmacy', status, total_value: 1000, created_at: '2026-10-22T10:00:00Z', created_by_staff_id: 'rep', created_by_name: 'Ada Rep', approver_staff_id: 'mgr', approver_name: 'Mo Manager', ...over })

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))

async function openAs(staffId, o) {
  repo.getAll.mockResolvedValue([o])
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: staffId ? { id: staffId, full_name: 'Someone', role: 'Field Rep' } : undefined, brand: { id: 'biz-1', owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><Orders brand={{ id: 'biz-1' }} /></MemoryRouter>) })
  await flush(); await flush()
  await act(async () => { button('Allen Pharmacy').click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getItems.mockResolvedValue([])
  repo.getWatchers.mockResolvedValue([])
  repo.getFiles.mockResolvedValue([])
  repo.getEvents.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('order stage buttons', () => {
  it.each([
    ['approved', 'Send to Warehouse'],
    ['processing', 'Mark Dispatched'],
    ['dispatched', 'Mark Delivered'],
  ])('the person who raised an order does not get the %s step button (%s), and is told someone else moves it on', async (status, label) => {
    await openAs('rep', order(status))
    expect(button(label)).toBeUndefined()
    expect(host.textContent).toMatch(/someone else in the company moves it on/i)
  })

  it.each([
    ['approved', 'Send to Warehouse'],
    ['processing', 'Mark Dispatched'],
    ['dispatched', 'Mark Delivered'],
  ])('a colleague gets the %s step button (%s)', async (status, label) => {
    await openAs('warehouse', order(status))
    expect(button(label)).toBeTruthy()
  })

  it('the owner moves on even an order the owner raised', async () => {
    await openAs(null, order('approved', { created_by_staff_id: null }))
    expect(button('Send to Warehouse')).toBeTruthy()
  })

  it('a creator who is also tagged as approver is not offered Approve', async () => {
    await openAs('rep', order('submitted', { approver_staff_id: 'rep' }))
    expect(button('Approve Order')).toBeUndefined()
  })
})
