import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// D1 home-route migration (spec-d1-business-dashboard-foundation): the four
// required states (loading / loaded / empty / aggregate error + Retry) on the
// shared primitives, plus the appointments permission gate.

vi.mock('../../../hooks/queries', () => ({
  useTodaySales: vi.fn(),
  useAllSales: vi.fn(),
  useAppointments: vi.fn(),
}))
vi.mock('../../notifications/repositories', () => ({
  notificationRepository: { notify: vi.fn(async () => {}) },
}))

import DashboardHome from '../DashboardHome'
import { useTodaySales, useAllSales, useAppointments } from '../../../hooks/queries'
import { fmt } from '../../../lib/utils'

const BRAND = { id: 'biz-1', name: 'Pharma Hub', city: 'Lagos' }
const futureDate = () => new Date(Date.now() + 86400000).toISOString().split('T')[0]

function query({ data = [], isLoading = false, isError = false, refetch = vi.fn() } = {}) {
  return { data, isLoading, isError, refetch }
}

// Renders the current route so navigation assertions are observable without
// pulling in a router-mock: click a nav button, read the pathname it landed on.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

async function mountHome({ today, all, appts, products = [], perms = {}, role = 'Owner', brand = BRAND } = {}) {
  useTodaySales.mockReturnValue(today ?? query())
  useAllSales.mockReturnValue(all ?? query())
  useAppointments.mockReturnValue(appts ?? query())

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter>
        <DashboardHome brand={brand} products={products} role={role} perms={perms} />
        <LocationProbe />
      </MemoryRouter>
    )
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return {
    host,
    unmount: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('DashboardHome', () => {
  let m
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })
  afterEach(async () => { if (m) { await m.unmount(); m = null } })

  it('shows the loading state while any query is in flight', async () => {
    m = await mountHome({
      today: query({ isLoading: true }),
      all: query({ isLoading: true }),
      appts: query({ isLoading: true }),
    })
    expect(m.host.querySelector('[role="status"]')).toBeTruthy()
    expect(m.host.textContent).toContain('Loading dashboard...')
  })

  it('renders KPIs, worklist, sales and quick actions when loaded', async () => {
    m = await mountHome({
      today: query({ data: [{ id: 's1', total: 5000, client_name: 'Amaka', payment_method: 'Cash', created_at: '2026-09-29T10:20:00' }] }),
      all: query({ data: [
        { id: 'h1', is_on_hold: true },
        { id: 'c1', is_credit: true, balance: 1200, client_name: 'Tunde', txn_no: 'TXN1' },
      ] }),
      appts: query({ data: [{ id: 'a1', date: futureDate(), time: '10:00', status: 'scheduled', staff_name: 'Dr. Eze' }] }),
      products: [
        { id: 'p1', name: 'Paracetamol', stock: 0, category: 'Drugs', price: 5 },
        { id: 'p2', name: 'Ibuprofen', stock: 2, reorder_level: 5, category: 'Drugs', price: 10 },
      ],
    })

    const group = m.host.querySelector('[role="group"][aria-label="Key metrics"]')
    expect(group).toBeTruthy()
    expect(group.style.gridTemplateColumns).toContain('auto-fit')
    // Human decision B: the KPI row pins minColumn={160} (today's
    // minmax(160px,1fr) floor) so the wrap stays 4/4/3/2 at
    // 1280/1024/768/375 — the foundation default (168) would 1-up the phone.
    expect(group.style.gridTemplateColumns).toContain('160px')

    expect(m.host.textContent).toContain('Held sales')
    expect(m.host.textContent).toContain(fmt(5000))
    expect(m.host.textContent).toContain(fmt(1200))
    expect(m.host.textContent).toContain('Stock alerts')

    const headings = [...m.host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toContain('Needs your attention')
    expect(headings).toContain('Recent sales')

    expect(m.host.textContent).toContain('Paracetamol is out of stock')
    expect(m.host.textContent).toContain('Restock')
    expect(m.host.textContent).toContain('Ibuprofen running low')
    expect(m.host.textContent).toContain('Reorder')
    expect(m.host.textContent).toContain('credit due from Tunde')
    expect(m.host.textContent).toContain('Follow up')
    expect(m.host.textContent).toContain('1 appointment coming up')
    expect(m.host.textContent).toContain('Review')

    expect(m.host.textContent).toContain('Amaka')
    expect(m.host.textContent).toContain('View all')

    const labels = [...m.host.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain('Add product')
    expect(labels).toContain('Add expense')
    expect(labels).toContain('Export report')

    expect(m.host.querySelector('[role="alert"]')).toBeNull()
    expect(useAppointments).toHaveBeenLastCalledWith(BRAND.id, true)

    // PageHeader adoption: branch title + date, offline/sync context pill,
    // and the one primary action that actually navigates to the POS.
    const header = m.host.querySelector('header')
    expect(header).toBeTruthy()
    expect(header.textContent).toContain('Lagos branch')
    expect(header.textContent).toContain('Online · synced')
    const newSale = [...m.host.querySelectorAll('button')].find((b) => b.textContent.includes('New sale'))
    expect(newSale).toBeTruthy()
    expect(m.host.querySelector('[data-testid="loc"]').textContent).toBe('/')
    await act(async () => { click(newSale) })
    expect(m.host.querySelector('[data-testid="loc"]').textContent).toBe('/dashboard/pos')

    // The header lives inside the shell's <main>, so it must not claim
    // role="banner" (banner is not a valid descendant of main).
    expect(header.getAttribute('role')).toBeNull()

    // Worklist row actions are hand-rolled nodes passed to ActivityList —
    // they must still be inert-safe buttons (D1 review B5).
    const restock = [...m.host.querySelectorAll('button')].find((b) => b.textContent === 'Restock')
    expect(restock.getAttribute('type')).toBe('button')
  })

  it('shows empty states without losing the KPI row', async () => {
    m = await mountHome({ products: [] })

    expect(m.host.querySelector('[role="group"][aria-label="Key metrics"]')).toBeTruthy()
    expect(m.host.textContent).toContain('Nothing needs your attention right now.')
    expect(m.host.textContent).toContain('No sales yet today.')
    expect(m.host.querySelector('[role="alert"]')).toBeNull()
  })

  it('surfaces an aggregate error with a Retry that refetches the failed query', async () => {
    const refetchToday = vi.fn()
    const refetchAll = vi.fn()
    m = await mountHome({
      today: query({ isError: true, refetch: refetchToday }),
      all: query({ refetch: refetchAll }),
    })

    expect(m.host.querySelector('[role="alert"]')).toBeTruthy()
    // Available data still renders below the error surface.
    expect(m.host.querySelector('[role="group"][aria-label="Key metrics"]')).toBeTruthy()
    expect(m.host.textContent).toContain('Sales today')

    // ...but a failed query's defaulted [] rows must NOT paint a false
    // all-clear under the error surface (D1 review B1).
    expect(m.host.textContent).not.toContain('Nothing needs your attention right now.')
    expect(m.host.textContent).not.toContain('No sales yet today.')

    const retry = [...m.host.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
    expect(retry).toBeTruthy()
    await act(async () => { click(retry) })
    expect(refetchToday).toHaveBeenCalledTimes(1)
    expect(refetchAll).not.toHaveBeenCalled()
  })

  it('gates appointments behind the permission and filters quick actions', async () => {
    m = await mountHome({
      perms: { nav: ['dashboard', 'inventory'] },
      appts: query({ data: [{ id: 'a1', date: futureDate(), time: '10:00', status: 'scheduled' }] }),
    })

    expect(useAppointments).toHaveBeenLastCalledWith(BRAND.id, false)
    expect(m.host.textContent).not.toMatch(/appointment/i)

    const labels = [...m.host.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain('Add product')
    expect(labels).not.toContain('Add expense')
    expect(labels).not.toContain('Export report')
  })

  it('collapses the worklist to three rows and expands via the +N-more control', async () => {
    const products = [0, 1, 2, 3].map((n) => ({ id: 'p' + n, name: 'Drug ' + n, stock: 0, category: 'Drugs', price: 5 }))
    m = await mountHome({ products })

    expect(m.host.textContent).toContain('Drug 0 is out of stock')
    expect(m.host.textContent).toContain('Drug 2 is out of stock')
    expect(m.host.textContent).not.toContain('Drug 3 is out of stock')
    expect(m.host.textContent).toContain('+ 1 more out of stock')

    const more = [...m.host.querySelectorAll('button')].find((b) => b.textContent.includes('more out of stock'))
    expect(more).toBeTruthy()
    expect(more.getAttribute('type')).toBe('button')
    await act(async () => { click(more) })

    expect(m.host.textContent).toContain('Drug 3 is out of stock')
    expect(m.host.textContent).not.toContain('more out of stock')
  })

  it('renders the hospital patient-flow block only for hospital accounts', async () => {
    m = await mountHome({ brand: { ...BRAND, business_type: 'hospital' } })
    expect(m.host.textContent).toContain('Hospital patient flow')
    expect(m.host.textContent).toContain('Triage')
    await m.unmount()

    m = await mountHome({ brand: { ...BRAND, business_type: 'pharmacy' } })
    expect(m.host.textContent).not.toContain('Hospital patient flow')
  })
})
