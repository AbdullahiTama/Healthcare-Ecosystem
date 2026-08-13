import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, awaitable supabase mock. Every builder step returns the same
// query object; each awaited query resolves with the NEXT queued result, so
// tests can script multi-step flows (insert fails 23505, then the read-back
// returns the existing row). Calls are logged for shape assertions.
const makeQuery = (ctrl) => {
  const q = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.match = vi.fn(() => q)
  q.single = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => q)
  q.insert = vi.fn(() => q)
  q.delete = vi.fn(() => q)
  q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
  return q
}

const makeSupabase = () => {
  const ctrl = { queue: [], calls: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  ctrl.from = vi.fn((table) => {
    ctrl.calls.push(`from:${table}`)
    return makeQuery(ctrl)
  })
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return ctrl
}

const supabase = makeSupabase()

beforeEach(() => {
  supabase.queue.length = 0
  supabase.calls.length = 0
})

import { insertRowResolvingConflict, writeRepost, undoRepost, createViewRecorder } from './engagement'

describe('insertRowResolvingConflict', () => {
  it('returns the fresh insert row on success', async () => {
    supabase.push({ data: { id: 'r1', post_id: 'p1', user_id: 'u1' }, error: null })
    const { data, error } = await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1' }, ['post_id', 'user_id'])
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'r1', post_id: 'p1', user_id: 'u1' })
    expect(supabase.calls[0]).toBe('from:post_reactions')
  })

  it('reads back the existing row on a 23505 double-tap instead of failing', async () => {
    // Insert hits the unique index; the read-back then finds the row.
    supabase.push({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    supabase.push({ data: { id: 'r1', post_id: 'p1', user_id: 'u1' }, error: null })

    const { data, error } = await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1' }, ['post_id', 'user_id'])
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'r1', post_id: 'p1', user_id: 'u1' })
    expect(supabase.calls).toEqual(['from:post_reactions', 'from:post_reactions'])
  })

  it('surfaces a real failure (non-23505) with no data', async () => {
    supabase.push({ data: null, error: { code: '42501', message: 'permission denied' } })
    const { data, error } = await insertRowResolvingConflict(supabase, 'saved_posts', { post_id: 'p1', user_id: 'u1' }, ['post_id', 'user_id'])
    expect(data).toBeNull()
    expect(error.code).toBe('42501')
  })

  it('fails when the read-back after a conflict finds nothing', async () => {
    supabase.push({ data: null, error: { code: '23505', message: 'duplicate' } })
    supabase.push({ data: null, error: null })
    const { data, error } = await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1' }, ['post_id', 'user_id'])
    expect(data).toBeNull()
    expect(error.code).toBe('23505')
  })
})

describe('writeRepost', () => {
  it('writes the reference AND a 🔁-marked post carrying repost_of', async () => {
    supabase.push({ data: { id: 'ref1', post_id: 'p1', user_id: 'u1' }, error: null })
    supabase.push({ data: { id: 'rp1', user_id: 'u1', content: '🔁 Original text', repost_of: 'p1', subscriber_only: true, is_premium: false, post_type: 'text' }, error: null })

    const post = { id: 'p1', content: 'Original text', subscriber_only: true, is_premium: false, image_url: null }
    const { ref, repostPost } = await writeRepost(supabase, { user: { id: 'u1' }, post })

    expect(ref.data).toEqual({ id: 'ref1', post_id: 'p1', user_id: 'u1' })
    expect(repostPost.data.repost_of).toBe('p1')
    expect(repostPost.data.content.startsWith('🔁')).toBe(true)
    expect(repostPost.data.subscriber_only).toBe(true)
    expect(supabase.calls).toEqual(['from:post_reposts', 'from:posts'])
  })

  it('does not fail the whole repost if the reference row already exists', async () => {
    // The reference insert resolves to the existing row; the feed post insert
    // is what the repost actually depends on.
    supabase.push({ data: { id: 'ref1', post_id: 'p1', user_id: 'u1' }, error: null })
    supabase.push({ data: { id: 'rp1', user_id: 'u1', content: '🔁 X', repost_of: 'p1' }, error: null })
    const { ref, repostPost } = await writeRepost(supabase, { user: { id: 'u1' }, post: { id: 'p1', content: 'X', image_url: null } })
    expect(ref.error).toBeNull()
    expect(repostPost.error).toBeNull()
  })
})

describe('undoRepost', () => {
  it('deletes the reposter’s 🔁 post and the reference row', async () => {
    supabase.push({ data: { id: 'rp1' }, error: null })
    supabase.push({ data: null, error: null })
    supabase.push({ data: null, error: null })
    const { postsDelete, refDelete } = await undoRepost(supabase, { user: { id: 'u1' }, sourcePostId: 'p1', repostRefId: 'ref1' })
    expect(postsDelete.error).toBeNull()
    expect(refDelete.error).toBeNull()
    expect(supabase.calls).toEqual(['from:posts', 'from:posts', 'from:post_reposts'])
  })

  it('is a no-op for the post delete when no repost post is found', async () => {
    supabase.push({ data: null, error: null })
    const { postsDelete, refDelete } = await undoRepost(supabase, { user: { id: 'u1' }, sourcePostId: 'p1', repostRefId: null })
    expect(postsDelete).toBeNull()
    expect(refDelete).toBeNull()
    expect(supabase.calls).toEqual(['from:posts'])
  })
})

describe('createViewRecorder', () => {
  it('records the first view of a post and dedupes later ones in the same session', () => {
    const recorder = createViewRecorder(supabase)
    supabase.rpc.mockClear()

    expect(recorder.record('p1')).toBe(true)
    expect(recorder.record('p1')).toBe(false)
    expect(recorder.record('p1')).toBe(false)

    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_post_view',
      expect.objectContaining({ p_post_id: 'p1', p_session_id: expect.any(String) })
    )
    expect(recorder.has('p1')).toBe(true)
  })

  it('records a view for each distinct post once', () => {
    const recorder = createViewRecorder(supabase)
    supabase.rpc.mockClear()

    recorder.record('p1')
    recorder.record('p2')
    recorder.record('p1')
    recorder.record('p3')

    expect(supabase.rpc).toHaveBeenCalledTimes(3)
    const posts = supabase.rpc.mock.calls.map(([, args]) => args.p_post_id).sort()
    expect(posts).toEqual(['p1', 'p2', 'p3'])
  })

  it('a fresh recorder (new session) records a repeat view of the same post', () => {
    const first = createViewRecorder(supabase)
    const second = createViewRecorder(supabase)
    supabase.rpc.mockClear()

    first.record('p1')
    second.record('p1')

    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    const sessions = supabase.rpc.mock.calls.map(([, args]) => args.p_session_id)
    expect(sessions[0]).toBe(first.sessionId)
    expect(sessions[1]).toBe(second.sessionId)
    expect(sessions[0]).not.toBe(sessions[1])
  })
})
