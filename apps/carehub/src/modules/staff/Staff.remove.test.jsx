// Removing a staff member and revoking an invitation (remove_staff_member).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  getAll: vi.fn(), getRoles: vi.fn(async () => []), getPendingClaims: vi.fn(async () => []), remove: vi.fn(),
}))
vi.mock('./repositories', () => ({ staffRepository: repo, staffActivityRepository: { get: vi.fn(async () => []) }, ACTIVITY_LIMIT: 1000 }))

import Staff from './Staff.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama', business_type: 'pharmacy' }
let host, root
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()))
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Staff brand={BRAND} role='Owner' perms={{}} /></QueryClientProvider>) })
  await settle()
}

beforeEach(() => {
  repo.getAll.mockReset().mockResolvedValue([
    { id: 's1', full_name: 'Ada Cashier', email: 'ada@x.com', role: 'Cashier', status: 'active' },
    { id: 's2', full_name: 'Ben Invitee', email: 'ben@x.com', role: 'Cashier', status: 'invited', invite_expires_at: new Date(Date.now() + 86400000).toISOString() },
  ])
  repo.remove.mockReset().mockResolvedValue({ removed: 'Ada Cashier', login_deleted: true, login_kept: false })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Staff ▸ remove', () => {
  it('explains what is removed and what is kept, then removes through the database function', async () => {
    await mount()
    await act(async () => button(/^Remove$/).click())
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog.textContent).toContain('signed out for good')
    expect(dialog.textContent).toContain('stay in your records under their name')
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click())
    await settle()
    expect(repo.remove).toHaveBeenCalledWith('s1')
    expect(document.body.textContent).toContain('Ada Cashier has been removed')
    expect(repo.getAll).toHaveBeenCalledTimes(2)
  })

  it('a pending invitation is revoked, not "removed"', async () => {
    await mount()
    await act(async () => button(/^Revoke$/).click())
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    expect(dialog.textContent).toContain('Revoke this invitation?')
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Revoke').click())
    await settle()
    expect(repo.remove).toHaveBeenCalledWith('s2')
    expect(document.body.textContent).toContain('Invitation revoked.')
  })

  it('shows the database refusal in plain words', async () => {
    repo.remove.mockRejectedValueOnce(new Error('Supabase error (403): Only the business owner can remove a staff member who manages staff.'))
    await mount()
    await act(async () => button(/^Remove$/).click())
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click())
    await settle()
    expect(document.body.textContent).toContain('Only the business owner can remove a staff member who manages staff.')
    expect(document.body.textContent).not.toContain('Supabase error')
  })
})
