// The owner's Sale Velocity and expiry notifications open the breakdown behind them (Stock Management ▸ Sales velocity
// / Expiry): before, velocity opened the general Reports page, and an expiry notification opened the whole Inventory
// list (and did nothing when Inventory was already open, because the filter was read only on first load).
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sales = vi.hoisted(() => ({ getSince: vi.fn() }))
vi.mock('../pos/repositories', () => ({ saleRepository: sales }))
vi.mock('../inventory/Inventory', () => ({ default: () => <div>INVENTORY LIST</div> }))
vi.mock('./StockValidation', () => ({ default: () => <div>VALIDATION</div> }))
vi.mock('./StockHistory', () => ({ default: () => <div>HISTORY</div> }))

import StockManagement from './StockManagement'
import { notificationTarget, ALERT_PATHS, categoryForKind } from '../../lib/notificationCategories'

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString()
const PRODUCTS = [
  { id: 'amox', name: 'Amoxil 500', stock: 40, category: 'Medicines', expiry_date: day(20) },
  { id: 'para', name: 'Paracetamol', stock: 100, category: 'Medicines', expiry_date: day(300) },
  { id: 'ors', name: 'ORS sachet', stock: 8, category: 'Medicines', expiry_date: day(-5) },
  { id: 'vitc', name: 'Vitamin C', stock: 30, category: 'Medicines' },
  { id: 'gauze', name: 'Gauze', stock: 0, category: 'Medicines' },
]
const SALES = [
  { created_at: ago(1), status: 'completed', items: [{ id: 'para', qty: 12 }] },
  { created_at: ago(2), status: 'completed', items: [{ id: 'amox', qty: 5 }] },
  { created_at: ago(3), status: 'completed', items: [{ id: 'ors', qty: 2 }] },
  { created_at: ago(4), status: 'completed', items: [{ id: 'gauze', qty: 15 }] },
  { created_at: ago(4), status: 'held', items: [{ id: 'vitc', qty: 99 }] },   // held: not a sale yet
]

let host, root, go
function Nav() { go = useNavigate(); return null }
async function mount(path) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Nav /><Routes><Route path='/dashboard/inventory' element={
      <StockManagement brand={{ id: 'B1' }} products={PRODUCTS} catalog={{ status: 'ready' }} />} /></Routes></MemoryRouter>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const text = () => host.textContent
const section = (id) => host.querySelector('#' + id)?.closest('section')

beforeEach(() => { sales.getSince.mockReset().mockResolvedValue(SALES) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Sales velocity breakdown', () => {
  it('a velocity notification opens the four groups, product by product, with units sold and stock', async () => {
    await mount(ALERT_PATHS.sales_velocity)
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Sales velocity')
    expect(sales.getSince).toHaveBeenCalledWith('B1', expect.any(String))
    expect(section('velocity-fast').textContent).toMatch(/Paracetamol.*12.*100/)
    expect(section('velocity-fast').textContent).toMatch(/Gauze.*15.*Out of stock/)   // sold out: still a fast mover
    expect(section('velocity-steady').textContent).toMatch(/Amoxil 500.*5.*40/)
    expect(section('velocity-slow').textContent).toMatch(/ORS sachet.*2.*8/)
    expect(section('velocity-none').textContent).toMatch(/Vitamin C.*0.*30/)        // the held sale does not count
    expect(text()).toContain('Fast-moving')
    expect(text()).toContain('Steady-moving')
    expect(text()).toContain('Slow-moving')
    expect(text()).toContain('Not moving')
  })

  it('one group can be opened on its own', async () => {
    await mount(ALERT_PATHS.sales_velocity)
    const notMoving = [...host.querySelectorAll('[aria-label="Velocity groups"] button')].find(b => b.textContent.startsWith('Not moving'))
    await act(async () => { notMoving.click() })
    expect(section('velocity-none')).toBeTruthy()
    expect(section('velocity-fast')).toBeFalsy()
  })

  it('says so when sales cannot be loaded, and retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    sales.getSince.mockRejectedValueOnce(new Error('offline'))
    await mount(ALERT_PATHS.sales_velocity)
    expect(text()).toMatch(/couldn't load the last 30 days of sales/)
    await act(async () => { [...host.querySelectorAll('button')].find(b => /try again|retry/i.test(b.textContent)).click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(section('velocity-fast')).toBeTruthy()
    err.mockRestore()
  })
})

describe('Expiry breakdown', () => {
  it('an expiring-soon notification opens the products, quantities and expiry dates', async () => {
    await mount(ALERT_PATHS.product_expiring_soon)
    expect(host.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Expiry')
    const s = section('expiry-expiring')
    expect(s.textContent).toMatch(/Amoxil 500/)
    expect(s.textContent).toMatch(/40/)
    expect(s.textContent).toMatch(/In 20 days/)
    expect(s.textContent).not.toMatch(/Paracetamol/)   // expires in 300 days
    expect(section('expiry-expired')).toBeFalsy()
  })

  it('an expired notification opens the expired list', async () => {
    await mount(ALERT_PATHS.product_expired)
    expect(section('expiry-expired').textContent).toMatch(/ORS sachet.*8.*5 days ago/)
    expect(section('expiry-expiring')).toBeFalsy()
  })

  it('opening a notification while Stock Management is already showing switches to its breakdown', async () => {
    await mount('/dashboard/inventory')
    expect(text()).toContain('INVENTORY LIST')
    await act(async () => { go(ALERT_PATHS.product_expired) })
    expect(text()).not.toContain('INVENTORY LIST')
    expect(section('expiry-expired')).toBeTruthy()
  })

  it('an older expiry notification (link without a tab) opens the Expiry tab too', async () => {
    await mount('/dashboard/inventory?expiry=expiring')
    expect(section('expiry-expiring')).toBeTruthy()
  })
})

describe('where a notification opens', () => {
  it('stock alerts open their breakdown whatever link they were stored with; others keep their link', () => {
    expect(notificationTarget({ kind: 'sales_velocity', link: '/dashboard/reports' })).toBe('/dashboard/inventory?tab=velocity')
    expect(notificationTarget({ kind: 'product_expired', link: '/dashboard/inventory?expiry=expired' })).toBe('/dashboard/inventory?tab=expiry&expiry=expired')
    expect(notificationTarget({ kind: 'low_stock', link: '/dashboard/inventory?stock=low' })).toBe('/dashboard/inventory?stock=low')
    expect(notificationTarget({ kind: 'review_created', link: 'carefind' })).toBe('/dashboard/carefind')
    expect(categoryForKind('sales_velocity')).toBe('inventory')
  })
})
