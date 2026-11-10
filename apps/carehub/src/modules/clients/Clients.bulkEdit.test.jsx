// Clients bulk edit: mark clients (or all shown), set gender / address, add a dated note; the shared client list
// shows the saved values; failures can be retried.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getAll: vi.fn(), create: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }))
vi.mock('./repositories', () => ({ clientRepository: repo, isDuplicateError: () => false }))
vi.mock('../debts/repositories', () => ({ debtRepository: { getOpen: vi.fn(async () => []) } }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-10' }))

import Clients from './Clients.jsx'

let db
let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const type = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent

beforeEach(async () => {
  vi.clearAllMocks()
  db = [
    { id: 'c1', full_name: 'Ada Obi', phone: '0801', gender: 'Female', notes: 'VIP', total_spend: 0, visit_count: 0, created_at: '2026-10-01' },
    { id: 'c2', full_name: 'Musa Bello', phone: '0802', gender: '', notes: '', total_spend: 0, visit_count: 0, created_at: '2026-10-02' },
    { id: 'c3', full_name: 'Chi Eze', phone: '0803', gender: 'Male', notes: '', total_spend: 0, visit_count: 0, created_at: '2026-10-03' },
  ]
  repo.getAll.mockImplementation(async () => db.map((c) => ({ ...c })))
  repo.updateMany.mockImplementation(async (_b, ids, updates) => {
    db = db.map((c) => (ids.includes(c.id) ? { ...c, ...updates } : c))
    return db.filter((c) => ids.includes(c.id))
  })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role='Owner' /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = '' })

describe('Clients: mark and edit', () => {
  it('marks two clients, sets gender and adds a note; the list shows the saved values', async () => {
    await click(document.querySelector('input[aria-label="Select Musa Bello"]'))
    await click(document.querySelector('input[aria-label="Select Chi Eze"]'))
    expect(text()).toContain('2 selected')
    await click(btn((b) => b.textContent.includes('Edit selected')))
    await type(dialog().querySelector('select'), 'Female')
    await type(dialog().querySelector('textarea'), 'Called about refill')
    expect(dialog().textContent).toContain('2 of 2 clients will change.')
    await click(btn((b) => b.textContent.startsWith('Update 2 clients')))
    // Both had empty notes, so their changes are identical: one request.
    expect(repo.updateMany).toHaveBeenCalledTimes(1)
    expect(repo.updateMany).toHaveBeenCalledWith('b1', ['c2', 'c3'], { gender: 'Female', notes: '2026-11-10: Called about refill' })
    expect(dialog().textContent).toContain('2 clients updated.')
    expect(qc.getQueryData(['clients', 'b1']).find((c) => c.id === 'c3').gender).toBe('Female')
  })

  it('"Select all shown" with one shared change sends one request; a client already matching is not counted', async () => {
    await click(btn((b) => b.textContent.startsWith('Select all 3 shown')))
    await click(btn((b) => b.textContent.includes('Edit selected')))
    await type(dialog().querySelector('select'), 'Male')
    expect(dialog().textContent).toContain('2 of 3 clients will change.')
    await click(btn((b) => b.textContent.startsWith('Update 2 clients')))
    expect(repo.updateMany).toHaveBeenCalledTimes(1)
    expect(repo.updateMany).toHaveBeenCalledWith('b1', ['c1', 'c2'], { gender: 'Male' })
  })

  it('a note keeps each client\'s own notes, so clients with different notes are saved separately', async () => {
    await click(document.querySelector('input[aria-label="Select Ada Obi"]'))
    await click(document.querySelector('input[aria-label="Select Musa Bello"]'))
    await click(btn((b) => b.textContent.includes('Edit selected')))
    await type(dialog().querySelector('textarea'), 'Moved branch')
    await click(btn((b) => b.textContent.startsWith('Update 2 clients')))
    expect(repo.updateMany).toHaveBeenCalledWith('b1', ['c1'], { notes: 'VIP\n2026-11-10: Moved branch' })
    expect(repo.updateMany).toHaveBeenCalledWith('b1', ['c2'], { notes: '2026-11-10: Moved branch' })
  })

  it('a failed save is reported and can be retried', async () => {
    repo.updateMany.mockRejectedValueOnce(new Error('Supabase error (500): down'))
    await click(document.querySelector('input[aria-label="Select Ada Obi"]'))
    await click(btn((b) => b.textContent.includes('Edit selected')))
    await type(dialog().querySelector('input'), '5 Allen Avenue')
    await click(btn((b) => b.textContent.startsWith('Update 1 client')))
    expect(dialog().textContent).toContain('1 could not be updated.')
    await click(btn((b) => b.textContent.trim() === 'Try the failed ones again'))
    expect(dialog().textContent).toContain('1 client updated.')
  })

  it('ticking a client does not open its details', async () => {
    await click(document.querySelector('input[aria-label="Select Ada Obi"]'))
    expect(text()).not.toContain('Client Details')
  })
})
