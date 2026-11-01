// Roles & Permissions: every switch is saved with the role. canManageDirectory
// used to be shown but never read or saved (editing any role erased it), and
// canEditPurchases is read by the database (can_edit_purchases).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  getAll: vi.fn(async () => []), getRoles: vi.fn(), getPendingClaims: vi.fn(async () => []), createRole: vi.fn(), updateRole: vi.fn(),
}))
vi.mock('./repositories', () => ({ staffRepository: repo, staffActivityRepository: { get: vi.fn(async () => []) }, ACTIVITY_LIMIT: 1000 }))

import Staff from './Staff.jsx'

let host, root
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const buttons = (text) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === text)
const switchFor = (label) => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent.startsWith(label))?.querySelector('input')
async function mount(brand) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Staff brand={brand} role='Owner' perms={{}} /></QueryClientProvider>) })
  await settle()
}

beforeEach(() => {
  repo.getRoles.mockReset().mockResolvedValue([
    { id: 'r1', name: 'Store Lead', permissions: { nav: ['dashboard', 'purchases'], label: 'Store Lead', canManageDirectory: true, canEditStock: true } },
  ])
  repo.updateRole.mockReset().mockResolvedValue(null)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Staff ▸ roles', () => {
  it('"Edit purchases" is offered, saved, and no other permission is lost on save', async () => {
    await mount({ id: 'biz-1', name: 'Pharm Tama', business_type: 'pharmacy' })
    await act(async () => buttons('Edit').at(-1).click())
    const toggle = switchFor('Edit purchases')
    expect(toggle).toBeTruthy()
    expect(toggle.checked).toBe(false)
    await act(async () => toggle.click())
    await act(async () => buttons('Save Role').concat(buttons('Update Role'), buttons('Save')).find(Boolean).click())
    await settle()
    expect(repo.updateRole).toHaveBeenCalledTimes(1)
    const saved = repo.updateRole.mock.calls[0][2].permissions
    expect(saved.canEditPurchases).toBe(true)
    expect(saved.canEditStock).toBe(true)
    // Not shown to a pharmacy (no field team), and still not erased by the save.
    expect(saved.canManageDirectory).toBe(true)
  })
})
