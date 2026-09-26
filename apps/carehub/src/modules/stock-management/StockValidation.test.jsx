import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { createStockValidationRepository } from './repositories/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ── Mocks must be hoisted before component imports ────────────────────────
vi.mock('../../lib/authClient', () => ({
  authClient: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test', user: { id: 'u1' } } } })),
      refreshSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-refreshed', user: { id: 'u1' } } } })),
    },
  },
}))

vi.mock('../../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => ({ auth: { staff: { full_name: 'Ada Owner', id: 'user-1' } } })),
  AuthContext: { Provider: ({ children }) => children },
}))

import StockValidation, { parseAdjustmentQty, buildValidationItems } from './StockValidation.jsx'
import { authClient } from '../../lib/authClient.js'
import { stockValidationRepository } from './repositories/index.js'
import { useAuth } from '../../providers/AuthProvider.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────
const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const PRODUCT = { id: 'p1', name: 'Amoxicillin', generic_name: 'Amox', stock: 20, price: 12, cat: 'Antibiotics', shelf_label: 'A1' }
const PRODUCT_LOW = { id: 'p2', name: 'Paracetamol', generic_name: '', stock: 2, price: 5, cat: 'Analgesic', shelf_label: 'B2' }

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (desc && desc.set) desc.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderStockValidation({ brand = BRAND, products = [PRODUCT, PRODUCT_LOW] } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const loadProducts = vi.fn()
  await act(async () => { root.render(<StockValidation brand={brand} products={products} loadProducts={loadProducts} />) })
  // flush effects
  await act(async () => {})
  return { host, root, loadProducts }
}

function findProductRow(host, name) {
  const divs = Array.from(host.querySelectorAll('div'))
  return divs.find(d => d.textContent.includes(name) && d.style.cursor === 'pointer')
}

function getQtyInput(host) {
  return host.querySelector('input[type="number"]')
}

function getPlusButton(host) {
  // Plus button is the second 36px button in worksheet; we can find by aria-label or by its svg
  const btns = Array.from(host.querySelectorAll('button'))
  // The worksheet Plus has aria-label "Increase quantity" after hardening
  let btn = btns.find(b => b.getAttribute('aria-label') === 'Increase quantity')
  if (btn) return btn
  // fallback: find button that contains Plus icon (first is Minus, second is Plus in worksheet)
  // Worksheet buttons are 36x36
  const sized = btns.filter(b => b.style.width === '36px')
  return sized[1] || sized[0]
}

function getSaveValidationButton(host) {
  // "Save Validation" outside modal — first occurrence
  const btns = Array.from(host.querySelectorAll('button'))
  return btns.find(b => b.textContent.includes('Save Validation') && !b.closest('[role="dialog"]'))
}

function getModalSaveButton(host) {
  const dialog = host.querySelector('[role="dialog"]')
  if (!dialog) return null
  const btns = Array.from(dialog.querySelectorAll('button'))
  return btns.find(b => b.textContent.includes('Save Validation') || b.textContent.includes('Saving'))
}

