// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. In the Master Catalog that put the code into the
// item form's price, cost or name and its Enter submitted the form; into a
// location's own price; and its Enter pressed a focused Push, Archive, Carry or
// Stop carrying button, or confirmed an open Push / Archive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repositories', () => ({
  PAGE_SIZE: 50,
  masterCatalogRepository: { getPage: vi.fn(), getCategories: vi.fn(), carry: vi.fn(), push: vi.fn(), archive: vi.fn(), restore: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() },
}))
vi.mock('../../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn() } }))
vi.mock('../../settings/repositories', () => ({ settingsRepository: { getPlanStatus: vi.fn(async () => ({ plan: 'growth', state: 'active', limits: {} })) } }))

import MasterCatalog from '../MasterCatalog.jsx'
import { PlanStatusProvider } from '../../../hooks/usePlanStatus.jsx'
import { masterCatalogRepository as repo } from '../repositories'
import { locationsRepository } from '../../locations/repositories'

const MAIN = { id: 'main', name: 'Allen Pharmacy', parent_business_id: null, plan_expires_at: '2027-01-01T00:00:00Z' }
const YABA = { id: 'yaba', branch_name: 'Yaba', parent_business_id: 'main' }
const AMOXIL = { id: 'm1', name: 'Amoxil 500', generic_name: 'Amoxicillin', category_code: 'antibiotics', rx_status: 'prescription_only', default_price: 1200, barcode: '6151100001',
  carried: [{ branch_id: 'main', product_id: 'p1', price: 1200, stock: 8, price_source: 'master', active: true }] }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const $ = (sel) => document.body.querySelector(sel)
const setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
// The scanner: a keydown and its input per character, back to back, then Enter.
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
  await flush()
}
// Counts Enter keydowns that reach `el` (a scan's Enter must not).
const countEnter = (el) => { const n = { v: 0 }; el.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.v++ }); return n }

