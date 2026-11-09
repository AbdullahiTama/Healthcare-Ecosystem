// Held sales appear in Held Sales the moment they are saved (online or queued on the device), a failed read never
// reads as "no held sales", and a customer can be added from the till for any sale.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  open: [], openError: false, clients: [],
  saleCreate: vi.fn(), updateHeld: vi.fn(), upsert: vi.fn(), createClient: vi.fn(), refetchOpen: vi.fn(),
}))

vi.mock('../../hooks/queries', () => ({
  useOpenSales: vi.fn(() => ({ data: h.open, isLoading: false, isError: h.openError, refetch: h.refetchOpen })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: h.clients, isLoading: false, isError: false, refetch: vi.fn() })),
  useCreateClient: vi.fn(() => ({ mutateAsync: h.createClient })),
  useInvalidateSales: vi.fn(() => vi.fn()),
  useUpsertOpenSale: vi.fn(() => h.upsert),
}))
vi.mock('./repositories', async (orig) => {
  const real = await orig()
  return { ...real, saleRepository: { ...real.saleRepository, create: h.saleCreate, updateHeld: h.updateHeld, history: vi.fn(async () => []) } }
})
vi.mock('../debts/repositories', () => ({ debtRepository: { recordUnderpayment: vi.fn(async () => ({})) } }))
vi.mock('../consultation/repositories', () => ({ consultationRepository: { getLatest: vi.fn(async () => null) } }))

import POS from './POS.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const PRODUCTS = [{ id: 'p1', name: 'Amoxicillin 500mg', category: 'Prescription Drugs', price: 1200, stock: 20 }]
const HELD = { id: 'h1', txn_no: 'HLD-1', client_name: 'Ada Obi', is_on_hold: true, status: null, total: 2400, created_at: '2026-10-27T09:00:00',
  items: JSON.stringify([{ id: 'p1', name: 'Amoxicillin 500mg', price: 1200, qty: 2 }]) }

let host, root
const buttons = () => [...host.querySelectorAll('button')]
const button = (text) => buttons().find((b) => b.textContent.trim() === text)
const tab = (name) => buttons().find((b) => b.getAttribute('role') === 'tab' && b.textContent.trim().startsWith(name))
const text = () => document.body.textContent
async function click(el) { await act(async () => { el.click() }) }
async function type(el, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><POS brand={BRAND} products={PRODUCTS} setProducts={vi.fn()} role='Owner' perms={{ canEditPrice: true }} /></MemoryRouter>) })
}
async function holdOne() {
  await click(button('Add'))
  await click(host.querySelector('button.pos-hold'))
  await click(button('Hold sale'))
}

beforeEach(() => {
  localStorage.clear()
  h.open = []; h.openError = false; h.clients = []
  h.saleCreate.mockReset(); h.updateHeld.mockReset(); h.upsert.mockReset(); h.createClient.mockReset(); h.refetchOpen.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Sales on hold: immediate and never lost', () => {
  it('a held sale saved online goes straight into the Held list (no refresh)', async () => {
    const saved = { id: 'new-1', txn_no: 'HLD-9', is_on_hold: true, total: 1200, items: '[]' }
    h.saleCreate.mockResolvedValue({ queued: false, sale: saved })
    await mount()
    await holdOne()
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    expect(h.upsert).toHaveBeenCalledWith(saved)
  })

  it('saving an edited held sale updates that entry in the list at once', async () => {
    h.open = [HELD]
    h.updateHeld.mockResolvedValue({ id: 'h1' })
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(button('Add'))
    await click(host.querySelector('button.pos-hold'))
    await click(button('Save changes'))
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1', txn_no: 'HLD-1', total: 3600, balance: 3600 }))
  })

  it('a held sale queued offline shows in Held Sales, marked as waiting to sync, and cannot be opened yet', async () => {
    // What saleRepository.create parks in the device queue when offline.
    h.saleCreate.mockImplementation(async (businessId, sale) => {
      localStorage.setItem('carehub_v1_offline_sales', JSON.stringify([{ id: 'q-1', ...sale, business_id: businessId, _offline_id: 'x1' }]))
      return { queued: true, reason: 'offline' }
    })
    await mount()
    await holdOne()
    expect(tab('Held').textContent).toContain('1')
    await click(tab('Held'))
    expect(text()).toContain('Saved on this device. It will sync when you are back online.')
    expect(text()).toContain('Can be opened once it has synced.')
    expect(button('Open & edit')).toBeUndefined()
  })

  it('a queued held sale of another location is not shown here', async () => {
    localStorage.setItem('carehub_v1_offline_sales', JSON.stringify([{ id: 'q-2', txn_no: 'HLD-X', is_on_hold: true, total: 50, items: '[]', business_id: 'other', _offline_id: 'y' }]))
    await mount()
    await click(tab('Held'))
    expect(text()).toContain('No held sales')
  })

  it('once it is in the server list it is shown once, not twice', async () => {
    localStorage.setItem('carehub_v1_offline_sales', JSON.stringify([{ ...HELD, business_id: 'biz-1', _offline_id: 'z' }]))
    h.open = [HELD]
    await mount()
    await click(tab('Held'))
    expect(text().match(/Ada Obi/g)).toHaveLength(1)
  })

  it('a failed read says so with a retry, never "No held sales"', async () => {
    h.openError = true
    await mount()
    await click(tab('Held'))
    expect(text()).toContain("We couldn't load held sales. They are still saved")
    expect(text()).not.toContain('No held sales')
    await click(button('Retry'))
    expect(h.refetchOpen).toHaveBeenCalled()
  })
})

describe('Add a customer from the POS', () => {
  it('for any sale: saves the client and selects them for this sale, keeping the cart', async () => {
    h.createClient.mockResolvedValue([{ id: 'c-new', full_name: 'Baba Tunde', phone: '0805' }])
    await mount()
    await click(button('Add'))
    await click(host.querySelector('button[aria-label="New customer for this sale"]'))
    const dialog = document.querySelector('[role="dialog"]')
    const [nameInput, phoneInput, emailInput] = dialog.querySelectorAll('input')
    await type(nameInput, '  Baba   Tunde ')
    await type(phoneInput, '0805')
    await type(emailInput, 'baba@example.com')
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add and select'))
    expect(h.createClient).toHaveBeenCalledWith({ full_name: 'Baba Tunde', phone: '0805', email: 'baba@example.com' })
    expect(host.querySelector('input[list="pos-clients"]').value).toBe('Baba Tunde')
    expect(text()).toContain('Baba Tunde added to your clients and selected for this sale.')
    expect(text()).toContain('Amoxicillin 500mg')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('starts from the name typed in the customer box, and a duplicate phone is explained', async () => {
    h.createClient.mockRejectedValue(new Error('duplicate key value violates unique constraint "clients_business_phone_key" (23505)'))
    await mount()
    await type(host.querySelector('input[list="pos-clients"]'), 'Ngozi')
    await click(host.querySelector('button[aria-label="New customer for this sale"]'))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.querySelector('input').value).toBe('Ngozi')
    await type(dialog.querySelectorAll('input')[1], '0801')
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add and select'))
    expect(dialog.querySelector('[role="alert"]').textContent).toContain('already exists')
  })

  it('asks for a name before saving', async () => {
    await mount()
    await click(host.querySelector('button[aria-label="New customer for this sale"]'))
    const dialog = document.querySelector('[role="dialog"]')
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add and select'))
    expect(h.createClient).not.toHaveBeenCalled()
    expect(dialog.querySelector('[role="alert"]').textContent).toContain('full name')
  })
})
