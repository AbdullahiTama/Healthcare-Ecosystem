import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Regression for the CareHub ADR page error:
//   Supabase error (401): permission denied for function can_access_adr_report_row
//
// The dashboard is guarded on the localStorage cache ('carehub_auth'), while
// every sbFetch needs a live Supabase session to run as `authenticated`. When
// the session expired the reconciliation below used to `return` silently, so
// the dashboard stayed reachable from cache while all traffic fell back to the
// anon key — which that RLS helper deliberately excludes. Login.jsx routes
// every sign-in through signInWithPassword and refuses to continue without a
// session, so "cache present + no session" can only be an expired sign-in.

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(async () => ({ data: { session: null } })),
  signOut: vi.fn(async () => {}),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  resolveAccountByEmail: vi.fn(),
  getBusinessById: vi.fn(),
  purgeUnsentReports: vi.fn(async () => true),
}))

vi.mock('./lib/sentry', () => ({
  initSentry: vi.fn(),
  Sentry: { ErrorBoundary: ({ children }) => children },
}))
vi.mock('./lib/authClient', () => ({
  authClient: {
    auth: {
      getSession: h.getSession,
      refreshSession: h.refreshSession,
      signOut: h.signOut,
      onAuthStateChange: h.onAuthStateChange,
    },
  },
}))
vi.mock('./services/supabase', () => ({ resolveAccountByEmail: h.resolveAccountByEmail, getBusinessById: h.getBusinessById }))
// Lazy routes: stubbed so the harness never pulls the full dashboard tree into
// jsdom (these suites must stay fast and deterministic).
vi.mock('./pages/auth/Login', () => ({ default: () => <div data-testid="login" /> }))
// The stub carries a real sign-out button wired to the app's own logout.
vi.mock('./pages/dashboard/BusinessDashboard', async () => {
  const { useAuth } = await import('./providers/AuthProvider')
  return {
    default: () => {
      const { logout } = useAuth()
      return <div data-testid="dashboard"><button type="button" data-testid="signout" onClick={logout}>Sign out</button></div>
    },
  }
})
vi.mock('./modules/live-activity/outbox/purge', () => ({ purgeUnsentReports: h.purgeUnsentReports }))

import App from './App'

// React 18 needs this flag or `act` warns that the environment is unconfigured.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CACHED = { brand: { id: 'b1', name: 'Test Pharmacy' }, role: 'Owner', isAdmin: true }

