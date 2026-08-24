import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = vi.hoisted(() => {
  const data = {
    tables: {
      posts: [], post_reactions: [], post_reposts: [], profiles: [], post_comments: [],
      post_shares: [], saved_posts: [], follows: [], user_subscriptions: [],
      businesses: [],
    },
    rpcRows: {},
    seq: 0,
  }
  const rows = (t) => data.tables[t] || []
  const matches = (row, cons) =>
    Object.entries(cons).every(([col, vals]) => {
      const arr = Array.isArray(vals) ? vals : [vals]
      return arr.flat().some((v) => row[col] === v)
    })
  function builder(table) {
    const cons = {}
    // The handlers write as well as read, so the builder now carries a mode:
    // an insert stores and returns the persisted row (which is what the
    // optimistic toggles reconcile their temp row against), a delete removes
    // the rows the constraints select, an update patches them.
    let mode = 'select'
    let inserted = null
    let patch = null
    const settle = () => {
      if (mode === 'insert') return { data: inserted, error: null }
      if (mode === 'delete') {
        data.tables[table] = rows(table).filter((r) => !matches(r, cons))
        return { data: null, error: null }
      }
      if (mode === 'update') {
        data.tables[table] = rows(table).map((r) => (matches(r, cons) ? { ...r, ...patch } : r))
        return { data: null, error: null }
      }
      return null
    }
    const b = {
      select: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      eq: vi.fn((c, v) => { (cons[c] = cons[c] || []).push(v); return b }),
      in: vi.fn((c, vs) => { (cons[c] = cons[c] || []).push(vs); return b }),
      match: vi.fn((m) => { Object.entries(m).forEach(([c, v]) => { (cons[c] = cons[c] || []).push(v) }); return b }),
      insert: vi.fn((row) => {
        mode = 'insert'
        inserted = { id: `row_${++data.seq}`, ...row }
        data.tables[table] = [...rows(table), inserted]
        return b
      }),
      update: vi.fn((p) => { mode = 'update'; patch = p; return b }),
      delete: vi.fn(() => { mode = 'delete'; return b }),
      maybeSingle: vi.fn(() => Promise.resolve(
        settle() || { data: rows(table).find((r) => matches(r, cons)) || null, error: null },
      )),
      then: (res) => Promise.resolve(
        settle() || { data: rows(table).filter((r) => matches(r, cons)), error: null },
      ).then(res),
    }
    return b
  }
  return {
    supabase: {
      from: vi.fn((t) => builder(t)),
      rpc: vi.fn((fn) => Promise.resolve({ data: data.rpcRows[fn] || [], error: null })),
    },
    data,
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase.supabase }))
vi.mock('../../services/notify.js', () => ({
  notify: vi.fn(),
  NOTIF_MESSAGES: { repost: 'reposted your post' },
}))
// shareCard's exporters touch canvas/MediaRecorder, neither of which exists in
// jsdom; the card export itself is voiceCard's own tested surface.
vi.mock('../../utils/voiceCard.js', () => ({
  canExportVideo: vi.fn(() => false),
  exportVideo: vi.fn(),
  exportImage: vi.fn(async () => new Blob(['card'])),
  shareOrDownload: vi.fn(async () => 'downloaded'),
}))

import { usePostEngagement } from './usePostEngagement.js'
import { notify } from '../../services/notify.js'

const USER = { id: 'u1' }
const post = (id, userId = 'a1') => ({ id, user_id: userId, post_type: 'text', content: 'x', created_at: '2026-01-01T00:00:00.000Z' })

function setup(overrides = {}) {
  const navigate = vi.fn()
  const toast = { show: vi.fn() }
  return {
    ...renderHook(() => usePostEngagement({ user: USER, navigate, toast, ...overrides })),
    navigate,
    toast,
  }
}

beforeEach(() => {
  Object.keys(mockSupabase.data.tables).forEach((t) => { mockSupabase.data.tables[t] = [] })
  mockSupabase.data.rpcRows = {}
  mockSupabase.data.seq = 0
  vi.clearAllMocks()
})

