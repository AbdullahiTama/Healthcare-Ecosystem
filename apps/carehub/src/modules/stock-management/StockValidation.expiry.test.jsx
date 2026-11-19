// Stock Validation corrects expiry dates as well as quantities (carehub_20270129_stock_count_expiry). Staff found wrong
// or missing expiry dates while counting but could only change quantities here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => ({ auth: { staff: { full_name: 'Ada Owner', id: 'user-1' } } })),
  AuthContext: { Provider: ({ children }) => children },
}))

import StockValidation, { buildValidationItems, expiryChange, toDateInput } from './StockValidation.jsx'
import StockHistory from './StockHistory.jsx'
import { stockValidationRepository, createStockValidationRepository } from './repositories/index.js'

const BRAND = { id: 'biz-1' }
const AMOX = { id: 'p1', name: 'Amoxicillin', stock: 20, price: 12, cat: 'Antibiotics', expiry_date: '2027-01-31', tracking_mode: 'none' }
const VITC = { id: 'p2', name: 'Vitamin C', stock: 5, price: 5, cat: 'Supplements', expiry_date: null, tracking_mode: 'none' }
const BP = { id: 'p3', name: 'BP check', stock: 0, price: 500, cat: 'Services', expiry_date: null }
const INSULIN = { id: 'p4', name: 'Insulin', stock: 4, price: 5000, cat: 'Medicines', expiry_date: '2027-03-01', tracking_mode: 'batch_expiry' }

function setValue(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

let saveSpy, loadProducts
beforeEach(() => {
  saveSpy = vi.spyOn(stockValidationRepository, 'saveSession').mockResolvedValue({ sessionId: 's1' })
  loadProducts = vi.fn()
})
afterEach(() => { saveSpy.mockRestore(); document.body.innerHTML = '' })

async function render(products = [AMOX, VITC, BP, INSULIN]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<StockValidation brand={BRAND} products={products} loadProducts={loadProducts} />) })
  return host
}
async function add(host, name) {
  const row = [...host.querySelectorAll('div')].find(d => d.style.cursor === 'pointer' && d.textContent.startsWith(name))
  await act(async () => { row.click() })
}
const expiryInput = (host, name) => host.querySelector(`input[aria-label="Expiry date for ${name}"]`)
async function saveCount(host) {
  await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Save Validation' && !b.closest('[role="dialog"]')).click() })
  const dialog = host.querySelector('[role="dialog"]')
  const text = dialog.textContent
  await act(async () => { [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Save Validation').click() })
  return text
}

describe('Stock Validation: expiry dates', () => {
  it('shows the product\'s current expiry on its line, ready to correct', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    expect(expiryInput(host, 'Amoxicillin').value).toBe('2027-01-31')
    await add(host, 'Vitamin C')
    expect(expiryInput(host, 'Vitamin C').value).toBe('')
    expect(host.textContent).toContain('Not set')
  })

  it('saves a corrected expiry with no quantity change, and says what it was', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    await act(async () => { setValue(expiryInput(host, 'Amoxicillin'), '2028-06-30') })
    expect(host.textContent).toContain('Was 31 Jan 2027')
    const summary = await saveCount(host)
    expect(summary).toContain('Expiry dates updated1')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const [, session, items] = saveSpy.mock.calls[0]
    expect(session.products_adjusted).toBe(1)
    expect(items).toEqual([expect.objectContaining({ product_id: 'p1', adjustment_qty: 0, new_expiry_date: '2028-06-30' })])
    expect(host.textContent).toContain('Validation saved successfully')
    expect(loadProducts).toHaveBeenCalled()
  })

  it('saves a quantity adjustment and an expiry correction on the same line together', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    await act(async () => { setValue(host.querySelector('input[aria-label="Adjustment quantity for Amoxicillin"]'), '3') })
    await act(async () => { setValue(expiryInput(host, 'Amoxicillin'), '2027-05-31') })
    await saveCount(host)
    expect(saveSpy.mock.calls[0][2]).toEqual([expect.objectContaining({ adjustment_qty: 3, adjustment_direction: '+', new_stock: 23, new_expiry_date: '2027-05-31' })])
  })

  it('sets an expiry on a product that had none', async () => {
    const host = await render()
    await add(host, 'Vitamin C')
    await act(async () => { setValue(expiryInput(host, 'Vitamin C'), '2027-09-30') })
    await saveCount(host)
    expect(saveSpy.mock.calls[0][2][0]).toMatchObject({ product_id: 'p2', new_expiry_date: '2027-09-30' })
  })

  it('an unchanged expiry is not sent, and an untouched line is left out of the save', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    await add(host, 'Vitamin C')
    await act(async () => { setValue(host.querySelector('input[aria-label="Adjustment quantity for Vitamin C"]'), '2') })
    await saveCount(host)
    const items = saveSpy.mock.calls[0][2]
    expect(items.map(i => i.product_id)).toEqual(['p2'])
    expect(items[0]).not.toHaveProperty('new_expiry_date')
  })

  it('warns when the date entered has already passed (expired stock found in the count)', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    await act(async () => { setValue(expiryInput(host, 'Amoxicillin'), '2020-01-31') })
    expect(host.textContent).toContain('this date has passed')
  })

  it('no expiry field for a service, or a batch-tracked product (its dates are on its batches)', async () => {
    const host = await render()
    await add(host, 'BP check')
    await add(host, 'Insulin')
    expect(expiryInput(host, 'BP check')).toBeNull()
    expect(expiryInput(host, 'Insulin')).toBeNull()
  })

  it('the expiry field has an accessible name and keeps Enter from submitting', async () => {
    const host = await render()
    await add(host, 'Amoxicillin')
    const input = expiryInput(host, 'Amoxicillin')
    expect(host.querySelector(`label[for="${input.id}"]`).textContent).toBe('Expiry date')
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })
})

