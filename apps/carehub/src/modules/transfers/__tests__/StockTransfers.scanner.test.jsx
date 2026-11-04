// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. In Stock Transfers that put the code into a line's
// Quantity or a Received count, and its Enter pressed a focused Send, Confirm
// received or Cancel transfer button. Scanning could not add an item either.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ list: vi.fn(), sendable: vi.fn(), findByBarcode: vi.fn(), send: vi.fn(), receive: vi.fn(), cancel: vi.fn() }))
vi.mock('../repositories', () => ({ transferRepository: repo }))
vi.mock('../../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn(async () => [MAIN, IKEJA, YABA]) } }))

import StockTransfers from '../StockTransfers.jsx'

const MAIN = { id: 'main', name: 'Allen', parent_business_id: null }
const IKEJA = { id: 'ikeja', name: 'Allen · Ikeja', branch_name: 'Ikeja', parent_business_id: 'main' }
const YABA = { id: 'yaba', name: 'Allen · Yaba', branch_name: 'Yaba', parent_business_id: 'main' }
const INCOMING = { id: 't1', transfer_no: 'TRF-1', status: 'in_transit', from_branch_id: 'ikeja', to_branch_id: 'yaba', sent_at: '2026-10-28T10:00:00Z',
  stock_transfer_lines: [{ id: 'l1', product_name: 'Amoxil 500', qty_sent: 10, qty_received: null }] }
const OUTGOING = { id: 't2', transfer_no: 'TRF-2', status: 'in_transit', from_branch_id: 'yaba', to_branch_id: 'main', sent_at: '2026-10-28T11:00:00Z',
  stock_transfer_lines: [{ id: 'l3', product_name: 'Paracetamol', qty_sent: 3, qty_received: null }] }
const PARA = { id: 'p1', name: 'Paracetamol', stock: 12, master_product_id: 'm-para' }
const VITC = { id: 'p2', name: 'Vitamin C', stock: 5, master_product_id: 'm-vitc' }
const BY_CODE = { '6151100001': [PARA], '6152200002': [VITC], '6150000000': [{ id: 'p3', name: 'Loose Gauze', stock: 4, master_product_id: null }], '6159999999': [{ ...VITC, stock: 0 }] }

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const $ = (sel) => document.body.querySelector(sel)
const btn = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
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
  await flush(); await flush()
}
const countEnter = (el) => { const n = { v: 0 }; el.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.v++ }); return n }
async function show(role = 'Branch Manager') {
  await act(async () => { root.render(<StockTransfers brand={YABA} role={role} loadProducts={vi.fn()} />) })
  await flush(); await flush()
}
const sendButton = () => [...document.body.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim().startsWith('Send '))

