import { describe, it, expect, vi } from 'vitest'
import { fetchViewedStoryIds, markStoriesViewed } from './storyViews'

// Queue-based chainable supabase mock (same shape as followers.test.js).
const makeSupabase = () => {
  const ctrl = { queue: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  const q = {}
  q.select = vi.fn(() => q)
  q.in = vi.fn(() => q)
  q.upsert = vi.fn(() => q)
  q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
  ctrl.from = vi.fn(() => q)
  ctrl.q = q
  return ctrl
}

describe('fetchViewedStoryIds', () => {
  it('returns the set of seen story ids for this viewer', async () => {
    const supabase = makeSupabase()
    supabase.push({ data: [{ story_id: 's1' }, { story_id: 's3' }], error: null })

    const seen = await fetchViewedStoryIds(supabase, ['s1', 's2', 's3'])

    expect([...seen]).toEqual(['s1', 's3'])
    expect(supabase.from).toHaveBeenCalledWith('story_views')
    expect(supabase.q.in).toHaveBeenCalledWith('story_id', ['s1', 's2', 's3'])
  })

  it('returns an empty set without querying when there are no stories', async () => {
    const supabase = makeSupabase()
    const seen = await fetchViewedStoryIds(supabase, [])
    expect(seen.size).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns an empty set when the query errors', async () => {
    const supabase = makeSupabase()
    supabase.push({ data: null, error: { code: '42501', message: 'denied' } })
    const seen = await fetchViewedStoryIds(supabase, ['s1'])
    expect(seen.size).toBe(0)
  })
})

describe('markStoriesViewed', () => {
  it('upserts seen rows and resolves a 23505 race as success', async () => {
    const supabase = makeSupabase()
    supabase.push({ data: null, error: { code: '23505', message: 'duplicate' } })

    const result = await markStoriesViewed(supabase, { storyIds: ['s1'], userId: 'u1' })

    expect(supabase.from).toHaveBeenCalledWith('story_views')
    expect(supabase.q.upsert).toHaveBeenCalledWith(
      [{ story_id: 's1', user_id: 'u1' }],
      { onConflict: 'story_id,user_id', ignoreDuplicates: true },
    )
    expect(result.error).toBeNull()
  })

  it('does nothing without a session user', async () => {
    const supabase = makeSupabase()
    const result = await markStoriesViewed(supabase, { storyIds: ['s1'], userId: null })
    expect(result).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('does nothing when there are no stories to mark', async () => {
    const supabase = makeSupabase()
    const result = await markStoriesViewed(supabase, { storyIds: [], userId: 'u1' })
    expect(result).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
