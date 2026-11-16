// Edit Client: from a client's profile, change name, phone and address; only what changed is saved; the list and the
// profile show the new details; a phone another client has is refused before saving and by the database; a failed
// save keeps the dialog and says why. Docs: docs/architecture/Client-Edit.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  getAll: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), restoreDeleted: vi.fn(), getDeletions: vi.fn(),
  getSales: vi.fn(async () => []), getAppointments: vi.fn(async () => []), getDebts: vi.fn(async () => []), getConsultations: vi.fn(async () => []),
}))
const dup = vi.hoisted(() => ({ isDuplicateError: (e) => /duplicate key/.test(e?.message || '') }))
vi.mock('./repositories', () => ({ clientRepository: repo, isDuplicateError: dup.isDuplicateError }))
vi.mock('../../lib/dbErrors', async (orig) => ({ ...(await orig()), isDuplicateError: dup.isDuplicateError }))
vi.mock('../debts/repositories', () => ({ debtRepository: { getOpen: vi.fn(async () => []) } }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-16' }))

import Clients from './Clients.jsx'

let db
let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
const type = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) })
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent
const openProfile = async (name) => click([...document.querySelectorAll('div')].reverse().find((d) => d.textContent === name))
const openEdit = async () => click(btn((b) => b.getAttribute('aria-label')?.startsWith('Edit '), dialog()))

async function remount(role) {
  await act(async () => root.unmount())
  await act(async () => { root = createRoot(host); root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role={role} perms={{}} /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
}

beforeEach(async () => {
  vi.clearAllMocks()
  db = [
    { id: 'c1', full_name: 'Ada Obi', phone: '0801 111 2222', email: '', address: '12 Broad St', gender: 'Female', date_of_birth: '', notes: 'VIP', total_spend: 5000, visit_count: 3, created_at: '2026-10-01' },
    { id: 'c2', full_name: 'Musa Bello', phone: '0802 333 4444', email: '', address: '', gender: '', date_of_birth: '', notes: '', total_spend: 0, visit_count: 0, created_at: '2026-10-02' },
  ]
  repo.getAll.mockImplementation(async () => db.map((c) => ({ ...c })))
  repo.update.mockImplementation(async (id, _b, changes) => {
    db = db.map((c) => (c.id === id ? { ...c, ...changes } : c))
    return { ...db.find((c) => c.id === id) }
  })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role='Cashier' /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = '' })

describe('Clients: Edit Client', () => {
  it('edits name, phone and address from the profile; saves only those; the profile and list show them', async () => {
    await openProfile('Ada Obi')
    expect(dialog().textContent).toContain('Client Details')
    await openEdit()
    expect(dialog().textContent).toContain('Edit Ada Obi')
    await type(document.querySelector('#client-edit-name'), 'Ada Obi-Okafor')
    await type(document.querySelector('#client-edit-phone'), '0803 555 6666')
    await type(document.querySelector('#client-edit-address'), '4 Marina, Lagos')
    await click(btn((b) => b.textContent === 'Save changes', dialog()))
    expect(repo.update).toHaveBeenCalledTimes(1)
    expect(repo.update).toHaveBeenCalledWith('c1', 'b1', { full_name: 'Ada Obi-Okafor', phone: '0803 555 6666', address: '4 Marina, Lagos' })
    // Back on the profile, with the saved details; visits and spend untouched.
    expect(dialog().textContent).toContain('Client Details')
    expect(dialog().textContent).toContain('Ada Obi-Okafor')
    expect(dialog().textContent).toContain('0803 555 6666')
    expect(dialog().textContent).toContain('4 Marina, Lagos')
    expect(text()).toContain('Ada Obi-Okafor updated: name, phone number and address.')
    expect(db[0]).toMatchObject({ total_spend: 5000, visit_count: 3, notes: 'VIP' })
  })

  it('refuses a phone number another client has, before saving', async () => {
    await openProfile('Ada Obi')
    await openEdit()
    await type(document.querySelector('#client-edit-phone'), '0802-333-4444')
    await click(btn((b) => b.textContent === 'Save changes', dialog()))
    expect(repo.update).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('Musa Bello already has this phone number.')
  })

  it('shows the database refusing a duplicate phone on the phone field', async () => {
    repo.update.mockRejectedValueOnce(new Error('Supabase error (409): duplicate key value violates unique constraint "clients_phone_unique_per_business"'))
    await openProfile('Ada Obi')
    await openEdit()
    await type(document.querySelector('#client-edit-phone'), '0809 000 0000')
    await click(btn((b) => b.textContent === 'Save changes', dialog()))
    expect(dialog().textContent).toContain('Edit Ada Obi')
    expect(dialog().textContent).toContain('Another client already has this phone number.')
  })

  it('keeps the dialog and explains a failed save', async () => {
    repo.update.mockRejectedValueOnce(new Error('Failed to fetch'))
    await openProfile('Ada Obi')
    await openEdit()
    await type(document.querySelector('#client-edit-name'), 'Ada O.')
    await click(btn((b) => b.textContent === 'Save changes', dialog()))
    expect(dialog().textContent).toContain('Could not save the changes')
    expect(dialog().querySelector('#client-edit-name').value).toBe('Ada O.')
  })

  it('offers Save only once something changed, and Cancel returns to the profile', async () => {
    await openProfile('Ada Obi')
    await openEdit()
    expect(btn((b) => b.textContent === 'Save changes', dialog()).disabled).toBe(true)
    await click(btn((b) => b.textContent === 'Cancel', dialog()))
    expect(dialog().textContent).toContain('Client Details')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('visits and total spent: hidden from staff without access; the Owner can correct them', async () => {
    await openProfile('Ada Obi')
    await openEdit()
    expect(document.querySelector('#client-edit-visits')).toBeNull()
    await click(btn((b) => b.textContent === 'Cancel', dialog()))
    await remount('Owner')
    await openProfile('Ada Obi')
    await openEdit()
    expect(dialog().textContent).toContain('the client\'s next sale recalculates both')
    await type(document.querySelector('#client-edit-spend'), '4500')
    await click(btn((b) => b.textContent === 'Save changes', dialog()))
    expect(repo.update).toHaveBeenCalledWith('c1', 'b1', { total_spend: 4500 })
  })
})
