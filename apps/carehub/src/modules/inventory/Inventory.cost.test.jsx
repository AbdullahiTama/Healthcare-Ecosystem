// Cost price, margin and profit in Inventory are shown to the Owner or staff with "See cost prices" (canViewCostPrice)
// only (CODE_AUDIT A25, step 1: screens): the stat cards, the list columns and the Excel export.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const exporter = vi.hoisted(() => ({ exportInventoryXlsx: vi.fn(async () => true) }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), cacheData: vi.fn(), getCached: vi.fn(() => null) }))
vi.mock('./inventoryExport', async (orig) => ({ ...(await orig()), exportInventoryXlsx: exporter.exportInventoryXlsx }))
vi.mock('../audit/repositories', () => ({ auditRepository: { recordExport: vi.fn(async () => ({ status: 'recorded' })) } }))

import Inventory from './Inventory.jsx'
import { INVENTORY_EXPORT_COLUMNS, INVENTORY_COST_KEYS } from './inventoryExport'

let host, root
const brand = { id: 'biz-1', plan: 'pro' }
const products = [{ id: '1', name: 'Amoxil', generic_name: 'Amoxicillin', category: 'Medicines', price: 100, cost_price: 60, stock: 10, reorder_level: 2 }]
const catalog = { status: 'ready', refreshing: false, stale: false, staleReason: null, loadedCount: 0, error: null, reload: vi.fn() }
const text = () => host.textContent
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label))
async function render(role, perms) {
  await act(async () => {
    root.render(<MemoryRouter><Inventory brand={brand} perms={perms} role={role} setProducts={vi.fn()} products={products} catalog={catalog} /></MemoryRouter>)
  })
}

beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Inventory: who sees cost', () => {
  it('staff without "See cost prices": no cost, margin or profit anywhere on the page', async () => {
    await render('Pharmacist', { canEditStock: true, canExportReports: true, canViewCostPrice: false })
    expect(text()).toContain('Amoxil')
    expect(text()).not.toContain('Cost Price')
    expect(text()).not.toContain('Total Profit')
    expect(text()).not.toContain('Profit Margin')
    expect(text()).not.toContain('₦60')
    expect(text()).toContain('At selling price')
  })

  it('the Owner and staff given access see them', async () => {
    await render('Owner', { canViewCostPrice: true })
    expect(text()).toContain('Total Profit')
    expect(text()).toContain('Cost Price')
    await act(async () => root.unmount()); root = createRoot(host)
    await render('Pharmacist', { canEditStock: true, canViewCostPrice: true })
    expect(text()).toContain('Profit Margin')
    expect(text()).toContain('Cost Price')
  })

  it('the Excel export leaves out Cost Price and Cost Value for staff without access', async () => {
    await render('Pharmacist', { canExportReports: true, canViewCostPrice: false })
    await act(async () => button('Export Excel').click())
    expect(exporter.exportInventoryXlsx.mock.calls[0][1]).toMatchObject({ includeCost: false })
    await act(async () => root.unmount()); root = createRoot(host)
    await render('Owner', { canExportReports: true, canViewCostPrice: true })
    await act(async () => button('Export Excel').click())
    expect(exporter.exportInventoryXlsx.mock.calls[1][1]).toMatchObject({ includeCost: true })
    expect(INVENTORY_EXPORT_COLUMNS.filter((c) => INVENTORY_COST_KEYS.includes(c.key)).map((c) => c.header)).toEqual(['Cost Price (NGN)', 'Cost Value (NGN)'])
  })
})
