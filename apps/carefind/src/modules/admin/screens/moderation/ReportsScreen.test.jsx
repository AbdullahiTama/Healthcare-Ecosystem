import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import ReportsScreen from './ReportsScreen.jsx'

const long = 'x'.repeat(300)
const rows = [
  { id: 'r1', post_id: 'p1', reason: 'Misinformation', status: 'pending', created_at: new Date().toISOString(), posts: { content: 'Garlic cures malaria' } },
  { id: 'r2', post_id: 'p2', reason: 'Spam', status: 'pending', created_at: new Date().toISOString(), posts: null },
  { id: 'r3', post_id: 'p3', reason: 'Abuse', status: 'resolved', created_at: new Date().toISOString(), posts: { content: long } },
  { id: 'r4', post_id: null, reason: null, status: 'pending', created_at: null, posts: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_reports') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<ReportsScreen />, { route })

describe('ReportsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending reports by default with the post excerpt', async () => {
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: 'Open report: Misinformation' })).toBeInTheDocument()
    expect(screen.getByText('Garlic cures malaria')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open report: Abuse' })).not.toBeInTheDocument()
    expect(screen.getByText('3 pending · 4 loaded')).toBeInTheDocument()
  })

  it('renders reports whose post was deleted or that have no reason', async () => {
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: 'Open report: Spam' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open report: No reason given' })).toBeInTheDocument()
    expect(screen.getAllByText('Post no longer available').length).toBeGreaterThan(0)
  })

  it('shows the whole post in the drawer', async () => {
    at('/admin/moderation/reports?status=resolved&id=r3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(long)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Dismiss report' })).not.toBeInTheDocument()
  })

  it('dismisses a report', async () => {
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss report' }))
    await waitFor(() => expect(calls('resolve_report')[0][1]).toEqual({ id: 'r1' }))
    expect(await screen.findByText('Report dismissed')).toBeInTheDocument()
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'resolve', targetType: 'report', targetId: 'r1' })
    await waitFor(() => expect(screen.queryByText('Garlic cures malaria', { selector: 'p' })).not.toBeInTheDocument())
  })

  it('deletes the post only after the consequence is confirmed', async () => {
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete post' }))
    expect(await screen.findByText('Delete this post?')).toBeInTheDocument()
    expect(screen.getByText('This permanently deletes the post along with its likes and comments. This cannot be undone.')).toBeInTheDocument()
    expect(calls('delete_post')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('delete_post')[0][1]).toEqual({ id: 'p1' }))
    expect(await screen.findByText('Post deleted')).toBeInTheDocument()
  })

  it('does not offer to delete a post that no longer exists', async () => {
    at('/admin/moderation/reports?id=r4')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Dismiss report' })).toBeInTheDocument()
  })

  it('explains a failed action and leaves the drawer open', async () => {
    mockApi({ resolve_report: async () => { throw new Error('nope') } })
    at('/admin/moderation/reports?id=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss report' }))
    expect(await screen.findByText("Couldn't dismiss the report: nope")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an error with retry when the list fails', async () => {
    mockApi({ list_reports: async () => { throw new Error('down') } })
    at('/admin/moderation/reports')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('says the report could not be found for an unknown id', async () => {
    at('/admin/moderation/reports?id=zzz')
    expect(await screen.findByText('This report could not be found. It may already have been handled, or it is older than the 30 most recent reports.')).toBeInTheDocument()
  })
})
