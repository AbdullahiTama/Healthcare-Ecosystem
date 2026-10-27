import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// The owner's Locations page: every location with today's figures, adding a branch, and switching to one. It must say
// what went wrong instead of looking empty, and switch through the one shared switch.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ value: null, setAuth: null }))
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => ({ auth: auth.value, setAuth: auth.setAuth }) }))
vi.mock('../repositories', () => ({ locationsRepository: { getAll: vi.fn(), addBranch: vi.fn(), cloneBranchData: vi.fn() } }))
vi.mock('../../pos/repositories', () => ({ saleRepository: { getToday: vi.fn() } }))
vi.mock('../../inventory/repositories', () => ({ productRepository: { getStockSummary: vi.fn() } }))
vi.mock('../../settings/repositories', () => ({ settingsRepository: { getPlanStatus: vi.fn(async () => ({ plan: 'growth', state: 'restricted', expires_at: '2026-09-01T00:00:00Z', grace_ends_at: '2026-10-28T00:00:00Z', limits: {} })) } }))

import Locations from '../Locations.jsx'
import { PlanStatusProvider } from '../../../hooks/usePlanStatus.jsx'
import { locationsRepository as repo } from '../repositories'
import { saleRepository } from '../../pos/repositories'
import { productRepository } from '../../inventory/repositories'
import { registerSwitchBlocker } from '../../../lib/locationSwitch.js'

const ROOT = { id: 'root', name: 'Allen Pharmacy', email: 'owner@a.test', plan: 'growth', parent_business_id: null, address: '1 Marina' }
const YABA = { id: 'yaba', name: 'Allen Pharmacy · Yaba', branch_name: 'Yaba', email: 'owner@a.test', plan: 'growth', parent_business_id: 'root', address: '2 Herbert Macaulay' }

