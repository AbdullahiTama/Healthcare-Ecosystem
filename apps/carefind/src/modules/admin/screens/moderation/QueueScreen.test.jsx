import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router-dom'

const { callAdminAuth, getPosts } = vi.hoisted(() => ({ callAdminAuth: vi.fn(), getPosts: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../repositories/contentRepository', () => ({ contentRepository: { getPosts } }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import QueueScreen from './QueueScreen.jsx'

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString()
const reports = [
  { id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: iso(5), posts: { content: 'Garlic cures malaria' } },
]
const verifications = [
  { id: 'v1', user_id: 'u1', full_name: 'Amina Bello', profession: 'Pharmacist', workplace: 'MedPlus', status: 'pending', created_at: iso(48) },
  { id: 'v2', user_id: 'u2', full_name: 'Done Already', profession: 'Nurse', status: 'approved', created_at: iso(90) },
]
const posts = [
  { id: 'p9', content: 'Flagged thing', post_type: 'text', status: 'flagged', report_count: 2, created_at: iso(1) },
  { id: 'p8', content: 'Fine post', post_type: 'text', status: 'active', report_count: 0, created_at: iso(1) },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_reports') return { data: reports }
    if (action === 'list_verification_requests') return { data: verifications }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname}{l.search}</span> }
const at = (route, opts = {}) => renderAdmin(<><QueueScreen /><Where /></>, { route, ...opts })

describe('QueueScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); getPosts.mockResolvedValue(posts) })

  it('merges reports, flagged posts and pending verifications', async () => {
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: 'Open Misinformation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Verification: Amina Bello' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Flagged thing' })).toBeInTheDocument()
    expect(screen.queryByText(/Done Already/)).not.toBeInTheDocument()
    expect(screen.queryByText('Fine post')).not.toBeInTheDocument()
    expect(screen.getByText('3 items need review')).toBeInTheDocument()
  })

  it('filters by source from the URL', async () => {
    at('/admin/moderation/queue?source=verification')
    expect(await screen.findByRole('button', { name: 'Open Verification: Amina Bello' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Misinformation' })).not.toBeInTheDocument()
  })

  it('opens a verification or a report on its own screen', async () => {
    at('/admin/moderation/queue')
    fireEvent.click(await screen.findByRole('button', { name: 'Open Verification: Amina Bello' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/moderation/verifications?id=v1')
  })

  it('shows the bulk bar only when something is selected, and clears it', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Misinformation' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('bulk approves verifications and resolves reports, and reports what it skipped', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('Approved 2, skipped 1')).toBeInTheDocument()
    expect(calls('approve_verification')[0][1]).toEqual({ id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    expect(calls('resolve_report')[0][1]).toEqual({ id: 'r1' })
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
  })

  it('counts an item that fails as skipped and carries on', async () => {
    mockApi({ approve_verification: async () => { throw new Error('nope') } })
    at('/admin/moderation/queue?source=verification')
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Verification: Amina Bello' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('Approved 0, skipped 1')).toBeInTheDocument()
  })

  it('bulk deletes posts only after the consequence is confirmed', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Flagged thing' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Flagged thing' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Misinformation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(await screen.findByText('Delete 2 posts?')).toBeInTheDocument()
    expect(calls('delete_post')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted 2 posts')).toBeInTheDocument()
    expect(calls('delete_post').map(c => c[1].id).sort()).toEqual(['p1', 'p9'])
  })

  it('still lists reports and verifications when flagged posts cannot be loaded', async () => {
    getPosts.mockRejectedValue(new Error('rls'))
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: 'Open Misinformation' })).toBeInTheDocument()
    expect(screen.getByText('Flagged posts could not be loaded.')).toBeInTheDocument()
  })

  it('shows an error with retry when a queue list fails', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('shows a clear empty state', async () => {
    mockApi({ list_reports: async () => ({ data: [] }), list_verification_requests: async () => ({ data: [] }) })
    getPosts.mockResolvedValue([])
    at('/admin/moderation/queue')
    expect(await screen.findByText('Nothing is waiting for review')).toBeInTheDocument()
  })

  it('drops the selection when the filter changes, so hidden items are never acted on', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Misinformation' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verifications' }))
    await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Verification: Amina Bello' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    expect(await screen.findByText('Approved 1 items')).toBeInTheDocument()
    expect(calls('resolve_report')).toHaveLength(0)
  })

  it('names items that have no reason, name or profession instead of printing null', async () => {
    mockApi({
      list_reports: async () => ({ data: [{ id: 'r9', post_id: null, reason: null, status: 'pending', created_at: iso(2), posts: null }] }),
      list_verification_requests: async () => ({ data: [{ id: 'v9', user_id: 'u9', full_name: null, profession: null, workplace: null, status: 'pending', created_at: iso(3) }] }),
    })
    getPosts.mockResolvedValue([])
    at('/admin/moderation/queue')
    expect(await screen.findByRole('button', { name: 'Open No reason given' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Verification: Unnamed applicant' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select No reason given' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/null/)
  })

  it('bulk reject applies to verifications only and leaves reports alone', async () => {
    at('/admin/moderation/queue')
    await screen.findByRole('button', { name: 'Open Misinformation' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject selected' }))
    expect(await screen.findByText('Rejected 1, skipped 2')).toBeInTheDocument()
    expect(calls('reject_verification')[0][1]).toEqual({ id: 'v1' })
    expect(calls('resolve_report')).toHaveLength(0)
  })
})