describe('expiry helpers', () => {
  const line = (product, expiryDate) => ({ product, currentStock: product.stock, adjustmentQty: 0, direction: '+', reason: '', expiryDate })
  it('expiryChange: only a real change on an editable product', () => {
    expect(expiryChange(line(AMOX, '2027-01-31'))).toBeNull()
    expect(expiryChange(line(AMOX, '2028-01-31'))).toBe('2028-01-31')
    expect(expiryChange(line(AMOX, ''))).toBeNull()
    expect(expiryChange(line(BP, '2028-01-31'))).toBeNull()
    expect(expiryChange(line(INSULIN, '2028-01-31'))).toBeNull()
    expect(expiryChange(line({ ...AMOX, expiry_date: '2027-01-31T00:00:00+00:00' }, '2027-01-31'))).toBeNull()
  })
  it('toDateInput keeps the calendar date only', () => {
    expect(toDateInput('2027-01-31T10:00:00Z')).toBe('2027-01-31')
    expect(toDateInput(null)).toBe('')
    expect(toDateInput('garbage')).toBe('')
  })
  it('buildValidationItems adds new_expiry_date only to changed lines', () => {
    const items = buildValidationItems([line(AMOX, '2027-01-31'), line(VITC, '2027-02-28')])
    expect(items[0]).not.toHaveProperty('new_expiry_date')
    expect(items[1].new_expiry_date).toBe('2027-02-28')
  })
})

describe('repository: new_expiry_date on the wire', () => {
  it('sends a calendar date and drops anything else', async () => {
    const request = vi.fn(async () => 'session-id')
    const repo = createStockValidationRepository(request)
    await repo.saveSession('biz-1', { user_name: 'x', products_checked: 3, products_adjusted: 3 }, [
      { product_id: 'p1', adjustment_qty: 0, new_expiry_date: '2028-06-30' },
      { product_id: 'p2', adjustment_qty: 0, new_expiry_date: '2028-06-30T00:00:00Z' },
      { product_id: 'p3', adjustment_qty: 1, new_expiry_date: 'soon' },
      { product_id: 'p4', adjustment_qty: 1 },
    ], null, 'k')
    const sent = JSON.parse(request.mock.calls[0][1].body).p_items
    expect(sent.map(i => i.new_expiry_date)).toEqual(['2028-06-30', '2028-06-30', undefined, undefined])
    expect('new_expiry_date' in sent[2]).toBe(false)
  })
})

describe('Stock history shows expiry corrections', () => {
  it('shows the saved date, and "was …" when the count corrected it', async () => {
    const getSessions = vi.spyOn(stockValidationRepository, 'getSessions').mockResolvedValue([
      { id: 's1', created_at: '2026-11-19T10:00:00Z', user_name: 'Ada', products_checked: 3, products_adjusted: 2, status: 'completed' },
    ])
    const getById = vi.spyOn(stockValidationRepository, 'getSessionById').mockResolvedValue({
      id: 's1', created_at: '2026-11-19T10:00:00Z', user_name: 'Ada', products_checked: 3, products_adjusted: 2, status: 'completed',
      items: [
        { id: 'i1', product_name: 'Amoxicillin', previous_stock: 20, adjustment_qty: 0, adjustment_direction: '+', new_stock: 20, unit_price: 12, previous_expiry_date: '2027-01-31', new_expiry_date: '2028-06-30' },
        { id: 'i2', product_name: 'Vitamin C', previous_stock: 5, adjustment_qty: 2, adjustment_direction: '+', new_stock: 7, unit_price: 5, previous_expiry_date: '2027-02-28', new_expiry_date: '2027-02-28' },
        { id: 'i3', product_name: 'Old line', previous_stock: 1, adjustment_qty: 1, adjustment_direction: '-', new_stock: 0, unit_price: 5, previous_expiry_date: null, new_expiry_date: null },
      ],
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => { createRoot(host).render(<StockHistory brand={BRAND} />) })
    await act(async () => {})
    const view = [...host.querySelectorAll('button')].find(b => b.textContent === 'View Details')
    await act(async () => { view.click() })
    await act(async () => {})
    expect(getById).toHaveBeenCalled()
    expect(host.textContent).toContain('30 Jun 2028')
    expect(host.textContent).toContain('was 31 Jan 2027')
    expect(host.textContent).toContain('28 Feb 2027')
    expect(host.textContent).toContain('Not recorded')
    getSessions.mockRestore(); getById.mockRestore()
  })
})
