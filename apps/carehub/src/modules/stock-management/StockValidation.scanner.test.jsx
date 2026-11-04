// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. On a stock count that was usually a row's
// Adjustment quantity, which clamps to 10000: a scan became a 10000 unit
// adjustment. Scanning could not add a product to the count either.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => ({ auth: { staff: { full_name: 'Ada Owner', id: 'user-1' } } })),
  AuthContext: { Provider: ({ children }) => children },
}))
const saveSession = vi.fn(async () => ({}))
vi.mock('./repositories', () => ({
  stockValidationRepository: { saveSession: (...a) => saveSession(...a) },
  isCountRefusal: () => false,
}))

import StockValidation from './StockValidation.jsx'

const AMOX = { id: 'p1', name: 'Amoxicillin', generic_name: 'Amox', stock: 20, price: 12, cat: 'Antibiotics', barcode: '6151100001' }
const PARA = { id: 'p2', name: 'Paracetamol', generic_name: '', stock: 2, price: 5, cat: 'Analgesic', barcode: '6152200002' }

let host
let root
beforeEach(async () => {
  saveSession.mockClear()
  // jsdom has no scrollIntoView; the "already on the count" path uses it.
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<StockValidation brand={{ id: 'biz-1' }} products={[AMOX, PARA]} loadProducts={vi.fn()} />) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
}
const qtyOf = (name) => host.querySelector(`input[aria-label="Adjustment quantity for ${name}"]`)
const search = () => host.querySelector('input[aria-label="Search products"]')
const button = (text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('Stock Validation — USB scanner', () => {
  it('a scan with nothing focused adds the product to the count and focuses its quantity', async () => {
    await scan(document.body, '6151100001')
    expect(qtyOf('Amoxicillin')).not.toBeNull()
    expect(qtyOf('Amoxicillin').value).toBe('0')
    expect(document.activeElement).toBe(qtyOf('Amoxicillin'))
    expect(host.textContent).toContain('Added: Amoxicillin')
  })

  it('a scan while a quantity has focus adds the next product and leaves that quantity alone', async () => {
    await scan(document.body, '6151100001')
    await act(async () => { setValue(qtyOf('Amoxicillin'), '3') })
    await scan(qtyOf('Amoxicillin'), '6152200002')
    expect(qtyOf('Amoxicillin').value).toBe('3')
    expect(host.textContent).not.toContain('10000')
    expect(qtyOf('Paracetamol').value).toBe('0')
    expect(document.activeElement).toBe(qtyOf('Paracetamol'))
  })

  it('scanning a product already on the count keeps its quantity and points at its row', async () => {
    await scan(document.body, '6151100001')
    await act(async () => { setValue(qtyOf('Amoxicillin'), '4') })
    await scan(qtyOf('Amoxicillin'), '6151100001')
    expect(host.querySelectorAll('input[aria-label^="Adjustment quantity"]')).toHaveLength(1)
    expect(qtyOf('Amoxicillin').value).toBe('4')
    expect(host.textContent).toContain('This product is already on the validation screen')
  })

  it('a scan into the search box adds the product and keeps what was typed before it', async () => {
    await act(async () => { setValue(search(), 'par') })
    await scan(search(), '6151100001')
    expect(qtyOf('Amoxicillin')).not.toBeNull()
    expect(search().value).toBe('par')
  })

  it('an unknown code goes into search with a warning and changes no quantity', async () => {
    await scan(document.body, '6151100001')
    await act(async () => { setValue(qtyOf('Amoxicillin'), '2') })
    await scan(qtyOf('Amoxicillin'), '8900000000000', 'Tab')
    expect(qtyOf('Amoxicillin').value).toBe('2')
    expect(search().value).toBe('8900000000000')
    expect(host.textContent).toContain('No product has the barcode 8900000000000.')
  })

  it('a scanner that sends no Enter is still caught once the keys stop', async () => {
    await scan(document.body, '6151100001')
    await scan(qtyOf('Amoxicillin'), '6152200002', null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(qtyOf('Amoxicillin').value).toBe('0')
    expect(qtyOf('Paracetamol')).not.toBeNull()
  })

  it('with the summary open, a scan changes nothing and its Enter does not save', async () => {
    await scan(document.body, '6151100001')
    await act(async () => { setValue(qtyOf('Amoxicillin'), '2') })
    await act(async () => { button('Save Validation').click() })
    const confirm = [...host.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Save Validation')
    let enterReachedButton = 0
    confirm.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterReachedButton++ })
    await scan(confirm, '6152200002')
    expect(enterReachedButton).toBe(0)
    expect(saveSession).not.toHaveBeenCalled()
    expect(qtyOf('Paracetamol')).toBeNull()
    expect(host.textContent).toContain('Close the summary to add scanned products.')
  })

  it('typing a count by hand stays in the quantity', async () => {
    await scan(document.body, '6151100001')
    const qty = qtyOf('Amoxicillin')
    await act(async () => { setValue(qty, '') })
    for (const ch of '125') {
      await act(async () => { keydown(qty, ch); setValue(qty, qty.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(Number(qtyOf('Amoxicillin').value)).toBe(125)
    expect(host.textContent).toContain('New Stock: 145')
  })

  it('fields outside Stock Validation are left alone', async () => {
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, '6151100001')
      expect(outside.value).toBe('6151100001')
      expect(qtyOf('Amoxicillin')).toBeNull()
    } finally {
      outside.remove()
    }
  })
})
