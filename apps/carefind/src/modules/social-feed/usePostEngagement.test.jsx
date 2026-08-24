import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = vi.hoisted(() => {
  const data = {
    tables: {
      post_reactions: [], post_reposts: [], profiles: [], post_comments: [],
      post_shares: [], saved_posts: [], follows: [], user_subscriptions: [],
      businesses: [],
    },
    rpcRows: {},
  }
  const rows = (t) => data.tables[t] || []
  const matches = (row, cons) =>
    Object.entries(cons).every(([col, vals]) => {
      const arr = Array.isArray(vals) ? vals : [vals]
      return arr.flat().some((v) => row[col] === v)
    })
  function builder(table) {
    const cons = {}
    const b = {
      select: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      eq: vi.fn((c, v) => { (cons[c] = cons[c] || []).push(v); return b }),
      in: vi.fn((c, vs) => { (cons[c] = cons[c] || []).push(vs); return b }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      then: (res) => Promise.resolve({ data: rows(table).filter((r) => matches(r, cons)), error: null }).then(res),
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

import { usePostEngagement } from './usePostEngagement.js'

const USER = { id: 'u1' }
const post = (id, userId = 'a1') => ({ id, user_id: userId, post_type: 'text', content: 'x', created_at: '2026-01-01T00:00:00.000Z' })

function setup() {
  return renderHook(() => usePostEngagement({ user: USER, navigate: vi.fn(), toast: { show: vi.fn() } }))
}

beforeEach(() => {
  Object.keys(mockSupabase.data.tables).forEach((t) => { mockSupabase.data.tables[t] = [] })
  mockSupabase.data.rpcRows = {}
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
