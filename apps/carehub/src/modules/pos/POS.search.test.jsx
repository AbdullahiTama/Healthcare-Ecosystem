// The POS product search stays instant on a large catalogue: the box updates
// on every key press and the grid draws only a page of cards. Staff reported
// the search freezing when deleting the last letters of a product name, when
// almost the whole catalogue matched again and every card was drawn at once.
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

import POS, { GRID_PAGE } from './POS.jsx'

// The sale in progress is kept in localStorage (posDraft.js); each test starts with an empty till.
beforeEach(() => { localStorage.clear() })

const CATALOGUE = Array.from({ length: 2000 }, (_, i) => ({
  id: 'p' + i, name: `Paracetamol ${String(i).padStart(4, '0')} tabs`, cat: 'OTC', category: 'OTC', price: 100 + i, stock: 10,
}))
CATALOGUE.push({ id: 'amox', name: 'Amoxicillin 500mg', cat: 'Rx', category: 'Rx', price: 1200, stock: 5 })

let unmount
afterEach(async () => { if (unmount) await unmount(); unmount = null })

async function renderPOS() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={{ id: 'b' }} products={CATALOGUE} setProducts={vi.fn()} role='Owner' perms={{}} /></MemoryRouter>)
  })
  unmount = async () => { await act(async () => root.unmount()); host.remove() }
  return host
}
const input = (host) => host.querySelector('input[aria-label="Search products"]')
const cards = (host) => [...host.querySelectorAll('button[aria-label^="Add "]')]
async function type(host, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(host), value)
    input(host).dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('POS search on a large catalogue', () => {
  it('draws one page of cards, not the whole catalogue, and offers more', async () => {
    const host = await renderPOS()
    expect(cards(host)).toHaveLength(GRID_PAGE)
    expect(host.textContent).toContain(`Showing ${GRID_PAGE} of 2,001 products`)
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === `Show ${GRID_PAGE} more`).click() })
    expect(cards(host)).toHaveLength(GRID_PAGE * 2)
  })

  it('narrows as you type and widens again as you delete, never past one page', async () => {
    const host = await renderPOS()
    await type(host, 'amoxicillin')
    expect(input(host).value).toBe('amoxicillin')
    expect(cards(host).map((b) => b.getAttribute('aria-label'))).toEqual(['Add Amoxicillin 500mg'])
    // Deleting back letter by letter: the box follows every key, the grid stays bounded.
    for (const v of ['amoxicilli', 'amox', 'a', '']) {
      await type(host, v)
      expect(input(host).value).toBe(v)
      expect(cards(host).length).toBeLessThanOrEqual(GRID_PAGE)
    }
    expect(cards(host)).toHaveLength(GRID_PAGE)
  })

  it('finds words in any order', async () => {
    const host = await renderPOS()
    await type(host, '0042 paracetamol')
    expect(cards(host).map((b) => b.getAttribute('aria-label'))).toEqual(['Add Paracetamol 0042 tabs'])
  })

  it('a new search starts again from the first page', async () => {
    const host = await renderPOS()
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === `Show ${GRID_PAGE} more`).click() })
    await type(host, 'para')
    expect(cards(host)).toHaveLength(GRID_PAGE)
  })

  it('adding a product still works from the paged grid, and the card shows the quantity', async () => {
    const host = await renderPOS()
    await type(host, 'amoxicillin')
    await act(async () => { cards(host)[0].click() })
    await act(async () => { cards(host)[0].click() })
    expect(cards(host)[0].getAttribute('aria-label')).toBe('Add Amoxicillin 500mg (2 in sale)')
  })
})