describe('usePostEngagement.hydrate', () => {
  it('derives the same per-post context for one post as for many', async () => {
    mockSupabase.data.tables.post_reactions = [
      { id: 'r1', post_id: 'p1', user_id: 'u2' },
      { id: 'r2', post_id: 'p2', user_id: 'u2' },
    ]

    const many = setup()
    await act(async () => { await many.result.current.hydrate([post('p1'), post('p2')]) })
    const manyLikes = many.result.current.engagementProps.likeCount('p1')

    const one = setup()
    await act(async () => { await one.result.current.hydrate([post('p1')]) })
    const oneLikes = one.result.current.engagementProps.likeCount('p1')

    expect(oneLikes).toBe(manyLikes)
    expect(oneLikes).toBe(1)
  })

  it('merge:false drops posts absent from the new batch', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u2' }]
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(1)

    // A feed refetch that no longer contains p1 must not leave its counts behind.
    mockSupabase.data.tables.post_reactions = [{ id: 'r2', post_id: 'p9', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([post('p9')], { merge: false }) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
    expect(result.current.engagementProps.likeCount('p9')).toBe(1)
  })

  it('merge:true preserves existing state and never double-counts a re-hydrate', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u2' }]
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })

    // A deep-linked post arriving must not clobber the feed behind it...
    mockSupabase.data.tables.post_reactions = [{ id: 'r2', post_id: 'p2', user_id: 'u2' }]
    await act(async () => { await result.current.hydrate([post('p2')], { merge: true }) })
    expect(result.current.engagementProps.likeCount('p1')).toBe(1)
    expect(result.current.engagementProps.likeCount('p2')).toBe(1)

    // ...and hydrating the same post twice must not count its reactions twice.
    await act(async () => { await result.current.hydrate([post('p2')], { merge: true }) })
    expect(result.current.engagementProps.likeCount('p2')).toBe(1)
  })

  it('returns an engine context shaped for the ranker', async () => {
    mockSupabase.data.tables.post_reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u1' }]
    const { result } = setup()
    let ctx
    await act(async () => { ctx = await result.current.hydrate([post('p1')]) })
    expect(ctx).toHaveProperty('lCounts')
    expect(ctx).toHaveProperty('cCounts')
    expect(ctx).toHaveProperty('profiles')
    expect(ctx).toHaveProperty('interest')
    expect(ctx.lCounts.p1).toBe(1)
    // The viewer's own reaction feeds the affinity signal.
    expect(ctx.viewerReactionIds.has('p1')).toBe(true)
  })
})

describe('usePostEngagement handlers', () => {
  it('optimistically likes and reconciles against the insert', async () => {
    mockSupabase.data.tables.post_reactions = []
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    expect(result.current.engagementProps.userHasLiked('p1')).toBe(false)

    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    expect(result.current.engagementProps.userHasLiked('p1')).toBe(true)
    // The temp row was swapped for the persisted one, so an unlike has a real
    // id to delete rather than a phantom temp id.
    expect(result.current.state.reactions.every((r) => !String(r.id).startsWith('temp_'))).toBe(true)
  })

  it('unlikes on a second tap', async () => {
    mockSupabase.data.tables.post_reactions = []
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    await act(async () => { await result.current.engagementProps.toggleLike('p1') })

    expect(result.current.engagementProps.userHasLiked('p1')).toBe(false)
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
    expect(mockSupabase.data.tables.post_reactions).toHaveLength(0)
  })

  it('does nothing when a logged-out viewer taps like', async () => {
    const { result } = renderHook(() =>
      usePostEngagement({ user: null, navigate: vi.fn(), toast: { show: vi.fn() } }))
    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    expect(result.current.engagementProps.likeCount('p1')).toBe(0)
    expect(mockSupabase.data.tables.post_reactions).toHaveLength(0)
  })

  it('toggles a comment panel open and closed', async () => {
    const { result } = setup()
    await act(async () => { await result.current.engagementProps.toggleComments('p1') })
    expect(result.current.state.openComments.p1).toBeTruthy()
    await act(async () => { await result.current.engagementProps.toggleComments('p1') })
    expect(result.current.state.openComments.p1).toBeFalsy()
  })

  it('notifies the post author when a comment is added, and the parent author on a reply', async () => {
    const { result } = setup()
    act(() => { result.current.state.setPosts([post('p1', 'a1')]) })
    act(() => {
      result.current.engagementProps.setComments({ p1: [{ id: 'c1', user_id: 'a2' }] })
    })

    act(() => { result.current.engagementProps.handleCommentAdded({ postId: 'p1', parentId: null }) })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'a1', type: 'comment' }))
    expect(notify).toHaveBeenCalledTimes(1)

    act(() => { result.current.engagementProps.handleCommentAdded({ postId: 'p1', parentId: 'c1' }) })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'a2', type: 'reply' }))
    expect(notify).toHaveBeenCalledTimes(3)
  })

  it('hands a like to the host engagement logger', async () => {
    const logEngagement = vi.fn()
    const { result } = setup({ logEngagement })
    await act(async () => { await result.current.hydrate([post('p1')]) })
    await act(async () => { await result.current.engagementProps.toggleLike('p1') })
    expect(logEngagement).toHaveBeenCalledWith('p1')
  })

  it('optimistically saves and bumps the save count', async () => {
    const { result } = setup()
    await act(async () => { await result.current.hydrate([post('p1')]) })
    expect(result.current.engagementProps.isSaved('p1')).toBe(false)

    await act(async () => { await result.current.engagementProps.toggleSave('p1') })
    expect(result.current.engagementProps.isSaved('p1')).toBe(true)
    expect(result.current.engagementProps.saveCount('p1')).toBe(1)

    await act(async () => { await result.current.engagementProps.toggleSave('p1') })
    expect(result.current.engagementProps.isSaved('p1')).toBe(false)
    expect(result.current.engagementProps.saveCount('p1')).toBe(0)
  })

  it('routes a logged-out report to login and an already-reported post to a toast', async () => {
    const onReportPost = vi.fn()
    const loggedOutNavigate = vi.fn()
    const { result: loggedOut } = renderHook(() => usePostEngagement({
      user: null, navigate: loggedOutNavigate, toast: { show: vi.fn() }, onReportPost,
    }))
    act(() => { loggedOut.current.engagementProps.openReport('p1') })
    expect(loggedOutNavigate).toHaveBeenCalledWith('/login')
    expect(onReportPost).not.toHaveBeenCalled()

    const { result, toast } = setup({ onReportPost })
    act(() => { result.current.state.setReportedPosts(['p1']) })
    act(() => { result.current.engagementProps.openReport('p1') })
    expect(toast.show).toHaveBeenCalledWith('You already reported this post.')
    expect(onReportPost).not.toHaveBeenCalled()

    act(() => { result.current.engagementProps.openReport('p2') })
    expect(onReportPost).toHaveBeenCalledWith('p2')
  })

  it('marks the card as sharing and clears it once the export finishes', async () => {
    const onSharingChange = vi.fn()
    const { result } = setup({ onSharingChange })
    await act(async () => { await result.current.engagementProps.shareCard(post('p1')) })
    expect(onSharingChange.mock.calls).toEqual([['p1'], [null]])
  })
})