async function addProductToWorksheet(host, name = 'Amoxicillin') {
  const row = findProductRow(host, name)
  expect(row, `product row for ${name} should exist`).toBeTruthy()
  await act(async () => { row.click() })
  await act(async () => {})
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('StockValidation hardening (spec-stock-validation-laptop-fix)', () => {
  let saveSpy

  beforeEach(() => {
    vi.clearAllMocks()
    // default auth session is fresh
    authClient.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test', user: { id: 'u1' } } } })
    authClient.auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'tok-refreshed', user: { id: 'u1' } } } })
    useAuth.mockReturnValue({ auth: { staff: { full_name: 'Ada Owner', id: 'user-1' } } })
    saveSpy = vi.spyOn(stockValidationRepository, 'saveSession').mockResolvedValue('session-uuid')
  })

  afterEach(async () => {
    saveSpy.mockRestore()
    document.body.innerHTML = ''
  })

  describe('parseAdjustmentQty / buildValidationItems parity (phone +/- vs laptop typed+Enter)', () => {
    it('parses typed string "5" and numeric 5 to identical quantity', () => {
      expect(parseAdjustmentQty('5')).toBe(5)
      expect(parseAdjustmentQty(5)).toBe(5)
      expect(parseAdjustmentQty('5.9')).toBe(5) // parseInt radix 10
      expect(parseAdjustmentQty('')).toBe(0)
      expect(parseAdjustmentQty('abc')).toBe(0)
      expect(parseAdjustmentQty(null)).toBe(0)
      expect(parseAdjustmentQty(undefined)).toBe(0)
    })

    it('clamps to 0..10000 and uses Math.max(0, parseInt(val,10)||0)', () => {
      expect(parseAdjustmentQty(-5)).toBe(0)
      expect(parseAdjustmentQty('-3')).toBe(0)
      expect(parseAdjustmentQty(9999)).toBe(9999)
      expect(parseAdjustmentQty(10000)).toBe(10000)
      expect(parseAdjustmentQty(15000)).toBe(10000)
      expect(parseAdjustmentQty('99999')).toBe(10000)
      expect(parseAdjustmentQty(' 7 ')).toBe(7)
    })

    it('phone +/- (5 increments) and laptop typed "5" produce identical p_items payload with new_stock int and reason null', () => {
      const phoneWorksheet = [{ product: PRODUCT, currentStock: 20, adjustmentQty: 5, direction: '+', reason: '' }]
      const laptopWorksheet = [{ product: PRODUCT, currentStock: 20, adjustmentQty: '5', direction: '+', reason: '' }]
      const phoneItems = buildValidationItems(phoneWorksheet)
      const laptopItems = buildValidationItems(laptopWorksheet)
      expect(phoneItems).toEqual(laptopItems)
      expect(phoneItems[0]).toEqual({
        product_id: 'p1',
        product_name: 'Amoxicillin',
        shelf_label: 'A1',
        previous_stock: 20,
        adjustment_qty: 5,
        adjustment_direction: '+',
        new_stock: 25,
        reason: null,
        unit_price: 12,
      })
      expect(typeof phoneItems[0].new_stock).toBe('number')
      expect(typeof phoneItems[0].adjustment_qty).toBe('number')
    })

    it('empty reason coerces to null and large qty clamps', () => {
      const ws = [{ product: PRODUCT, currentStock: 10, adjustmentQty: '99999', direction: '+', reason: '' }]
      const items = buildValidationItems(ws)
      expect(items[0].reason).toBeNull()
      expect(items[0].adjustment_qty).toBe(10000)
      expect(items[0].new_stock).toBe(10000)
    })

    it('upper clamp 10000 — when adjustment would make new_stock >10000, client clamps to 10000', () => {
      expect(parseAdjustmentQty(15000)).toBe(10000)
      expect(parseAdjustmentQty('99999')).toBe(10000)
      expect(parseAdjustmentQty(10000)).toBe(10000)
      expect(parseAdjustmentQty(0)).toBe(0)
      // prev 9900 + qty 500 => raw 10400 should clamp to 10000
      const ws1 = [{ product: PRODUCT, currentStock: 9900, adjustmentQty: 500, direction: '+', reason: '' }]
      expect(buildValidationItems(ws1)[0].new_stock).toBe(10000)
      // prev 20 + clamped qty 15000 => qty becomes 10000, new_stock clamped to 10000
      const ws2 = [{ product: PRODUCT, currentStock: 20, adjustmentQty: 15000, direction: '+', reason: '' }]
      const items2 = buildValidationItems(ws2)
      expect(items2[0].adjustment_qty).toBe(10000)
      expect(items2[0].new_stock).toBe(10000)
      // still succeeds (no negative guard), new_stock is int
      expect(typeof items2[0].new_stock).toBe('number')
    })

    it('NaN qty treated as 0', () => {
      const ws = [{ product: PRODUCT, currentStock: 20, adjustmentQty: 'not-a-number', direction: '+', reason: 'Expired stock' }]
      const items = buildValidationItems(ws)
      expect(items[0].adjustment_qty).toBe(0)
      expect(items[0].new_stock).toBe(20)
      expect(items[0].reason).toBe('Expired stock')
    })

    it('repository seam sanitizes new_stock to int regardless of string vs number', async () => {
      const calls = []
      const request = vi.fn(async (path, opts) => {
        calls.push(JSON.parse(opts.body))
        return 'uuid-1'
      })
      const repo = createStockValidationRepository(request)
      const itemsPhone = [{ product_id: 'p1', new_stock: 25, adjustment_qty: 5, previous_stock: 20, product_name: 'Amox', shelf_label: 'A1', adjustment_direction: '+', reason: null, unit_price: 12 }]
      const itemsLaptop = [{ product_id: 'p1', new_stock: '25', adjustment_qty: '5', previous_stock: '20', product_name: 'Amox', shelf_label: 'A1', adjustment_direction: '+', reason: '', unit_price: 12 }]
      await repo.saveSession('biz-1', { user_name: 'Ada', products_checked: 1, products_adjusted: 1 }, itemsPhone, 'user-1')
      await repo.saveSession('biz-1', { user_name: 'Ada', products_checked: 1, products_adjusted: 1 }, itemsLaptop, 'user-1')
      expect(calls[0].p_items[0].new_stock).toBe(25)
      expect(calls[1].p_items[0].new_stock).toBe(25)
      expect(typeof calls[0].p_items[0].new_stock).toBe('number')
      expect(typeof calls[1].p_items[0].new_stock).toBe('number')
      expect(calls[0].p_items).toEqual(calls[1].p_items)
    })
  })

  describe('negative stock blocked (client guard before RPC)', () => {
    it('blocks save when new_stock would be negative and shows inline error, no RPC fired', async () => {
      const { host } = await renderStockValidation({ products: [PRODUCT_LOW] })
      await addProductToWorksheet(host, 'Paracetamol')
      // PRODUCT_LOW stock 2, adjust -5 => new_stock -3
      const input = getQtyInput(host)
      expect(input).toBeTruthy()
      await act(async () => { setNativeValue(input, '5') })
      await act(async () => {})
      // change direction to Remove
      const dirSelect = host.querySelector('select')
      // The first select after input is direction; there are two selects (direction, reason)
      // Find select with options Add/Remove
      const selects = Array.from(host.querySelectorAll('select'))
      const directionSelect = selects.find(s => Array.from(s.options).some(o => o.value === '-'))
      expect(directionSelect).toBeTruthy()
      await act(async () => {
        directionSelect.value = '-'
        directionSelect.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => {})

      // Worksheet should show inline error "Cannot go below 0" before save
      // The computed new_stock is rendered as text; check that input border turned red or alert present
      // Now try to save
      const saveBtn = getSaveValidationButton(host)
      expect(saveBtn).toBeTruthy()
      await act(async () => { saveBtn.click() })
      await act(async () => {})
      const modalSave = getModalSaveButton(host)
      expect(modalSave).toBeTruthy()
      await act(async () => { modalSave.click() })
      await act(async () => {})

      expect(stockValidationRepository.saveSession).not.toHaveBeenCalled()
      // toast or inline error should contain Cannot go below 0
      expect(host.textContent).toContain('Cannot go below 0')
      // No session + items inserted — verified by no RPC
    })

    it('buildValidationItems flags negative new_stock for guard', () => {
      const ws = [{ product: PRODUCT_LOW, currentStock: 2, adjustmentQty: 5, direction: '-', reason: '' }]
      const items = buildValidationItems(ws)
      expect(items[0].new_stock).toBe(-3)
      expect(items[0].new_stock < 0).toBe(true)
    })
  })

  describe('double-click / Enter ignored (saving disabled + aria-busy)', () => {
    it('second click while saving is ignored (early return if saving)', async () => {
      let resolveSave
      saveSpy.mockImplementation(() => new Promise(res => { resolveSave = res }))
      const { host } = await renderStockValidation()
      await addProductToWorksheet(host, 'Amoxicillin')
      const input = getQtyInput(host)
      await act(async () => { setNativeValue(input, '5') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      const modalSave = getModalSaveButton(host)
      expect(modalSave).toBeTruthy()
      expect(modalSave.getAttribute('aria-busy')).toBeFalsy() // not yet saving
      // first click
      await act(async () => { modalSave.click() })
      await act(async () => {})
      // button should now be disabled and aria-busy true
      expect(modalSave.disabled).toBe(true)
      expect(modalSave.getAttribute('aria-busy')).toBe('true')
      // second click should be ignored (disabled, but also early return guard)
      await act(async () => { modalSave.click() })
      await act(async () => {})
      expect(stockValidationRepository.saveSession).toHaveBeenCalledTimes(1)
      // resolve first save
      await act(async () => { resolveSave('uuid-2') })
      await act(async () => {})
      // after resolve, saving false, button enabled again
      // save should have succeeded
      expect(host.textContent).toContain('Validation saved successfully')
    })

    it('phone +/- taps and laptop Enter produce same payload after confirmSave', async () => {
      // Phone path: use Plus button
      const { host: hostPhone, root: rootPhone } = await renderStockValidation()
      await addProductToWorksheet(hostPhone, 'Amoxicillin')
      const plus = getPlusButton(hostPhone)
      expect(plus).toBeTruthy()
      for (let i = 0; i < 5; i++) {
        await act(async () => { plus.click() })
        await act(async () => {})
      }
      await act(async () => { getSaveValidationButton(hostPhone).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(hostPhone).click() })
      await act(async () => {})
      const phonePayload = saveSpy.mock.calls[0]?.[2]?.[0]
      expect(phonePayload?.new_stock).toBe(25)
      expect(phonePayload?.adjustment_qty).toBe(5)
      await act(async () => { rootPhone.unmount() })
      document.body.innerHTML = ''
      saveSpy.mockClear()

      // Laptop path: typed "5" + Enter (Enter is prevented default but same payload)
      const { host: hostLaptop } = await renderStockValidation()
      await addProductToWorksheet(hostLaptop, 'Amoxicillin')
      const input = getQtyInput(hostLaptop)
      await act(async () => { setNativeValue(input, '5') })
      await act(async () => {})
      // simulate Enter key in input (should not double-fire, same payload)
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      await act(async () => { getSaveValidationButton(hostLaptop).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(hostLaptop).click() })
      await act(async () => {})
      const laptopPayload = saveSpy.mock.calls[0]?.[2]?.[0]
      expect(laptopPayload?.new_stock).toBe(25)
      expect(laptopPayload?.adjustment_qty).toBe(5)
      expect(laptopPayload).toEqual(phonePayload)
    })
  })

  describe('brand.id null blocked', () => {
    it('shows Missing business toast and never calls RPC when brand is null', async () => {
      const { host } = await renderStockValidation({ brand: null })
      // Add product still possible? Brand null should still allow adding but save blocked
      await addProductToWorksheet(host, 'Amoxicillin')
      const input = getQtyInput(host)
      await act(async () => { setNativeValue(input, '5') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      const modalSave = getModalSaveButton(host)
      await act(async () => { modalSave.click() })
      await act(async () => {})
      expect(stockValidationRepository.saveSession).not.toHaveBeenCalled()
      expect(host.textContent).toContain('Missing business')
    })

    it('shows Missing business when brand.id is undefined', async () => {
      const { host } = await renderStockValidation({ brand: {} })
      await addProductToWorksheet(host, 'Amoxicillin')
      await act(async () => { setNativeValue(getQtyInput(host), '3') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(host).click() })
      await act(async () => {})
      expect(stockValidationRepository.saveSession).not.toHaveBeenCalled()
      expect(host.textContent).toContain('Missing business')
    })

    it('repository throws if businessId is null (input guard)', async () => {
      const repo = createStockValidationRepository(vi.fn(async () => 'uuid'))
      await expect(repo.saveSession(null, { user_name: 'Ada', products_checked: 1, products_adjusted: 1 }, [], 'u1')).rejects.toThrow(/Missing business/)
      await expect(repo.saveSession(undefined, { user_name: 'Ada', products_checked: 1, products_adjusted: 1 }, [], 'u1')).rejects.toThrow(/Missing business/)
      await expect(repo.saveSession('', { user_name: 'Ada', products_checked: 1, products_adjusted: 1 }, [], 'u1')).rejects.toThrow(/Missing business/)
    })
  })

  describe('session expired handling (laptop stale token)', () => {
    it('shows Session expired when getSession is null and refresh fails, no RPC fired', async () => {
      authClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
      authClient.auth.refreshSession.mockResolvedValueOnce({ data: { session: null } })
      const { host } = await renderStockValidation()
      await addProductToWorksheet(host, 'Amoxicillin')
      await act(async () => { setNativeValue(getQtyInput(host), '5') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(host).click() })
      await act(async () => {})
      expect(stockValidationRepository.saveSession).not.toHaveBeenCalled()
      expect(host.textContent).toContain('Session expired')
      expect(authClient.auth.refreshSession).toHaveBeenCalled()
    })

    it('retries once after refreshSession succeeds', async () => {
      // first getSession null, refresh succeeds, then save should proceed
      authClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
      authClient.auth.refreshSession.mockResolvedValueOnce({ data: { session: { access_token: 'fresh' } } })
      const { host } = await renderStockValidation()
      await addProductToWorksheet(host, 'Amoxicillin')
      await act(async () => { setNativeValue(getQtyInput(host), '2') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(host).click() })
      await act(async () => {})
      expect(stockValidationRepository.saveSession).toHaveBeenCalledTimes(1)
      expect(host.textContent).toContain('Validation saved successfully')
    })

    it('on 42501 error, retries after refresh and shows Session expired if retry fails', async () => {
      saveSpy.mockRejectedValueOnce(new Error('Supabase error (42501): permission denied'))
      authClient.auth.refreshSession.mockResolvedValueOnce({ data: { session: null } })
      const { host } = await renderStockValidation()
      await addProductToWorksheet(host, 'Amoxicillin')
      await act(async () => { setNativeValue(getQtyInput(host), '1') })
      await act(async () => {})
      await act(async () => { getSaveValidationButton(host).click() })
      await act(async () => {})
      await act(async () => { getModalSaveButton(host).click() })
      await act(async () => {})
      // should have tried save, then refresh, then shown Session expired
      expect(authClient.auth.refreshSession).toHaveBeenCalled()
      expect(host.textContent).toContain('Session expired')
    })
  })
})