beforeEach(() => {
  vi.clearAllMocks()
  repo.list.mockResolvedValue({ available: true, transfers: [INCOMING, OUTGOING] })
  repo.sendable.mockResolvedValue([PARA])
  repo.findByBarcode.mockImplementation(async (_loc, code) => BY_CODE[code] || [])
  repo.send.mockResolvedValue({ id: 't3', transfer_no: 'TRF-3' })
  repo.receive.mockResolvedValue({ shortfall: 0 })
  repo.cancel.mockResolvedValue({ status: 'cancelled' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Stock Transfers — Send stock: a scan adds the item', () => {
  it('a scan in the dialog adds the item and focuses its quantity', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '6151100001')
    expect(repo.findByBarcode).toHaveBeenCalledWith('yaba', '6151100001')
    expect($('#qty-m-para')).not.toBeNull()
    expect(document.activeElement).toBe($('#qty-m-para'))
    expect(text()).toContain('Added Paracetamol. Enter the quantity.')
  })

  it('a scan while a quantity has focus adds the next item and leaves that quantity alone', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '6151100001')
    await act(async () => { setValue($('#qty-m-para'), '4') })
    await scan($('#qty-m-para'), '6152200002')
    expect($('#qty-m-para').value).toBe('4')
    expect($('#qty-m-vitc')).not.toBeNull()
  })

  it('scanning an item already in the list keeps its quantity', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '6151100001')
    await act(async () => { setValue($('#qty-m-para'), '4') })
    await scan($('#qty-m-para'), '6151100001', 'Tab')
    expect($('#qty-m-para').value).toBe('4')
    expect(document.body.querySelectorAll('[id^="qty-"]')).toHaveLength(1)
    expect(text()).toContain('Already in the list: Paracetamol.')
  })

  it('the scanner\'s Enter on the focused Send button does not send', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '6151100001')
    await act(async () => { setValue($('#qty-m-para'), '4') })
    const send = sendButton()
    const enter = countEnter(send)
    await scan(send, '6152200002')
    expect(enter.v).toBe(0)
    expect(repo.send).not.toHaveBeenCalled()
  })

  it('says why an unknown, unlinked or out-of-stock code cannot be sent', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '8900000000000')
    expect(text()).toContain('No product here has the barcode 8900000000000.')
    await scan(document.body, '6150000000')
    expect(text()).toContain('Loose Gauze is not linked to the master catalogue, so it cannot be transferred.')
    await scan(document.body, '6159999999')
    expect(text()).toContain('Vitamin C has no stock here to send.')
    expect(document.body.querySelectorAll('[id^="qty-"]')).toHaveLength(0)
  })

  it('typing a quantity by hand stays in the quantity', async () => {
    await show()
    await click(btn('+ Send stock'))
    await scan(document.body, '6151100001')
    const qty = $('#qty-m-para')
    for (const ch of '120000') {
      await act(async () => { keydown(qty, ch); setValue(qty, qty.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(qty.value).toBe('120000')
    expect(repo.findByBarcode).toHaveBeenCalledTimes(1)
  })
})

describe('Stock Transfers — transfer detail: a scan changes nothing', () => {
  it('a scan into a Received count is undone, and its Enter does not confirm', async () => {
    await show('Cashier')
    await click(btn('Open transfer TRF-1'))
    const got = $('input[aria-label="Received of Amoxil 500"]')
    await act(async () => { setValue(got, '8') })
    await scan(got, '6151100001')
    expect($('input[aria-label="Received of Amoxil 500"]').value).toBe('8')
    expect(text()).toContain('Scan ignored (6151100001)')
    const confirm = btn('Confirm received')
    const enter = countEnter(confirm)
    await scan(confirm, '6151100001')
    expect(enter.v).toBe(0)
    expect(repo.receive).not.toHaveBeenCalled()
  })

  it('the scanner\'s Enter on Cancel transfer does not cancel', async () => {
    await show()
    await click(btn('Open transfer TRF-2'))
    await click(btn('Cancel transfer…'))
    const cancel = btn('Cancel transfer')
    const enter = countEnter(cancel)
    await scan(cancel, '6151100001')
    expect(enter.v).toBe(0)
    expect(repo.cancel).not.toHaveBeenCalled()
  })
})

describe('Stock Transfers — list', () => {
  it('a scan on the list opens Send stock with the item added, pressing nothing', async () => {
    await show()
    const openBtn = btn('Open transfer TRF-1')
    const enter = countEnter(openBtn)
    await scan(openBtn, '6151100001')
    expect(enter.v).toBe(0)
    expect(text()).toContain('Send stock from')
    expect($('#qty-m-para')).not.toBeNull()
  })

  it('for staff who cannot send, a scan is explained and opens nothing', async () => {
    await show('Cashier')
    await scan(document.body, '6151100001')
    expect($('[role="dialog"]')).toBeNull()
    expect(text()).toContain('Scan ignored (6151100001): scanning adds items when sending stock.')
  })

  it('fields outside Stock Transfers are left alone', async () => {
    await show()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, '6151100001')
      expect(outside.value).toBe('6151100001')
      expect($('[role="dialog"]')).toBeNull()
    } finally {
      outside.remove()
    }
  })
})
