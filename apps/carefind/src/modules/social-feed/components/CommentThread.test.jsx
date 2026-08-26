import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockSupabase = vi.hoisted(() => {
  const ctrl = { comments: [] }
  const query = () => {
    const q = {}
    q.select = vi.fn(() => q)
    q.order = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.in = vi.fn(() => q)
    q.single = vi.fn(() => q)
    q.insert = vi.fn(() => q)
    q.update = vi.fn(() => q)
    q.delete = vi.fn(() => q)
    q.then = (resolve) => resolve({ data: ctrl.comments, error: null })
    return q
  }
  return {
    ctrl,
    from: vi.fn(() => query()),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }
})

vi.mock('../../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user1', email: 'a@b.c' } }) }))
vi.mock('../../../services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../../../components/ui', () => ({
  Avatar: () => <span data-testid="avatar" />,
  TealBtn: ({ children, ...rest }) => <button {...rest}>{children}</button>,
}))

const supabase = (await import('../../../config/supabaseClient')).supabase
const notify = (await import('../../../services/notify.js')).notify

import { CommentThread } from './CommentThread.jsx'

function renderThread({ onCommentAdded, comments = [] } = {}) {
  return render(
    <MemoryRouter><HarnessWith comments={comments} onCommentAdded={onCommentAdded} /></MemoryRouter>
  )
}

describe('CommentThread (Feature 4 — comment notifications)', () => {
  beforeEach(() => {
    mockSupabase.ctrl.comments = [{ id: 'c1', content: 'new comment', user_id: 'user1', created_at: new Date().toISOString(), parent_id: null, profiles: {} }]
    notify.mockClear()
    supabase.from.mockClear()
  })

  it('calls onCommentAdded with postId after a top-level comment lands', async () => {
    const onCommentAdded = vi.fn()
    renderThread({ onCommentAdded })

    fireEvent.change(screen.getByPlaceholderText('Add a comment'), { target: { value: 'new comment' } })
    fireEvent.click(screen.getByRole('button', { name: /post/i }))

    await waitFor(() => expect(onCommentAdded).toHaveBeenCalledWith({ postId: 'post1', parentId: null }))
  })

  it('calls onCommentAdded with parentId when replying to a comment', async () => {
    const onCommentAdded = vi.fn()
    const comment = { id: 'c1', content: 'parent comment', user_id: 'user2', created_at: new Date().toISOString(), parent_id: null, profiles: {} }
    mockSupabase.ctrl.comments = [comment]
    renderThread({ onCommentAdded, comments: [comment] })

    fireEvent.click(screen.getByRole('button', { name: /reply/i }))
    fireEvent.change(screen.getByPlaceholderText(/Write a reply/), { target: { value: 'my reply' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/Write a reply/), { key: 'Enter' })

    await waitFor(() => expect(onCommentAdded).toHaveBeenCalledWith({ postId: 'post1', parentId: 'c1' }))
  })

  it('shows a verified commenter badge with their stored verification_label', () => {
    const comment = { id: 'c2', content: 'hello', user_id: 'user2', created_at: new Date().toISOString(), parent_id: null, profiles: { is_verified: true, verification_label: 'Verified Doctor', specialty: 'General Practice' } }
    renderThread({ comments: [comment] })
    expect(screen.getByText('Verified Doctor')).toBeInTheDocument()
    expect(screen.queryByText('General Practice')).not.toBeInTheDocument()
  })

  it('does not render an empty badge for a verified commenter without a label', () => {
    const comment = { id: 'c3', content: 'hi', user_id: 'user2', created_at: new Date().toISOString(), parent_id: null, profiles: { is_verified: true } }
    renderThread({ comments: [comment] })
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })
})

// Issue #6 — comments were a single-line input that silently cut off anything
// longer than one visual line. The box is now an auto-growing textarea with no
// length limit; Enter sends, Shift+Enter inserts a newline.
describe('CommentThread multi-line comment box (issue #6)', () => {
  beforeEach(() => {
    mockSupabase.ctrl.comments = []
    notify.mockClear()
    supabase.from.mockClear()
  })

  it('accepts a long comment in full, with no truncation', () => {
    renderThread({})
    const long = `${'Consider a patient presenting with persistent symptoms. '.repeat(12)}End of note.`
    const box = screen.getByPlaceholderText('Add a comment')
    fireEvent.change(box, { target: { value: long } })
    expect(box.value).toBe(long)
    expect(box.tagName).toBe('TEXTAREA')
  })

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const onCommentAdded = vi.fn()
    renderThread({ onCommentAdded })
    const box = screen.getByPlaceholderText('Add a comment')
    fireEvent.change(box, { target: { value: 'first line' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onCommentAdded).not.toHaveBeenCalled()
  })

  it('sends on Enter without Shift', async () => {
    const onCommentAdded = vi.fn()
    renderThread({ onCommentAdded })
    const box = screen.getByPlaceholderText('Add a comment')
    fireEvent.change(box, { target: { value: 'a longer comment that wraps onto several lines in the box' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onCommentAdded).toHaveBeenCalledWith({ postId: 'post1', parentId: null }))
  })

  it('the reply box also accepts multi-line replies', () => {
    const comment = { id: 'c1', content: 'parent', user_id: 'user2', created_at: new Date().toISOString(), parent_id: null, profiles: {} }
    renderThread({ comments: [comment] })
    fireEvent.click(screen.getByRole('button', { name: /reply/i }))
    const box = screen.getByPlaceholderText(/Write a reply/)
    const longReply = `${'Replying with detail. '.repeat(20)}Done.`
    fireEvent.change(box, { target: { value: longReply } })
    expect(box.value).toBe(longReply)
    expect(box.tagName).toBe('TEXTAREA')
  })
})

function HarnessWith({ comments, onCommentAdded }) {
  const [drafts, setDrafts] = useState({})
  const [replyingTo, setReplyingTo] = useState(null)
  const props = {
    postId: 'post1',
    user: { id: 'user1', email: 'a@b.c' },
    comments,
    onCommentsChange: vi.fn(),
    editingComment: null,
    setEditingComment: vi.fn(),
    replyingTo,
    setReplyingTo,
    commentDrafts: drafts,
    setCommentDrafts: setDrafts,
    myUsername: 'me',
    myAvatar: null,
    onCommentAdded,
  }
  return <CommentThread {...props} />
}