async function show({ upgraded = true } = {}) {
  repo.getPage.mockResolvedValue({ items: [AMOXIL], total: 1, upgraded })
  await act(async () => {
    root.render(<MemoryRouter><PlanStatusProvider brand={MAIN}><MasterCatalog brand={MAIN} role='Owner' /></PlanStatusProvider></MemoryRouter>)
  })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getCategories.mockResolvedValue([{ code: 'antibiotics', label: 'Antibiotics', rx_default: 'prescription_only' }])
  repo.carry.mockResolvedValue(1)
  repo.push.mockResolvedValue(3)
  repo.create.mockResolvedValue({})
  repo.update.mockResolvedValue({})
  locationsRepository.getAll.mockResolvedValue([MAIN, YABA])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Master Catalog — item form: a scan goes into Barcode', () => {
  it('a scan in Default price fills Barcode, leaves the price, and its Enter does not submit', async () => {
    await show()
    await click(button('+ Add item'))
    await act(async () => { setValue($('#mc-name'), 'New Syrup'); setValue($('#mc-price'), '500') })
    const enter = countEnter($('#mc-price'))
    await scan($('#mc-price'), '8909999999999')
    expect(enter.v).toBe(0)
    expect($('#mc-price').value).toBe('500')
    expect($('#mc-barcode').value).toBe('8909999999999')
    expect(repo.create).not.toHaveBeenCalled()
    expect(text()).toContain('Scanned 8909999999999 into Barcode.')
  })

  it('a scan on the focused Save button does not save', async () => {
    await show()
    await click(button('Edit Amoxil 500'))
    const save = button('Save item')
    const enter = countEnter(save)
    await scan(save, '6151100009')
    expect(enter.v).toBe(0)
    expect(repo.update).not.toHaveBeenCalled()
    expect($('#mc-barcode').value).toBe('6151100009')
    expect($('#mc-name').value).toBe('Amoxil 500')
  })

  it('before the catalogue update (no Barcode field) a scan is undone and explained', async () => {
    await show({ upgraded: false })
    await click(button('+ Add item'))
    await act(async () => { setValue($('#mc-price'), '500') })
    await scan($('#mc-price'), '8909999999999')
    expect($('#mc-price').value).toBe('500')
    expect(text()).toContain('barcodes can be added once the catalogue update is installed')
  })

  it('typing a price by hand stays in the price', async () => {
    await show()
    await click(button('+ Add item'))
    const price = $('#mc-price')
    for (const ch of '1250000') {
      await act(async () => { keydown(price, ch); setValue(price, price.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(price.value).toBe('1250000')
    expect($('#mc-barcode').value).toBe('')
  })
})

describe('Master Catalog — dialogs without a barcode field', () => {
  it('Carry: a scan into the own price is undone and its Enter does not carry', async () => {
    await show()
    await act(async () => { $('input[aria-label="Select Amoxil 500"]').click() })
    await click(button('Carry at locations'))
    const yaba = [...document.body.querySelectorAll('label')].find((l) => l.textContent.includes('Yaba')).querySelector('input')
    await act(async () => { yaba.click() })
    await act(async () => { setValue($('#carry-price'), '900') })
    await scan($('#carry-price'), '8909999999999')
    expect($('#carry-price').value).toBe('900')
    expect(text()).toContain('Scan ignored (8909999999999)')
    const carry = button('Carry')
    const enter = countEnter(carry)
    await scan(carry, '8909999999999')
    expect(enter.v).toBe(0)
    expect(repo.carry).not.toHaveBeenCalled()
  })

  it('Locations: a scan into a location price, or onto Stop carrying, changes nothing', async () => {
    await show()
    await click(button('Locations and prices for Amoxil 500'))
    const price = $('#price-yaba')
    await act(async () => { setValue(price, '1100') })
    await scan(price, '8909999999999', 'Tab')
    expect($('#price-yaba').value).toBe('1100')
    const stop = button('Stop carrying at Main Location')
    const enter = countEnter(stop)
    await scan(stop, '8909999999999')
    expect(enter.v).toBe(0)
    expect(repo.deactivate).not.toHaveBeenCalled()
    expect(text()).toContain('Scan ignored (8909999999999)')
  })
})

describe('Master Catalog — list', () => {
  it('a scan with nothing focused searches the catalogue for the code at once', async () => {
    await show()
    await scan(document.body, '6151100001')
    expect($('input[type="search"]').value).toBe('6151100001')
    expect(repo.getPage).toHaveBeenLastCalledWith('main', expect.objectContaining({ search: '6151100001', offset: 0 }))
  })

  it('a scan on a focused Push button searches instead of pressing it', async () => {
    await show()
    const push = button('Push Amoxil 500 to every location')
    const enter = countEnter(push)
    await scan(push, '6151100001')
    expect(enter.v).toBe(0)
    expect(text()).not.toContain('locations with their own price keep it')
    expect($('input[type="search"]').value).toBe('6151100001')
  })

  it('a scan typed into the search box after other text replaces it with the code', async () => {
    await show()
    await act(async () => { setValue($('input[type="search"]'), 'amo') })
    await scan($('input[type="search"]'), '6151100001')
    expect($('input[type="search"]').value).toBe('6151100001')
  })

  it('with Push confirmation open, a scan does nothing and its Enter does not confirm', async () => {
    await show()
    await click(button('Push Amoxil 500 to every location'))
    const confirm = [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Push').pop()
    const enter = countEnter(confirm)
    await scan(confirm, '6151100001')
    expect(enter.v).toBe(0)
    expect(repo.push).not.toHaveBeenCalled()
    expect(text()).toContain('Scan ignored (6151100001): confirm or cancel first.')
    expect($('input[type="search"]').value).toBe('')
  })

  it('fields outside the Master Catalog are left alone', async () => {
    await show()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, '6151100001')
      expect(outside.value).toBe('6151100001')
      expect($('input[type="search"]').value).toBe('')
    } finally {
      outside.remove()
    }
  })
})
