import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Every data call resolves empty: this suite is about the responsive shell, not the panels.
vi.mock('../../../services/supabase', () => {
  const empty = () => Promise.resolve([])
  const names = ['getBusinesses', 'updateBusiness', 'getAdminTeam', 'addAdminTeam', 'removeAdminTeam', 'getBusinessesFiltered', 'deleteBusinessSoft', 'hardDeleteBusiness', 'getEcommerceProductsByBusiness',
    'getAdminRoles', 'createAdminRole', 'updateAdminRole', 'deleteAdminRole', 'getAdminTeamMembers', 'createAdminTeamMember', 'updateAdminTeamMember', 'deleteAdminTeamMember',
    'getAgentTiers', 'getAgentsDetailed', 'getAgentReferralsByAgent', 'getAgentEarningsByAgent', 'getAgentTransfers', 'transferAgentAccount', 'calculateAgentEarningsRpc',
    'getApplications', 'createApplication', 'getLedgerForEntity', 'getPayoutRequests', 'createPayoutRequest', 'updatePayoutRequest', 'markPayoutPaidAtomic',
    'getAgentApplications', 'getAgents', 'addAgentRow', 'updateAgentRow', 'getUnverifiedOwnerBusinessIds', 'sbFetch']
  const mod = Object.fromEntries(names.map(n => [n, vi.fn(empty)]))
  mod.getBusinessesFilteredWithCount = vi.fn(() => Promise.resolve({ data: [], total: 0 }))
  mod.partitionByOwnerVerification = () => ({ approvable: [], skipped: [] })
  mod.summarizeBulkApproval = () => ({ approved: 0, message: '' })
  mod.collectBulkResults = () => ({ outcomes: [], failureMessages: [] })
  return mod
})
// Stable like the real context value; a fresh object per render would re-run the dashboard's load effect forever.
vi.mock('../../../providers/AuthProvider', () => { const value = { logout: () => {}, auth: { isAdmin: true, email: 'admin@x.com' } }; return { useAuth: () => value } })
vi.mock('../../../lib/authClient', () => {
  const channel = { on() { return channel }, subscribe() { return channel }, unsubscribe() {} }
  return { authClient: { channel: () => channel, removeChannel: () => {}, auth: { getUser: async () => ({ data: { user: null } }) } } }
})
vi.mock('../../../lib/sessionFetch', () => ({ fetchWithSession: () => Promise.resolve({ ok: true }) }))
vi.mock('../../../modules/adr/repositories', () => ({ adrReportRepository: { getRouteReviewQueue: () => Promise.resolve([]) } }))

import AdminDashboard from '../AdminDashboard.jsx'

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mountAt(width) {
  window.innerWidth = width
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><AdminDashboard /></MemoryRouter>) })
  await flush(); await flush()
}
const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`)
const navButton = (text) => [...document.querySelectorAll('nav[aria-label="Admin navigation"] button')].find(b => b.textContent.trim().startsWith(text))

beforeEach(() => {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  try { localStorage.clear() } catch { /* not available */ }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; document.body.style.overflow = '' })

describe('admin shell on phones', () => {
  it('hides the sidebar behind a menu button, and the drawer closes after choosing a destination', async () => {
    await mountAt(390)
    expect(document.querySelector('nav[aria-label="Admin navigation"]')).toBeNull()
    const menu = byLabel('Open navigation')
    expect(menu.getAttribute('aria-expanded')).toBe('false')

    await act(async () => menu.click())
    const drawer = document.querySelector('[role="dialog"][aria-label="Admin navigation"]')
    expect(drawer).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    expect(navButton('Subscriptions')).toBeTruthy()
    expect(navButton('ADR Reports')).toBeTruthy()

    await act(async () => navButton('Ledger').click())
    expect(document.querySelector('[role="dialog"][aria-label="Admin navigation"]')).toBeNull()
    expect(document.querySelector('h1').textContent).toBe('Ledger')
    expect(document.body.style.overflow).toBe('')
  })

  it('closes the drawer with Escape and keeps the compact header', async () => {
    await mountAt(390)
    await act(async () => byLabel('Open navigation').click())
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"][aria-label="Admin navigation"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/perms/)
    expect(document.body.textContent).not.toMatch(/last synced/)
  })
})

describe('admin shell on laptops', () => {
  it('shows the sidebar and no menu button', async () => {
    await mountAt(1280)
    expect(byLabel('Open navigation')).toBeNull()
    expect(document.querySelector('nav[aria-label="Admin navigation"]')).not.toBeNull()
    await act(async () => navButton('Payouts').click())
    expect(document.querySelector('h1').textContent).toBe('Payouts')
  })
})
