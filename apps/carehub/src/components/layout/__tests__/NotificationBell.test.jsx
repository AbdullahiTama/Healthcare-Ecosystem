import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NotificationBell from '../NotificationBell'
import { getMyNotifications, markNotificationRead } from '../../../services/supabase'

// Issue #4: the bell gained category tabs and an honest mark-as-read flow.
// These tests pin the two behaviors the field report hinged on: tapping an
// item marks it read (badge decrements, server PATCH issued) and a FAILED
// patch reverts the optimistic state instead of silently losing the unread.

vi.mock('../../../services/supabase', () => ({
  getMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))
vi.mock('../../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}) }))
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

const NOW = new Date().toISOString()
const ROWS = [
  { id: 'n1', kind: 'low_stock', title: 'Low stock alert', body: 'Paracetamol is running low', link: 'inventory', read_at: null, created_at: NOW, staff_id: 'staff-1' },
  { id: 'n2', kind: 'booking_created', title: 'New booking', body: 'Chinedu booked a consultation', link: 'appointments', read_at: null, created_at: NOW, staff_id: 'staff-1' },
]

describe('NotificationBell', () => {
  let host
  let root

  beforeEach(() => {
    localStorage.setItem('carehub_auth', JSON.stringify({ staff: { id: 'staff-1' } }))
    getMyNotifications.mockReset()
    getMyNotifications.mockResolvedValue(ROWS.map(r => ({ ...r })))
    markNotificationRead.mockReset()
    markNotificationRead.mockResolvedValue({})
    navigate.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    localStorage.removeItem('carehub_auth')
  })

  async function renderBell() {
    await act(async () => { root.render(<NotificationBell brand={{ id: 'b1' }} />) })
    await act(async () => {})
  }

  const bellButton = () => host.querySelector('button')
  const buttonByText = (text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

  it('shows the unread badge and decrements it when an item is tapped', async () => {
    await renderBell()
    expect(bellButton().textContent).toContain('2')

    await act(async () => { bellButton().click() })
    const item = buttonByText('Low stock alert')
    expect(item).toBeDefined()

    await act(async () => { item.click() })
    await act(async () => {})
    expect(markNotificationRead).toHaveBeenCalledWith('n1')
    expect(navigate).toHaveBeenCalledWith('/dashboard/inventory')
    // Panel closed after tap; badge reflects one remaining unread.
    expect(bellButton().textContent).toContain('1')
    expect(bellButton().textContent).not.toContain('2')
  })

  it('reverts the optimistic read state when the PATCH fails', async () => {
    markNotificationRead.mockRejectedValueOnce(new Error('network down'))
    await renderBell()

    await act(async () => { bellButton().click() })
    await act(async () => { buttonByText('New booking').click() })
    await act(async () => {})

    // n2 went optimistically read, then came back: nothing changed net —
    // both items are unread again and the failure is surfaced.
    expect(bellButton().textContent).toContain('2')
    expect(host.textContent).toContain('Could not mark as read')
  })

  it('counts per-category unread badges and filters the list by tab', async () => {
    await renderBell()
    await act(async () => { bellButton().click() })

    const inventoryTab = buttonByText('Inventory & Expiry')
    const appointmentsTab = buttonByText('Appointments')
    expect(inventoryTab.textContent).toContain('1')
    expect(appointmentsTab.textContent).toContain('1')

    await act(async () => { inventoryTab.click() })
    expect(buttonByText('Low stock alert')).toBeDefined()
    expect(buttonByText('New booking')).toBeUndefined()
  })
})
