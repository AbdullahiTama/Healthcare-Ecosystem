import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'

const { callAdminAuth, getTotals } = vi.hoisted(() => ({ callAdminAuth: vi.fn(), getTotals: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../repositories/dashboardRepository', () => ({ dashboardRepository: { getTotals } }))
vi.mock('../../HealthPulse.jsx', () => ({ default: () => <div>pulse strip</div> }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import HomeScreen from './HomeScreen.jsx'

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString()
const day = (hoursAgo) => iso(hoursAgo).slice(0, 10)
const lists = {
  list_verification_requests: [
    { id: 'v1', full_name: 'Amina Bello', profession: 'Pharmacist', status: 'pending', created_at: iso(52) },
    { id: 'v2', full_name: 'Old Approved', status: 'approved', created_at: iso(500) },
  ],
  list_business_claims: [{ id: 'c1', status: 'pending', created_at: iso(33), businesses: { name: 'MedPlus Ikeja' } }],
  list_reports: [{ id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: iso(5) }],
  list_news: [{ id: 'n1', headline: 'New clinic opens', status: 'pending', created_at: iso(2) }],
  list_withdrawal_requests: [{ id: 'w1', status: 'reserved', created_at: iso(3), profiles: { full_name: 'Chidi O.' } }],
  list_transactions: [
    { id: 't1', type: 'topup', naira_amount: 500000, created_at: iso(1) },
    { id: 't2', type: 'topup', naira_amount: 250000, created_at: iso(24 * 40) },
    { id: 't3', type: 'gift', naira_amount: 999999, created_at: iso(1) },
  ],
}

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action) => {
    if (overrides[action]) return overrides[action]()
    return { data: lists[action] || [] }
  })
}
function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname}{l.search}</span> }
const at = (opts = {}) => renderAdmin(<><HomeScreen /><Where /></>, { route: opts.route || '/admin', ...opts })

describe('HomeScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); getTotals.mockResolvedValue({ users: 1284, posts: 9310 }) })

  it('summarises what needs attention, with the age of the oldest item', async () => {
    at()
    expect(await screen.findByText('5 items need attention across 5 queues')).toBeInTheDocument()
    const tiles = screen.getByRole('group', { name: 'Queues' })
    expect(within(tiles).getByText('Verifications')).toBeInTheDocument()
    expect(within(tiles).getByText('oldest 2d ago')).toBeInTheDocument()
    expect(within(tiles).getByText('Withdrawals')).toBeInTheDocument()
  })

  it('lists the longest-waiting items first and opens them on their own screen', async () => {
    at()
    const first = await screen.findByRole('button', { name: 'Open Amina Bello' })
    const names = screen.getAllByRole('button', { name: /^Open / }).map(b => b.getAttribute('aria-label'))
    expect(names.slice(0, 3)).toEqual(['Open Amina Bello', 'Open MedPlus Ikeja', 'Open Misinformation'])
    expect(screen.queryByRole('button', { name: 'Open Old Approved' })).not.toBeInTheDocument()
    fireEvent.click(first)
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/moderation/verifications?id=v1')
  })

  it('says so when nothing is waiting', async () => {
    mockApi(Object.fromEntries(Object.keys(lists).map(a => [a, async () => ({ data: [] })])))
    at()
    expect(await screen.findByText('Nothing needs attention right now')).toBeInTheDocument()
    expect(screen.getByText('All queues are clear')).toBeInTheDocument()
  })

  it('shows platform totals and revenue for the chosen period only', async () => {
    at()
    expect(await screen.findByText('1,284')).toBeInTheDocument()
    expect(screen.getByText('9,310')).toBeInTheDocument()
    expect(await screen.findByText('₦7,500')).toBeInTheDocument()
  })

  it('narrows revenue to a date range from the URL', async () => {
    at({ route: `/admin?from=${day(48)}&to=${day(0)}` })
    expect(await screen.findByText('₦5,000')).toBeInTheDocument()
  })

  it('shows a failed queue as unavailable instead of zero', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at()
    const tiles = await screen.findByRole('group', { name: 'Queues' })
    await waitFor(() => expect(within(tiles).getByText('Unavailable')).toBeInTheDocument())
    expect(screen.getByText('Some queues could not be loaded, so this list may be incomplete.')).toBeInTheDocument()
  })

  it('shows totals as unavailable when they fail to load', async () => {
    getTotals.mockRejectedValue(new Error('rls'))
    at()
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2))
  })

  it('leaves out queues and revenue the role may not see', async () => {
    at({ admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, revenue: false, claims: false } })
    const tiles = await screen.findByRole('group', { name: 'Queues' })
    expect(within(tiles).queryByText('Withdrawals')).not.toBeInTheDocument()
    expect(within(tiles).queryByText('Claims')).not.toBeInTheDocument()
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
    expect(callAdminAuth).not.toHaveBeenCalledWith('list_transactions', expect.anything())
    expect(screen.queryByRole('button', { name: 'Open MedPlus Ikeja' })).not.toBeInTheDocument()
  })
})
