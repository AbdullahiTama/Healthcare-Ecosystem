// POS stock validation: the cart can never ask for more units than the product has on hand. Adding, stepping or
// typing a quantity above the stock is cut down with an alert giving the quantity available; a cart that is above the
// stock (stock fell after the line was added) cannot be charged until it is reduced.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const createSale = vi.fn()
vi.mock('../../hooks/queries', () => ({
  useOpenSales: vi.fn(() => ({ data: [], isLoading: false })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [] })),
  useCreateClient: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useInvalidateSales: vi.fn(() => vi.fn()),
  useUpsertOpenSale: vi.fn(() => vi.fn()),
}))
vi.mock('./repositories', async (orig) => {
  const real = await orig()
  return { ...real, saleRepository: { ...real.saleRepository, create: (...a) => createSale(...a) } }
})

import POS from './POS.jsx'

const CATALOGUE = [
  { id: 'amox', name: 'Amoxicillin 500mg', cat: 'Rx', category: 'Rx', price: 1200, stock: 3 },
  { id: 'cons', name: 'Consultation', cat: 'Services', category: 'Services', price: 5000, stock: 0 },
]

let unmount, root, host
beforeEach(() => { localStorage.clear(); createSale.mockReset() })
afterEach(async () => { if (unmount) await unmount(); unmount = null })

async function renderPOS(products = CATALOGUE) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={{ id: 'b' }} products={products} setProducts={vi.fn()} role='Owner' perms={{}} /></MemoryRouter>)
  })
  unmount = async () => { await act(async () => root.unmount()); host.remove() }
  return host
}
const rerender = async (products) => {
  await act(async () => { root.render(<MemoryRouter><POS brand={{ id: 'b' }} products={products} setProducts={vi.fn()} role='Owner' perms={{}} /></MemoryRouter>) })
}
const click = async (el) => { await act(async () => { el.click() }) }
const add = (name) => click(host.querySelector(`button[aria-label^="Add ${name}"]`))
const qtyInput = (name) => host.querySelector(`input[aria-label="Quantity of ${name}"]`)
const type = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const text = () => host.textContent

describe('POS stock validation', () => {
  it('adding beyond the stock is refused with the quantity available', async () => {
    await renderPOS()
    await add('Amoxicillin'); await add('Amoxicillin'); await add('Amoxicillin')
    expect(qtyInput('Amoxicillin 500mg').value).toBe('3')
    await add('Amoxicillin')
    expect(qtyInput('Amoxicillin 500mg').value).toBe('3')
    expect(text()).toContain('Only 3 Amoxicillin 500mg in stock')
  })

  it('a typed quantity above the stock is set to the stock, with an alert', async () => {
    await renderPOS()
    await add('Amoxicillin')
    await type(qtyInput('Amoxicillin 500mg'), '10')
    expect(qtyInput('Amoxicillin 500mg').value).toBe('3')
    expect(text()).toContain('You asked for 10, so the quantity is set to 3')
    // the + button cannot pass it either
    await click(host.querySelector('button[aria-label="Increase quantity"]'))
    expect(qtyInput('Amoxicillin 500mg').value).toBe('3')
  })

  it('services are not limited by stock', async () => {
    await renderPOS()
    await add('Consultation')
    await type(qtyInput('Consultation'), '4')
    expect(qtyInput('Consultation').value).toBe('4')
  })

  it('a cart above the current stock cannot be charged until it is reduced', async () => {
    await renderPOS()
    await add('Amoxicillin'); await add('Amoxicillin'); await add('Amoxicillin')
    // Another till sold two: the catalogue now has 1.
    await rerender([{ ...CATALOGUE[0], stock: 1 }, CATALOGUE[1]])
    expect(host.querySelector('[data-testid="pos-line-stock"]').textContent).toContain('Only 1 in stock')
    expect(host.querySelector('[data-testid="pos-stock-banner"]').textContent).toContain('3 in sale, 1 in stock')
    await click(host.querySelector('button.pos-charge'))
    expect(createSale).not.toHaveBeenCalled()
    expect(text()).toContain('Reduce the quantity before charging')
    // Lowering is allowed; "Set to available stock" fixes every line at once.
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Set to available stock'))
    expect(qtyInput('Amoxicillin 500mg').value).toBe('1')
    expect(host.querySelector('[data-testid="pos-stock-banner"]')).toBeNull()
  })
})
