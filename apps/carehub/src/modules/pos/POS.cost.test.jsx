// Quick cost price at the POS for authorised users: a Show cost switch (hidden until turned on, so the customer-facing
// screen shows nothing by default) puts cost and margin on product cards, cost and profit on cart lines, and the
// estimated profit of the sale under the total. Nothing about the sale changes.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../hooks/queries', () => ({
  useOpenSales: vi.fn(() => ({ data: [], isLoading: false })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [] })),
  useCreateClient: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useInvalidateSales: vi.fn(() => vi.fn()),
  useUpsertOpenSale: vi.fn(() => vi.fn()),
}))

import POS from './POS.jsx'

const CATALOGUE = [
  { id: 'amox', name: 'Amoxicillin 500mg', cat: 'Rx', category: 'Rx', price: 1200, cost_price: 800, stock: 5 },
  { id: 'ors', name: 'ORS sachet', cat: 'OTC', category: 'OTC', price: 200, cost_price: 0, stock: 9 },
  { id: 'cons', name: 'Consultation', cat: 'Services', category: 'Services', price: 5000, stock: 999 },
]

let unmount
beforeEach(() => { localStorage.clear() })
afterEach(async () => { if (unmount) await unmount(); unmount = null })

async function renderPOS({ role = 'Owner', perms = {} } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={{ id: 'b' }} products={CATALOGUE} setProducts={vi.fn()} role={role} perms={perms} /></MemoryRouter>)
  })
  unmount = async () => { await act(async () => root.unmount()); host.remove() }
  return host
}
const toggle = (host) => host.querySelector('button[aria-label="Show cost prices"], button[aria-label="Hide cost prices"]')
const add = async (host, name) => { await act(async () => { host.querySelector(`button[aria-label^="Add ${name}"]`).click() }) }
const costs = (host, id) => [...host.querySelectorAll(`[data-testid="${id}"]`)].map((n) => n.textContent)

describe('cost price at the POS', () => {
  it('is hidden until the Owner turns it on, then shows cost and margin on products', async () => {
    const host = await renderPOS()
    expect(costs(host, 'pos-cost')).toEqual([])
    expect(toggle(host).getAttribute('aria-pressed')).toBe('false')
    await act(async () => { toggle(host).click() })
    expect(toggle(host).getAttribute('aria-label')).toBe('Hide cost prices')
    // Services carry no stock cost and show none; a zero cost is "not set", not a 100% margin.
    expect(costs(host, 'pos-cost')).toEqual(['Cost ₦800 · 33%', 'No cost set'])
  })

  it('shows cost and profit on cart lines and the estimated profit of the sale, after the discount', async () => {
    const host = await renderPOS()
    await act(async () => { toggle(host).click() })
    await add(host, 'Amoxicillin')
    await add(host, 'Amoxicillin')
    expect(costs(host, 'pos-line-cost')).toEqual(['Cost ₦800 each · profit ₦800'])
    expect(costs(host, 'pos-sale-cost')).toEqual(['Est. profit₦800 · 33%'])
    const discount = host.querySelector('input[placeholder="Discount"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(discount, '400')
      discount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(costs(host, 'pos-sale-cost')).toEqual(['Est. profit₦400 · 20%'])
    await add(host, 'ORS')
    expect(costs(host, 'pos-sale-cost')[0]).toMatch(/^Est. profit \(1 without cost\)/)
    // The sale itself is unchanged: the total is still the price less the discount.
    expect(host.textContent).toContain('Charge ₦2,200')
  })

  it('stays on after leaving and coming back, for the same person on this device', async () => {
    let host = await renderPOS()
    await act(async () => { toggle(host).click() })
    await unmount(); unmount = null
    host = await renderPOS()
    expect(toggle(host).getAttribute('aria-pressed')).toBe('true')
    expect(costs(host, 'pos-cost')).toHaveLength(2)
  })

  it('is offered to a role granted "See cost prices at the POS", and not to a cashier', async () => {
    let host = await renderPOS({ role: 'Cashier', perms: { canMakeSales: true } })
    expect(toggle(host)).toBeNull()
    // Even if this device remembers the switch on (e.g. the Owner used it), a cashier sees no cost.
    localStorage.setItem('carehub_pos_show_cost', JSON.stringify({ 'b:owner': true }))
    await unmount(); unmount = null
    host = await renderPOS({ role: 'Cashier', perms: { canMakeSales: true } })
    expect(costs(host, 'pos-cost')).toEqual([])
    await unmount(); unmount = null
    host = await renderPOS({ role: 'Stock Lead', perms: { canMakeSales: true, canViewCostPrice: true } })
    expect(toggle(host)).not.toBeNull()
  })
})