// The in-flight guard inside toggleRepost is the only thing stopping a
// double-tap from issuing two full repost toggles. Until Task 4 it lived in
// Feed.jsx and nothing covered it — raceConditions.test.js scopes it out
// explicitly as "Feed's", PostCard passes the handler in as a stub. Now that
// the hook holds the sole implementation, these two tests are what would go
// red if a future edit dropped the ref.
describe('usePostEngagement toggleRepost in-flight guard', () => {
  const reposts = (sourceId) => (mockSupabase.data.tables.posts || []).filter((p) => p.repost_of === sourceId)

  it('issues one repost, not two, for a double-tap in the same tick', async () => {
    const { result } = setup()
    const source = post('p1')
    await act(async () => { await result.current.hydrate([source]) })

    // Both calls start before either awaits its first write, which is exactly
    // the double-tap the guard exists for.
    await act(async () => {
      await Promise.all([
        result.current.engagementProps.toggleRepost(source),
        result.current.engagementProps.toggleRepost(source),
      ])
    })

    expect(mockSupabase.data.tables.post_reposts).toHaveLength(1)
    expect(reposts('p1')).toHaveLength(1)
    expect(result.current.engagementProps.userHasReposted('p1')).toBe(true)
  })

  it('releases the guard once a toggle settles, on both the repost and undo paths', async () => {
    const { result } = setup()
    const source = post('p1')
    await act(async () => { await result.current.hydrate([source]) })

    await act(async () => { await result.current.engagementProps.toggleRepost(source) })
    expect(result.current.engagementProps.userHasReposted('p1')).toBe(true)

    // A leaked ref would swallow this tap and leave the repost standing. The
    // undo path returns from inside the try, so only the `finally` clears it.
    await act(async () => { await result.current.engagementProps.toggleRepost(source) })
    expect(result.current.engagementProps.userHasReposted('p1')).toBe(false)
    expect(mockSupabase.data.tables.post_reposts).toHaveLength(0)
    expect(reposts('p1')).toHaveLength(0)

    // ...and the undo released it too, so the post can be reposted again.
    await act(async () => { await result.current.engagementProps.toggleRepost(source) })
    expect(result.current.engagementProps.userHasReposted('p1')).toBe(true)
    expect(mockSupabase.data.tables.post_reposts).toHaveLength(1)
  })
})
