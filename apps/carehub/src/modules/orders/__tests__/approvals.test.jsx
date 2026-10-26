import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Field team > Order approvals: the existing Orders page, showing only what waits for this person.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repositories', () => ({
  orderRepository: {
    getAll: vi.fn(), listAwaitingApproval: vi.fn(), getItems: vi.fn(), getWatchers: vi.fn(), getFiles: vi.fn(),
    getEvents: vi.fn(), advance: vi.fn(), create: vi.fn(), uploadFile: vi.fn(),
  },
}))
vi.mock('../../warehouses/repositories', () => ({ warehouseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../staff/repositories', () => ({ staffRepository: { getAll: vi.fn(async () => []) } }))

import Orders from '../Orders.jsx'
import { orderRepository as repo } from '../repositories'

const BRAND = { id: 'biz-1' }
const order = (id, over = {}) => ({ id, order_ref: 'ORD-' + id, customer_name: 'Allen Pharmacy ' + id, status: 'submitted', total_value: 1000, created_at: '2026-10-22T10:00:00Z', approver_staff_id: 'me', created_by_name: 'Ada Rep', ...over })

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))

async function show({ view, staffId = 'me' } = {}) {
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: staffId ? { id: staffId, full_name: 'Mo Manager', role: 'Regional Manager' } : undefined, brand: { id: 'biz-1', owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><Orders brand={BRAND} view={view} /></MemoryRouter>) })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getAll.mockResolvedValue([order('1'), order('2', { status: 'approved' })])
  repo.listAwaitingApproval.mockResolvedValue([order('1')])
  repo.getItems.mockResolvedValue([])
  repo.getWatchers.mockResolvedValue([])
  repo.getFiles.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('Order approvals view', () => {
  it('asks the server only for the orders waiting on this person, and shows them', async () => {
    await show({ view: 'approvals' })
    expect(repo.listAwaitingApproval).toHaveBeenCalledWith('biz-1', { approverStaffId: 'me', isOwner: false })
    expect(repo.getAll).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Allen Pharmacy 1')
    expect(host.textContent).not.toContain('Allen Pharmacy 2')
  })

  it('the owner gets every submitted order', async () => {
    await show({ view: 'approvals', staffId: null })
    expect(repo.listAwaitingApproval).toHaveBeenCalledWith('biz-1', { approverStaffId: null, isOwner: true })
  })

  it('is titled for what it is and offers no New Order', async () => {
    await show({ view: 'approvals' })
    expect(host.textContent).toContain('Order approvals')
    expect(button('New Order')).toBeUndefined()
  })

  it('an empty queue says nothing is waiting, without a New Order button', async () => {
    repo.listAwaitingApproval.mockResolvedValue([])
    await show({ view: 'approvals' })
    expect(host.textContent).toMatch(/nothing is waiting for your approval/i)
    expect(button('New Order')).toBeUndefined()
  })

  it('the ordinary Orders page is unchanged: all orders and a New Order button', async () => {
    await show()
    expect(repo.getAll).toHaveBeenCalledWith('biz-1')
    expect(repo.listAwaitingApproval).not.toHaveBeenCalled()
    expect(button('New Order')).toBeTruthy()
  })
})
