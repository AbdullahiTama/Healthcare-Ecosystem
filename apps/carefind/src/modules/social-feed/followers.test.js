import { describe, it, expect, vi } from 'vitest'
import { fetchFollowList, FOLLOW_SELECT } from './followers'

// Queue-based chainable supabase mock (same shape as engagement.test.js):
// each awaited query resolves with the next queued result.
const makeSupabase = () => {
  const ctrl = { queue: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  const q = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.order = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
  ctrl.from = vi.fn(() => q)
  ctrl.q = q
  return ctrl
}

describe('fetchFollowList', () => {
  it('returns followers and uses the created_at ordering when the column exists', async () => {
    const supabase = makeSupabase()
    const rows = [
      { follower_id: 'p2', follower: { id: 'p2', full_name: 'Ada', show_followers: true } },
      { follower_id: 'p3', follower: { id: 'p3', full_name: 'Bayo', show_followers: true } },
    ]
    supabase.push({ data: rows, error: null })

    const { data, error } = await fetchFollowList({ supabase, profileId: 'p1', kind: 'followers' })

    expect(error).toBeNull()
    expect(data).toEqual(rows)
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.q.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('falls back to an unordered query when created_at is missing (pre-migration DB)', async () => {
    const supabase = makeSupabase()
    // The ordered query fails with PGRST204 (unknown column); the fallback works.
    supabase.push({ data: null, error: { code: 'PGRST204', message: 'Could not find the created_at column' } })
    const rows = [
      { following_id: 'p4', following: { id: 'p4', full_name: 'Chi', show_followers: true } },
    ]
    supabase.push({ data: rows, error: null })

    const { data, error } = await fetchFollowList({ supabase, profileId: 'p1', kind: 'following' })

    expect(error).toBeNull()
    expect(data).toEqual(rows)
    // Two queries ran; only the first attempt asked for ordering.
    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(supabase.q.order).toHaveBeenCalledTimes(1)
  })

  it('surfaces a real fallback failure instead of the misleading created_at error', async () => {
    const supabase = makeSupabase()
    supabase.push({ data: null, error: { code: 'PGRST204', message: 'no created_at' } })
    supabase.push({ data: null, error: { code: '42501', message: 'permission denied' } })

    const { data, error } = await fetchFollowList({ supabase, profileId: 'p1', kind: 'followers' })

    expect(data).toBeNull()
    expect(error.code).toBe('42501')
  })

  it('embeds the relationship for the requested kind', async () => {
    const supabase = makeSupabase()
    supabase.push({ data: [], error: null })

    await fetchFollowList({ supabase, profileId: 'p1', kind: 'followers' })
    const cols = supabase.q.select.mock.calls[0][0]
    expect(cols).toBe(FOLLOW_SELECT.followers)
    expect(cols).toContain('follower_id')

    await fetchFollowList({ supabase, profileId: 'p1', kind: 'following' })
    const cols2 = supabase.q.select.mock.calls[1][0]
    expect(cols2).toBe(FOLLOW_SELECT.following)
    expect(cols2).toContain('following_id')
  })
})
