// Stock Transfers: send from this location, receive what arrives, cancel while in transit.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ list: vi.fn(), sendable: vi.fn(), send: vi.fn(), receive: vi.fn(), cancel: vi.fn() }))
vi.mock('../repositories', () => ({ transferRepository: repo }))
vi.mock('../../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn(async () => [MAIN, IKEJA, YABA]) } }))

import StockTransfers from '../StockTransfers.jsx'

const MAIN = { id: 'main', name: 'Allen', parent_business_id: null }
const IKEJA = { id: 'ikeja', name: 'Allen · Ikeja', branch_name: 'Ikeja', parent_business_id: 'main' }
const YABA = { id: 'yaba', name: 'Allen · Yaba', branch_name: 'Yaba', parent_business_id: 'main' }
const INCOMING = { id: 't1', transfer_no: 'TRF-1', status: 'in_transit', from_branch_id: 'ikeja', to_branch_id: 'yaba', sent_at: '2026-10-28T10:00:00Z', sent_by_name: 'Bola',
  stock_transfer_lines: [{ id: 'l1', product_name: 'Amoxil 500', qty_sent: 10, qty_received: null }, { id: 'l2', product_name: 'Vitamin C', qty_sent: 4, qty_received: null }] }
const OUTGOING = { id: 't2', transfer_no: 'TRF-2', status: 'in_transit', from_branch_id: 'yaba', to_branch_id: 'main', sent_at: '2026-10-28T11:00:00Z',
  stock_transfer_lines: [{ id: 'l3', product_name: 'Paracetamol', qty_sent: 3, qty_received: null }] }

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const type = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function show(role = 'Branch Manager') {
  await act(async () => { root.render(<StockTransfers brand={YABA} role={role} loadProducts={vi.fn()} />) })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.list.mockResolvedValue({ available: true, transfers: [INCOMING, OUTGOING] })
  repo.sendable.mockResolvedValue([{ id: 'p1', name: 'Paracetamol', stock: 12, master_product_id: 'm-para' }])
  repo.send.mockResolvedValue({ id: 't3', transfer_no: 'TRF-3' })
  repo.receive.mockResolvedValue({ shortfall: 2 })
  repo.cancel.mockResolvedValue({ status: 'cancelled' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Stock Transfers', () => {
  it('lists transfers in and out, and says what is waiting to be received', async () => {
    await show()
    expect(text()).toContain('1 transfer is on the way here')
    expect(text()).toContain('From Ikeja')
    expect(text()).toContain('To Main Location')
    expect(text()).toContain('To receive')
    await click(btn('Incoming'))
    expect(text()).not.toContain('To Main Location')
  })

  it('a cashier receives a transfer, entering what is short', async () => {
    await show('Cashier')
    expect(btn('+ Send stock')).toBeUndefined()
    await click(btn('Open transfer TRF-1'))
    await type(document.body.querySelector('input[aria-label="Received of Amoxil 500"]'), '8')
    await click(btn('Confirm received'))
    expect(repo.receive).toHaveBeenCalledWith('t1', [{ line_id: 'l1', qty_received: 8 }], '')
    expect(text()).toContain('Received, with 2 unit(s) short')
  })

  it('a manager sends stock to another location', async () => {
    await show()
    await click(btn('+ Send stock'))
    const to = document.body.querySelector('#transfer-to')
    await act(async () => { to.value = 'ikeja'; to.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) }); await flush()
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('12 in stock')))
    await type(document.body.querySelector('#qty-m-para'), '5')
    await click(btn('Send 1 item'))
    expect(repo.send).toHaveBeenCalledWith('yaba', 'ikeja', [expect.objectContaining({ master_product_id: 'm-para', qty: 5 })], '')
    expect(text()).toContain('Transfer TRF-3 sent to Ikeja')
  })

  it('more than is in stock is stopped before sending', async () => {
    await show()
    await click(btn('+ Send stock'))
    const to = document.body.querySelector('#transfer-to')
    await act(async () => { to.value = 'ikeja'; to.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) }); await flush()
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('12 in stock')))
    await type(document.body.querySelector('#qty-m-para'), '20')
    await click(btn('Send 1 item'))
    expect(repo.send).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]').textContent).toBe('Only 12 of Paracetamol in stock here.')
  })

  it('the sender cancels a transfer in transit after confirming', async () => {
    await show()
    await click(btn('Open transfer TRF-2'))
    await click(btn('Cancel transfer…'))
    expect(text()).toContain('Cancelling returns every item')
    await click(btn('Cancel transfer'))
    expect(repo.cancel).toHaveBeenCalledWith('t2', '')
  })

  it('shows a retryable error and the not-installed state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.list.mockRejectedValueOnce(new Error('network'))
    await show()
    expect(text()).toContain("couldn't load the transfers")
    repo.list.mockResolvedValue({ available: false, transfers: [] })
    await click(btn('Try again') || [...document.body.querySelectorAll('[role="alert"] button')][0])
    expect(text()).toContain('available once the latest database update is installed')
  })
})
