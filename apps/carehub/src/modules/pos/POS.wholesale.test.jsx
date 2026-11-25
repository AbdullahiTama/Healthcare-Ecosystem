// Retail and wholesale prices at the POS (docs/architecture/Wholesale-and-Retail-Prices.md): only the prices a
// product has are shown; the sale's Retail / Wholesale switch prices new lines and reprices lines that have both; a
// line can be switched on its own; a cashier without "Edit prices" can still sell at either catalogue price.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: [], isLoading: false })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [] })),
  useCreateClient: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useInvalidateSales: vi.fn(() => vi.fn()),
  useUpsertOpenSale: vi.fn(() => vi.fn()),
}))

import POS from './POS.jsx'

beforeEach(() => { localStorage.clear() })

const BOTH = { id: 'p1', name: 'Paracetamol Pack', cat: 'OTC Drugs', category: 'OTC Drugs', price: 500, wholesale_price: 420, stock: 20 }
const RETAIL = { id: 'p2', name: 'Zinc Tabs', cat: 'Supplements', category: 'Supplements', price: 300, wholesale_price: null, stock: 20 }
const WHOLESALE = { id: 'p3', name: 'ORS Carton', cat: 'OTC Drugs', category: 'OTC Drugs', price: 0, wholesale_price: 9500, stock: 20 }

async function renderPOS(products, perms = { canEditPrice: false }, role = 'Cashier') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={{ id: 'biz-1', name: 'Pharm' }} products={products} setProducts={vi.fn()} role={role} perms={perms} /></MemoryRouter>)
  })
  await act(async () => {})
  return { host, unmount: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const btn = (host, label) => host.querySelector(`button[aria-label="${label}"]`)
const modeGroup = (host) => host.querySelector('[role="group"][aria-label="Price for this sale"]')
const modeButton = (host, text) => [...modeGroup(host).querySelectorAll('button')].find(b => b.textContent.trim() === text)
const cartLine = (host, name) => [...host.querySelectorAll('.pos-cart-item')].find(el => el.textContent.includes(name))
const cartText = (host) => [...host.querySelectorAll('.pos-cart-item')].map(el => el.textContent).join(' | ')

describe('POS: retail and wholesale prices', () => {
  it('shows no price switch when no product has a wholesale price (as before)', async () => {
    const m = await renderPOS([RETAIL])
    expect(modeGroup(m.host)).toBeNull()
    await m.unmount()
  })

  it('shows only the prices each product has', async () => {
    const m = await renderPOS([BOTH, RETAIL, WHOLESALE])
    const card = (name) => btn(m.host, 'Add ' + name).parentElement.textContent
    expect(card('Paracetamol Pack')).toContain('₦500 Retail')
    expect(card('Paracetamol Pack')).toContain('₦420 Wholesale')
    expect(card('Zinc Tabs')).toContain('₦300')
    expect(card('Zinc Tabs')).not.toContain('Wholesale')
    expect(card('ORS Carton')).toContain('₦9,500 Wholesale')
    expect(card('ORS Carton')).not.toContain('Retail')
    await m.unmount()
  })

  it('adds at the sale\'s price mode and reprices lines with both prices when it changes', async () => {
    const m = await renderPOS([BOTH, RETAIL, WHOLESALE])
    expect(modeButton(m.host, 'Retail').getAttribute('aria-pressed')).toBe('true')
    await click(btn(m.host, 'Add Paracetamol Pack'))
    await click(btn(m.host, 'Add Zinc Tabs'))
    await click(btn(m.host, 'Add ORS Carton'))
    expect(cartLine(m.host, 'Paracetamol Pack').textContent).toContain('₦500 each')
    expect(cartLine(m.host, 'ORS Carton').textContent).toContain('₦9,500 each')

    await click(modeButton(m.host, 'Wholesale'))
    expect(modeButton(m.host, 'Wholesale').getAttribute('aria-pressed')).toBe('true')
    expect(cartLine(m.host, 'Paracetamol Pack').textContent).toContain('₦420 each')
    // One-price products keep their only price.
    expect(cartLine(m.host, 'Zinc Tabs').textContent).toContain('₦300 each')
    expect(cartLine(m.host, 'ORS Carton').textContent).toContain('₦9,500 each')
    await m.unmount()
  })

  it('switches one line between its two prices', async () => {
    const m = await renderPOS([BOTH, RETAIL])
    await click(btn(m.host, 'Add Paracetamol Pack'))
    await click(btn(m.host, 'Wholesale price for Paracetamol Pack: ₦420'))
    expect(cartLine(m.host, 'Paracetamol Pack').textContent).toContain('₦420 each')
    expect(btn(m.host, 'Wholesale price for Paracetamol Pack: ₦420').getAttribute('aria-pressed')).toBe('true')
    await click(btn(m.host, 'Retail price for Paracetamol Pack: ₦500'))
    expect(cartLine(m.host, 'Paracetamol Pack').textContent).toContain('₦500 each')
    // No switch on a line whose product has one price.
    await click(btn(m.host, 'Add Zinc Tabs'))
    expect(cartLine(m.host, 'Zinc Tabs').querySelector('[role="group"]')).toBeNull()
    await m.unmount()
  })

  it('keeps a one-off price an Owner typed when the mode changes', async () => {
    const m = await renderPOS([BOTH], { canEditPrice: true }, 'Owner')
    await click(btn(m.host, 'Add Paracetamol Pack'))
    const input = m.host.querySelector('input[aria-label="Unit price for Paracetamol Pack"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '450')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(modeButton(m.host, 'Wholesale'))
    expect(m.host.querySelector('input[aria-label="Unit price for Paracetamol Pack"]').value).toBe('450')
    expect(cartText(m.host)).toContain('was ₦500')
    await m.unmount()
  })
})
