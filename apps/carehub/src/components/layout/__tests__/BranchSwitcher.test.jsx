import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// The top-bar location switcher: the owner moves between their locations through the one shared switch, and is asked
// first when the switch would lose unsaved work (a POS cart).

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ value: null, setAuth: null }))
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => ({ auth: auth.value, setAuth: auth.setAuth }) }))
vi.mock('../../../modules/locations/repositories', () => ({ locationsRepository: { getAll: vi.fn() } }))

import BranchSwitcher from '../BranchSwitcher.jsx'
import { locationsRepository } from '../../../modules/locations/repositories'
import { registerSwitchBlocker } from '../../../lib/locationSwitch.js'

const ROOT = { id: 'root', name: 'Allen Pharmacy', parent_business_id: null }
const YABA = { id: 'yaba', name: 'Allen · Yaba', parent_business_id: 'root' }

let root, host, offBlocker
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes(text))
async function show() {
  await act(async () => { root.render(<BranchSwitcher />) })
  await flush()
  await act(async () => { button('Allen Pharmacy').click() })
}

beforeEach(() => {
  localStorage.clear()
  auth.value = { brand: ROOT, staff: null, role: 'Owner' }
  auth.setAuth = vi.fn()
  locationsRepository.getAll.mockResolvedValue([ROOT, YABA])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { if (offBlocker) { offBlocker(); offBlocker = null } act(() => root.unmount()); host.remove() })

describe('BranchSwitcher', () => {
  it('switches to the chosen location and remembers it', async () => {
    await show()
    await act(async () => { button('Allen · Yaba').click() })
    expect(auth.setAuth).toHaveBeenCalledWith(expect.objectContaining({ brand: YABA, role: 'Owner', staff: null }))
    expect(JSON.parse(localStorage.getItem('carehub_auth')).brand.id).toBe('yaba')
  })

  it('choosing the current location does nothing', async () => {
    await show()
    await act(async () => { [...document.body.querySelectorAll('button')].filter((b) => b.textContent.includes('Allen Pharmacy')).at(-1).click() })
    expect(auth.setAuth).not.toHaveBeenCalled()
  })

  it('asks first when switching would lose unsaved work, and switches only on confirm', async () => {
    offBlocker = registerSwitchBlocker(() => 'Your POS cart has 3 items. Switching location clears it.')
    await show()
    await act(async () => { button('Allen · Yaba').click() })
    expect(auth.setAuth).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Your POS cart has 3 items. Switching location clears it.')
    await act(async () => { button('Cancel').click() })
    expect(auth.setAuth).not.toHaveBeenCalled()
    await act(async () => { button('Allen Pharmacy').click() })
    await act(async () => { button('Allen · Yaba').click() })
    await act(async () => { button('Switch anyway').click() })
    expect(auth.setAuth).toHaveBeenCalledWith(expect.objectContaining({ brand: YABA }))
  })

  it('is not shown to staff, nor with a single location', async () => {
    auth.value = { brand: ROOT, staff: { id: 's1' }, role: 'Cashier' }
    await act(async () => { root.render(<BranchSwitcher />) })
    await flush()
    expect(host.textContent).toBe('')
    auth.value = { brand: ROOT, staff: null, role: 'Owner' }
    locationsRepository.getAll.mockResolvedValue([ROOT])
    await act(async () => { root.render(<BranchSwitcher key='again' />) })
    await flush()
    expect(host.textContent).toBe('')
  })
})
