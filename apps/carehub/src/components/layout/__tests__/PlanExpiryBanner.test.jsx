import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getPlanStatus: vi.fn() }))
vi.mock('../../../modules/settings/repositories', () => ({ settingsRepository: repo }))

import PlanExpiryBanner from '../PlanExpiryBanner.jsx'
import { PlanStatusProvider } from '../../../hooks/usePlanStatus.jsx'

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString()
let host, root
function Where() { return <div data-testid='where'>{useLocation().pathname}</div> }
async function mount(brand, role = 'Owner') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/dashboard']}><PlanStatusProvider brand={brand}>
      <Routes><Route path='*' element={<><PlanExpiryBanner brand={brand} role={role} /><Where /></>} /></Routes>
    </PlanStatusProvider></MemoryRouter>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const dialog = () => document.querySelector('[role="dialog"]')
const banner = () => [...host.querySelectorAll('button')].find((b) => /Renew →/.test(b.textContent))

beforeEach(() => { repo.getPlanStatus.mockReset(); localStorage.clear() })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('plan alerts', () => {
  it('a restricted plan: a red banner on every page and a daily popup explaining what is paused', async () => {
    repo.getPlanStatus.mockResolvedValue({ plan: 'basic', state: 'restricted', expires_at: inDays(-20), grace_ends_at: inDays(-13), limits: {} })
    await mount({ id: 'b1', plan_expires_at: inDays(-20) })
    expect(repo.getPlanStatus).toHaveBeenCalledWith('b1')
    expect(banner().textContent).toContain('Your plan has expired and some features are paused')
    expect(dialog().textContent).toContain('Paused until you renew')
    expect(dialog().textContent).toContain('Still working:')
    await act(async () => { [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Renew now').click() })
    expect(host.querySelector('[data-testid="where"]').textContent).toBe('/dashboard/settings')
  })

  it('the popup shows once a day; "Remind me tomorrow" remembers it', async () => {
    repo.getPlanStatus.mockResolvedValue({ plan: 'basic', state: 'grace', expires_at: inDays(-2), grace_ends_at: inDays(5), limits: {} })
    await mount({ id: 'b2', plan_expires_at: inDays(-2) })
    await act(async () => { [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Remind me tomorrow').click() })
    expect(dialog()).toBeNull()
    await act(async () => root.unmount()); host.remove()
    await mount({ id: 'b2', plan_expires_at: inDays(-2) })
    expect(dialog()).toBeNull()
    expect(banner().textContent).toMatch(/Renew within 5 days/)
  })

  it('cashiers see no billing alerts; nothing shows for a plan with months left', async () => {
    repo.getPlanStatus.mockResolvedValue({ plan: 'basic', state: 'restricted', expires_at: inDays(-20), grace_ends_at: inDays(-13), limits: {} })
    await mount({ id: 'b3', plan_expires_at: inDays(-20) }, 'Cashier')
    expect(banner()).toBeUndefined()
    expect(dialog()).toBeNull()
    await act(async () => root.unmount()); host.remove()
    repo.getPlanStatus.mockResolvedValue({ plan: 'basic', state: 'active', expires_at: inDays(120), limits: {} })
    await mount({ id: 'b4', plan_expires_at: inDays(120) })
    expect(banner()).toBeUndefined()
  })

  it('before the database update, an expired plan is still announced but nothing is said to be paused', async () => {
    repo.getPlanStatus.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.business_plan_status in the schema cache'))
    await mount({ id: 'b5', plan_expires_at: inDays(-40) })
    expect(banner().textContent).toContain('Your plan expired 40 days ago. Renew now to avoid interruptions.')
    expect(dialog().textContent).not.toContain('Paused until you renew')
  })
})