describe('App session reconciliation', () => {
  let host
  let root

  beforeEach(() => {
    localStorage.clear()
    h.getSession.mockReset()
    h.resolveAccountByEmail.mockReset()
    h.getBusinessById.mockReset()
    h.signOut.mockReset()
    h.purgeUnsentReports.mockClear()
    h.refreshSession.mockResolvedValue({ data: { session: null } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    localStorage.clear()
  })

  async function mount() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      )
    })
    // Flush the getSession().then(...) chain plus the async logout().
    for (let i = 0; i < 6; i++) await act(async () => {})
  }

  it('clears an expired cached identity when no session remains', async () => {
    localStorage.setItem('carehub_auth', JSON.stringify(CACHED))
    h.getSession.mockResolvedValue({ data: { session: null } })

    await mount()

    expect(h.signOut).toHaveBeenCalled()
    expect(localStorage.getItem('carehub_auth')).toBe(null)
  })

  it('keeps the cached identity when a live session exists', async () => {
    localStorage.setItem('carehub_auth', JSON.stringify(CACHED))
    h.getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@example.com' } } } })
    h.resolveAccountByEmail.mockResolvedValue({
      biz: { id: 'b1', name: 'Test Pharmacy', status: 'active', is_platform_admin: false },
      staff: { id: 's1', role: 'Owner' },
    })

    await mount()

    expect(h.resolveAccountByEmail).toHaveBeenCalledWith('owner@example.com')
    expect(localStorage.getItem('carehub_auth')).not.toBe(null)
    expect(h.signOut).not.toHaveBeenCalled()
  })

  // Reports written offline and not yet sent live in IndexedDB. A person who deliberately signs out takes
  // them off a shared device; an EXPIRED session must not destroy them, or a rep who was out of coverage
  // loses the reports the queue exists to protect. They send after the next sign-in (queue is per person).
  it('an expired session keeps the unsent offline reports', async () => {
    localStorage.setItem('carehub_auth', JSON.stringify(CACHED))
    h.getSession.mockResolvedValue({ data: { session: null } })

    await mount()

    expect(h.signOut).toHaveBeenCalled()
    expect(h.purgeUnsentReports).not.toHaveBeenCalled()
  })

  it('a deliberate sign-out clears the unsent offline reports from the device', async () => {
    localStorage.setItem('carehub_auth', JSON.stringify({ brand: { id: 'b1', name: 'Test Pharmacy' }, role: 'Owner' }))
    h.getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@example.com' } } } })
    h.resolveAccountByEmail.mockResolvedValue({
      biz: { id: 'b1', name: 'Test Pharmacy', status: 'active', is_platform_admin: false },
      staff: null,
    })

    await mount()
    await act(async () => { host.querySelector('[data-testid="signout"]').click() })
    for (let i = 0; i < 4; i++) await act(async () => {})

    expect(h.purgeUnsentReports).toHaveBeenCalledTimes(1)
    expect(h.signOut).toHaveBeenCalled()
  })

  // Branches share the owner's email, so the account always resolves to the MAIN business. A reload must keep the
  // location the owner switched to, or their sales and stock changes silently land at the main business.
  describe('the location an owner chose', () => {
    const ROOT = { id: 'root', name: 'Allen Pharmacy', status: 'active', is_platform_admin: false, parent_business_id: null }
    const YABA = { id: 'yaba', name: 'Allen · Yaba', status: 'active', parent_business_id: 'root' }
    const signedIn = () => h.getSession.mockResolvedValue({ data: { session: { user: { email: 'owner@a.test' } } } })
    const cachedBrand = () => JSON.parse(localStorage.getItem('carehub_auth')).brand

    it('a reload keeps the branch the owner switched to, with its fresh details', async () => {
      localStorage.setItem('carehub_auth', JSON.stringify({ brand: { id: 'yaba', name: 'stale' }, role: 'Owner' }))
      signedIn()
      h.resolveAccountByEmail.mockResolvedValue({ biz: ROOT, staff: null })
      h.getBusinessById.mockImplementation(async (id) => ({ root: ROOT, yaba: YABA })[id] || null)
      await mount()
      expect(cachedBrand()).toEqual(YABA)
    })

    it('a remembered business the owner cannot reach (a shared device) gives way to their main business', async () => {
      localStorage.setItem('carehub_auth', JSON.stringify({ brand: { id: 'other' }, role: 'Owner' }))
      signedIn()
      h.resolveAccountByEmail.mockResolvedValue({ biz: ROOT, staff: null })
      h.getBusinessById.mockResolvedValue({ id: 'other', status: 'active', parent_business_id: null })
      await mount()
      expect(cachedBrand().id).toBe('root')
    })

    it('staff always work in their own business, whatever is remembered', async () => {
      localStorage.setItem('carehub_auth', JSON.stringify({ brand: { id: 'yaba' }, role: 'Cashier' }))
      signedIn()
      h.resolveAccountByEmail.mockResolvedValue({ biz: ROOT, staff: { id: 's1', role: 'Cashier' } })
      await mount()
      expect(cachedBrand().id).toBe('root')
      expect(h.getBusinessById).not.toHaveBeenCalled()
    })
  })

  it('does nothing when there is no cached identity to invalidate', async () => {
    h.getSession.mockResolvedValue({ data: { session: null } })

    await mount()

    expect(h.getSession).toHaveBeenCalled()
    expect(h.signOut).not.toHaveBeenCalled()
  })
})
