// The Activity tab: Owner only, loads the feed, filters by person, shows errors.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ rows: [], get: vi.fn() }))
vi.mock('./repositories', () => ({
  staffRepository: { getAll: vi.fn(async () => []), getRoles: vi.fn(async () => []), getClaims: vi.fn(async () => []), getPendingClaims: vi.fn(async () => []) },
  staffActivityRepository: { get: h.get },
  ACTIVITY_LIMIT: 1000,
}))

import Staff from './Staff.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama', business_type: 'pharmacy' }
const row = (o) => ({ occurred_at: new Date().toISOString(), kind: 'sale', staff_id: 's1', actor_name: 'Rep One', actor_role: 'Cashier', summary: 'T1 · Ada · Cash', amount: 1500, ref: 'T1', ...o })
let host, root
const text = () => host.textContent
const tab = (name) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === name)
async function mount(role) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Staff brand={BRAND} role={role} perms={{}} /></QueryClientProvider>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
async function open() { await act(async () => { tab('Activity').click() }); await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) }

beforeEach(() => {
  h.rows = [row({}), row({ ref: 'T2', amount: 500 }), row({ staff_id: 's2', actor_name: 'Rep Two', actor_role: 'Pharmacist', kind: 'expense', summary: 'Transport · Fuel', amount: 2500, ref: null })]
  h.get.mockReset().mockImplementation(async () => h.rows)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Staff ▸ Activity tab', () => {
  it('is offered to the Owner only', async () => {
    await mount('Manager')
    expect(tab('Activity')).toBeUndefined()
    await act(async () => root.unmount()); host.remove()
    await mount('Owner')
    expect(tab('Team')).toBeTruthy(); expect(tab('Activity')).toBeTruthy()
  })

  it('shows each person with their totals, and the feed', async () => {
    await mount('Owner'); await open()
    expect(h.get).toHaveBeenCalledTimes(1)
    expect(h.get.mock.calls[0][0]).toBe('biz-1')
    expect(text()).toContain('Rep One'); expect(text()).toContain('Rep Two')
    expect(text()).toContain('2 sales')
    expect(text()).toContain('Transport · Fuel')
    expect(text()).toContain('3 actions')
  })

  it('clicking a person narrows the feed to them', async () => {
    await mount('Owner'); await open()
    await act(async () => { host.querySelector('button[aria-label^="Rep Two"]').click() })
    expect(text()).toContain('1 of 3 actions')
    expect(text()).not.toContain('T1 · Ada · Cash')
  })

  it('says so when nothing happened, and when the cap is reached', async () => {
    h.rows = []
    await mount('Owner'); await open()
    expect(text()).toContain('No staff activity in this period.')
    await act(async () => root.unmount()); host.remove()
    h.rows = Array.from({ length: 1000 }, (_, i) => row({ ref: 'R' + i }))
    await mount('Owner'); await open()
    expect(text()).toContain('Showing the latest 1,000 actions')
  })

  it('shows a clear message if the database refuses (not the Owner), and a retry for other errors', async () => {
    h.get.mockRejectedValue(new Error('Supabase error (403): Only the Owner can view staff activity'))
    await mount('Owner'); await open()
    expect(text()).toContain('Only the business Owner can view staff activity.')
    await act(async () => root.unmount()); host.remove()
    h.get.mockRejectedValue(new Error('network down'))
    await mount('Owner'); await open()
    expect(text()).toContain('Could not load staff activity')
  })
})
