import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../../test/renderWithQueryClient.jsx'

const hook = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const transportQuery = vi.hoisted(() => vi.fn())

vi.mock('../hooks/useOverviewData', async () => {
  const actual = await vi.importActual('../hooks/useOverviewData')
  return { ...actual, useOverviewData: () => ({ ...hook.value, refetch: hook.refetch }) }
})
vi.mock('../repositories/transport', () => ({ adminTransport: { query: transportQuery } }))

import OverviewSection from './OverviewSection.jsx'

const ok = (data) => ({ status: 'ok', data })
const err = { status: 'error' }
const iso = (h) => new Date(Date.now() - h * 3600_000).toISOString()

function result(overrides = {}) {
  return {
    sources: {
      verifications: ok([{ id: 'v1', status: 'pending', full_name: 'Amina Yusuf', profession: 'Pharmacist', created_at: iso(72) }, { id: 'v2', status: 'approved', created_at: iso(90) }]),
      claims: ok([{ id: 'c1', status: 'pending', businesses: { name: 'Garki Pharmacy' }, created_at: iso(24) }]),
      reports: ok([{ id: 'r1', status: 'pending', reason: 'spam', posts: { content: 'x' }, created_at: iso(6) }, { id: 'r2', status: 'resolved', created_at: iso(8) }]),
      transactions: ok([{ id: 't1' }, { id: 't2' }, { id: 't3' }]),
      withdrawals: ok([{ id: 'w1', status: 'reserved', profiles: { full_name: 'Chidi' }, created_at: iso(2) }, { id: 'w2', status: 'pending', created_at: iso(3) }]),
      taskSubmissions: ok([]),
      news: ok([]),
      consultations: ok([{ id: 'k1', profiles: { full_name: 'Dr Ngozi' }, created_at: iso(1) }]),
      ...(overrides.sources || {}),
    },
    totals: { users: ok(4218), businesses: ok(312), posts24h: ok(41), ...(overrides.totals || {}) },
  }
}

function setHook(data, extra = {}) {
  hook.value = { data, isLoading: false, isFetching: false, dataUpdatedAt: Date.now(), ...extra }
}

const cell = (name) => screen.getByText(name).closest('div')

beforeEach(() => {
  hook.refetch.mockReset()
  transportQuery.mockReset().mockResolvedValue({ data: [], count: 7 })
  setHook(result())
})

describe('OverviewSection', () => {
  it('has a single Dashboard heading', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('shows loading placeholders, not numbers, while the first load runs', () => {
    setHook(undefined, { isLoading: true })
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(screen.getByRole('status', { name: 'Loading Users' })).toBeInTheDocument()
    expect(screen.queryByText('4,218')).not.toBeInTheDocument()
  })

  it('shows real totals and counts only what is waiting', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(within(cell('Users')).getByText('4,218')).toBeInTheDocument()
    expect(within(cell('Businesses')).getByText('312')).toBeInTheDocument()
    expect(within(cell('Pending verification')).getByText('1')).toBeInTheDocument()
    expect(within(cell('Pending claims')).getByText('1')).toBeInTheDocument()
    expect(within(cell('Open reports')).getByText('1')).toBeInTheDocument()
    expect(within(cell('Transactions')).getByText('3')).toBeInTheDocument()
    expect(within(cell('Posts, last 24 hours')).getByText('41')).toBeInTheDocument()
  })

  it('counts withdrawals reserved or processing, not legacy pending', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(within(cell('Pending withdrawals')).getByText('1')).toBeInTheDocument()
  })

  it('shows a failed source as an error with Retry, never as 0, and names it in the queue', () => {
    setHook(result({ sources: { transactions: err, reports: err } }))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(within(cell('Transactions')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(within(cell('Open reports')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(screen.getByText(/Couldn't load: Reported posts/)).toBeInTheDocument()
    fireEvent.click(within(cell('Transactions')).getByRole('button', { name: 'Retry' }))
    expect(hook.refetch).toHaveBeenCalled()
  })

  it('shows a failed head count as an error, never 0', () => {
    setHook(result({ totals: { users: err } }))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(within(cell('Users')).getByText(/Couldn't load/)).toBeInTheDocument()
  })

  it('shows "30+" when the reports list is at the server cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, status: 'pending', reason: 'x', posts: { content: 'y' }, created_at: iso(i + 1) }))
    setHook(result({ sources: { reports: ok(many) } }))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(within(cell('Open reports')).getByText('30+')).toBeInTheDocument()
  })

  it('lists the queue with severity and a count, worst first, and opens the section on click', () => {
    const onOpenTab = vi.fn()
    render(<OverviewSection permissions={{}} onOpenTab={onOpenTab} />)
    const rows = within(screen.getByRole('list', { name: 'Needs attention' })).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Reported posts')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Urgent')).toBeInTheDocument()
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(onOpenTab).toHaveBeenCalledWith('reports')
  })

  it('shows consultation bookings without an action, since there is no screen for them', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    const row = screen.getByText('Consultation bookings').closest('li')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('filters the queue by severity tab', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /^Info/ }))
    expect(screen.getByText('Consultation bookings')).toBeInTheDocument()
    expect(screen.queryByText('Reported posts')).not.toBeInTheDocument()
  })

  it('says all clear only when nothing is waiting and every source loaded', () => {
    setHook(result({ sources: { verifications: ok([]), claims: ok([]), reports: ok([]), withdrawals: ok([]), consultations: ok([]) } }))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(screen.getByText('All clear')).toBeInTheDocument()
  })

  it('does not say all clear when a source failed', () => {
    setHook(result({ sources: { verifications: ok([]), claims: ok([]), reports: err, withdrawals: ok([]), consultations: ok([]) } }))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
  })

  it('hides cells and rows for tabs the role has switched off', () => {
    render(<OverviewSection permissions={{ withdrawals: false, revenue: false }} onOpenTab={() => {}} />)
    expect(screen.queryByText('Pending withdrawals')).not.toBeInTheDocument()
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument()
    expect(screen.queryByText('Withdrawal requests')).not.toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
  })

  it('shows status splits from the loaded lists', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    expect(screen.getByRole('img', { name: 'Verifications: 1 pending, 1 approved, 0 rejected' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Reports: 1 open, 1 resolved' })).toBeInTheDocument()
  })

  it('refreshes on demand', () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(hook.refetch).toHaveBeenCalled()
  })
})

describe('activity in range', () => {
  it('counts users and posts created in the chosen dates with head counts', async () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-07' } })
    expect(await screen.findByText('New users')).toBeInTheDocument()
    const calls = transportQuery.mock.calls.filter(c => c[1].filters?.length === 2)
    expect(calls.map(c => c[0]).sort()).toEqual(['posts', 'profiles'])
    expect(calls[0][1].count).toBe('head')
    expect(calls[0][1].filters).toEqual([
      { op: 'gte', col: 'created_at', val: '2026-10-01T00:00:00.000Z' },
      { op: 'lte', col: 'created_at', val: '2026-10-07T23:59:59.999Z' },
    ])
  })

  it('refuses a range that ends before it starts and does not query with both bounds', async () => {
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-09' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })
    expect(await screen.findByText(/From date is after the To date/)).toBeInTheDocument()
    const bothBounds = transportQuery.mock.calls.filter(c => c[1].filters?.length === 2)
    expect(bothBounds).toHaveLength(0)
  })

  it('shows an error, not zero, when the count fails', async () => {
    transportQuery.mockRejectedValue(new Error('x'))
    render(<OverviewSection permissions={{}} onOpenTab={() => {}} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    expect(await screen.findAllByText(/Couldn't load/)).not.toHaveLength(0)
  })
})