let root, host, lastPath, offBlocker
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
function Probe() { lastPath = useLocation().pathname; return null }
async function show(brand = ROOT) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/dashboard/locations']}><Routes>
      <Route path='/dashboard/locations' element={<Locations brand={brand} role='Owner' />} />
      <Route path='*' element={<Probe />} />
    </Routes></MemoryRouter>)
  })
  await flush(); await flush()
}
const type = async (label, value) => {
  const el = [...document.body.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') || '').includes(label) || (i.labels && [...i.labels].some((l) => l.textContent.includes(label))))
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  auth.value = { brand: ROOT, staff: null, role: 'Owner' }
  auth.setAuth = vi.fn()
  repo.getAll.mockResolvedValue([ROOT, YABA])
  repo.addBranch.mockResolvedValue([{ id: 'new' }])
  repo.cloneBranchData.mockResolvedValue(undefined)
  saleRepository.getToday.mockResolvedValue([{ total: 1000 }])
  productRepository.getStockSummary.mockResolvedValue({ productCount: 0, lowStock: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { if (offBlocker) { offBlocker(); offBlocker = null } act(() => root.unmount()); host.remove() })

describe('Locations page', () => {
  it('lists every location with its figures, the main one first, without reordering what it was given', async () => {
    const list = [YABA, ROOT]
    repo.getAll.mockResolvedValue(list)
    await show()
    const text = host.textContent
    expect(text.indexOf('Main Location')).toBeLessThan(text.indexOf('Yaba'))
    expect(list.map((l) => l.id)).toEqual(['yaba', 'root'])
  })

  it('loads every location\'s figures at once, not one after another', async () => {
    saleRepository.getToday.mockImplementation(() => new Promise(() => {}))
    await show()
    expect(saleRepository.getToday).toHaveBeenCalledWith('root')
    expect(saleRepository.getToday).toHaveBeenCalledWith('yaba')
  })

  it('a failed load says so with a retry, instead of looking like there are no branches', async () => {
    repo.getAll.mockRejectedValueOnce(new Error('Supabase error (500): timeout'))
    await show()
    expect(host.textContent).not.toContain('No additional branches yet')
    expect(host.textContent).toMatch(/couldn't load your branches/i)
    await act(async () => { button('Retry').click() })
    await flush(); await flush()
    expect(host.textContent).toContain('Yaba')
  })

  it('switching goes through the shared switch and opens the dashboard of that location', async () => {
    await show()
    await act(async () => { button('Switch to this branch').click() })
    await flush()
    expect(auth.setAuth).toHaveBeenCalledWith(expect.objectContaining({ brand: YABA, role: 'Owner', staff: null }))
    expect(lastPath).toBe('/dashboard/dashboard')
  })

  it('asks first when switching would lose unsaved work', async () => {
    offBlocker = registerSwitchBlocker(() => 'Your POS cart has 1 item. Switching location clears it.')
    await show()
    await act(async () => { button('Switch to this branch').click() })
    expect(auth.setAuth).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Your POS cart has 1 item. Switching location clears it.')
    await act(async () => { button('Switch anyway').click() })
    await flush()
    expect(auth.setAuth).toHaveBeenCalled()
  })

  // Owner's option A (2026-10-25): a branch has no sign-in email of its own; it belongs to the main business's owner.
  // The database refuses an email on a branch, so none is sent, and the form says how sign-in works.
  it('a new branch is sent without an email, and the form says it uses the main account\'s sign-in', async () => {
    await show()
    await act(async () => { button('+ Add Branch').click() })
    expect(document.body.textContent).toContain('A branch has no sign-in of its own: you manage it from your main account')
    expect(document.body.textContent).not.toContain('same login email and password')
    await type('Lagos Branch', 'Ikeja')
    await type('Full address', '3 Allen Avenue')
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Add Branch').at(-1).click() })
    await flush(); await flush()
    expect(repo.addBranch.mock.calls[0][0]).not.toHaveProperty('email')
  })

  it('a new branch takes the current business\'s plan (never a made-up default) and its catalogue is copied', async () => {
    await show()
    await act(async () => { button('+ Add Branch').click() })
    await type('Lagos Branch', 'Ikeja')
    await type('Full address', '3 Allen Avenue')
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Add Branch').at(-1).click() })
    await flush(); await flush()
    expect(repo.addBranch.mock.calls[0][0]).toMatchObject({ branch_name: 'Ikeja', parent_business_id: 'root', plan: 'growth' })
    expect(repo.cloneBranchData).toHaveBeenCalledWith('root', 'new')
    const noPlan = await (async () => {
      repo.addBranch.mockClear()
      // With no plan the limit is the basic plan's 2 locations: start from the main business alone.
      repo.getAll.mockResolvedValue([{ ...ROOT, plan: null }])
      await act(async () => { root.render(<></>) })
      await show({ ...ROOT, plan: null })
      await act(async () => { button('+ Add Branch').click() })
      await type('Lagos Branch', 'Ikeja')
      await type('Full address', '3 Allen Avenue')
      await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Add Branch').at(-1).click() })
      await flush(); await flush()
      return repo.addBranch.mock.calls[0][0]
    })()
    expect(noPlan).not.toHaveProperty('plan')
  })

  it('when the database refuses a branch, its reason is shown', async () => {
    repo.addBranch.mockRejectedValue(new Error("Supabase error (403): A new branch must be on its parent business's plan; only a platform administrator can set another plan."))
    await show()
    await act(async () => { button('+ Add Branch').click() })
    await type('Lagos Branch', 'Ikeja')
    await type('Full address', '3 Allen Avenue')
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Add Branch').at(-1).click() })
    await flush()
    expect(document.body.textContent).toContain("Could not add the branch: A new branch must be on its parent business's plan")
  })

  it('when copying the catalogue or roles fails, the owner is told the branch needs them set up', async () => {
    repo.cloneBranchData.mockRejectedValue(new Error('3 of 40 products could not be copied'))
    await show()
    await act(async () => { button('+ Add Branch').click() })
    await type('Lagos Branch', 'Ikeja')
    await type('Full address', '3 Allen Avenue')
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Add Branch').at(-1).click() })
    await flush(); await flush()
    expect(document.body.textContent).toContain('The branch was added, but its products and roles were not fully copied: 3 of 40 products could not be copied')
  })

  it('while the plan is restricted, adding a branch is paused with the reason, and nothing is sent', async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/dashboard/locations']}><PlanStatusProvider brand={ROOT}><Routes>
        <Route path='/dashboard/locations' element={<Locations brand={ROOT} role='Owner' />} />
      </Routes></PlanStatusProvider></MemoryRouter>)
    })
    await flush(); await flush()
    await act(async () => { button('+ Add Branch').click() })
    expect(document.body.textContent).toContain('Your CareHub plan has expired, so adding branches is paused')
    expect(document.body.textContent).not.toContain('A branch has no sign-in of its own')
    expect(repo.addBranch).not.toHaveBeenCalled()
  })
})
