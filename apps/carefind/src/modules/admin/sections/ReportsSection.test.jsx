import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ resolveReport: vi.fn(), deletePost: vi.fn(), busyId: null }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', async () => {
  const actual = await vi.importActual('../hooks/useTrustQueues')
  return { ...actual, useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }
})
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import ReportsSection from './ReportsSection.jsx'

const now = new Date().toISOString()
const LONG = 'A'.repeat(300)
const rep = (over = {}) => ({ id: 'r1', post_id: 'p1', status: 'pending', reason: 'spam', posts: { content: 'Buy cheap pills now' }, created_at: now, ...over })
const setReports = (data) => { queues.value = { verifications: { status: 'ok', data: [] }, claims: { status: 'ok', data: [] }, reports: data } }

beforeEach(() => {
  setReports({ status: 'ok', data: [rep(), rep({ id: 'r2', post_id: 'p2', status: 'resolved', reason: 'abuse', posts: { content: 'Old post' } })] })
  actions.resolveReport.mockReset().mockResolvedValue({ ok: true })
  actions.deletePost.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('ReportsSection', () => {
  it('lists pending reports with the post excerpt', () => {
    render(<ReportsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByText('Buy cheap pills now')).toBeInTheDocument()
    expect(screen.queryByText('Old post')).not.toBeInTheDocument()
  })

  it('dismisses by the REPORT id, never the post id', async () => {
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(actions.resolveReport).toHaveBeenCalledWith('r1'))
    expect(actions.resolveReport).not.toHaveBeenCalledWith('p1')
  })

  it('deletes the post only after confirmation, by post id', async () => {
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Delete post' }))
    expect(actions.deletePost).not.toHaveBeenCalled()
    await admin.askConfirm.mock.calls[0][0].action()
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
  })

  it('shows the full post in the drawer but truncates it in the table', () => {
    setReports({ status: 'ok', data: [rep({ posts: { content: LONG } })] })
    render(<ReportsSection />)
    expect(screen.queryByText(LONG)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    expect(within(screen.getByRole('dialog')).getByText(LONG)).toBeInTheDocument()
  })

  it('offers only Dismiss when the post is already gone', () => {
    setReports({ status: 'ok', data: [rep({ posts: null })] })
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    expect(screen.getByText('Post no longer available', { selector: '.adm-drawer-text' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('shows the cap note when the server returned its maximum', () => {
    setReports({ status: 'ok', data: Array.from({ length: 30 }, (_, i) => rep({ id: `r${i}`, post_id: `p${i}` })) })
    render(<ReportsSection />)
    expect(screen.getAllByText(/30\+/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows Retry when the list failed', () => {
    setReports({ status: 'error' })
    render(<ReportsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
