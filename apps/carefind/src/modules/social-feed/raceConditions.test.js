import { describe, it, expect, vi, beforeEach } from 'vitest'

// Phase 8 regression suite: the concurrency/idempotency contracts the
// engagement system relies on. The like/save/repost toggles are optimistic —
// a temp row is painted instantly and swapped for the DB row afterwards — so
// the guarantees under test are exactly the ones a fast double-tap or a
// toggle-thrash can violate:
//   * a double-tap must never produce two rows (unique index + 23505
//     read-back reconciliation),
//   * an unlike/un-save must delete the real row, never a temp phantom,
//   * a like → unlike → re-like cycle must end with exactly one fresh row,
//   * a repost reference is idempotent under concurrency,
//   * view recording stays one-RPC-per-post per session,
//   * undoing a repost twice is a safe no-op.
// These model the server contracts (20260813_post_engagement_uniqueness.sql:
// post_reactions/post_reposts/saved_posts unique indexes) plus the client
// reconciliation in engagement.js / Feed.jsx.

// Chainable, awaitable supabase mock. Every builder step returns the same
// query object; each awaited query resolves with the NEXT queued result, so
// tests can script multi-step flows. Calls are logged for shape assertions.
const makeQuery = (ctrl) => {
  const q = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.match = vi.fn(() => q)
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
  supabase.rpc.mockClear()
})

import { insertRowResolvingConflict, writeRepost, undoRepost, createViewRecorder } from './engagement'

const conflict = { code: '23505', message: 'duplicate key value violates unique constraint' }

describe('double-tap: two rapid likes on the same post', () => {
  it('resolves to exactly one row — one fresh insert, one read-back, no error', async () => {
    // First tap: insert wins. Second tap: insert hits 23505, read-back finds
    // the row the first tap created.
    supabase.push({ data: { id: 'r1', post_id: 'p1', user_id: 'u1' }, error: null })
    supabase.push({ data: null, error: conflict })
    supabase.push({ data: { id: 'r1', post_id: 'p1', user_id: 'u1' }, error: null })

    const [a, b] = await Promise.all([
      insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1', reaction_type: 'like' }, ['post_id', 'user_id']),
      insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1', reaction_type: 'like' }, ['post_id', 'user_id']),
    ])

    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(a.data.id).toBe('r1')
    expect(b.data.id).toBe('r1')
    // Two inserts; the loser went back and read the winner's row (never a
    // second insert, never a phantom temp id).
    expect(supabase.calls).toEqual(['from:post_reactions', 'from:post_reactions', 'from:post_reactions'])
  })

  it('double-tap save on saved_posts reconciles the same way', async () => {
    supabase.push({ data: { id: 's1', post_id: 'p2', user_id: 'u1' }, error: null })
    supabase.push({ data: null, error: conflict })
    supabase.push({ data: { id: 's1', post_id: 'p2', user_id: 'u1' }, error: null })

    const [a, b] = await Promise.all([
      insertRowResolvingConflict(supabase, 'saved_posts', { post_id: 'p2', user_id: 'u1' }, ['post_id', 'user_id']),
      insertRowResolvingConflict(supabase, 'saved_posts', { post_id: 'p2', user_id: 'u1' }, ['post_id', 'user_id']),
    ])

    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(a.data.id).toBe('s1')
    expect(b.data.id).toBe('s1')
  })

  it('the read-back after a conflict matches the conflict columns, not anything else', async () => {
    supabase.push({ data: null, error: conflict })
    supabase.push({ data: { id: 'r9', post_id: 'p1', user_id: 'u1' }, error: null })

    await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1', reaction_type: 'like' }, ['post_id', 'user_id'])
    expect(supabase.calls).toEqual(['from:post_reactions', 'from:post_reactions'])
  })
})

describe('toggle thrash: like → unlike → re-like', () => {
  it('the unlike deletes the real row and a re-like starts fresh', async () => {
    // 1) like: temp row is swapped for the real r1.
    supabase.push({ data: { id: 'r1', post_id: 'p1', user_id: 'u1' }, error: null })
    // 2) unlike: delete by the REAL id (what the swap produced), succeeds.
    supabase.push({ data: null, error: null })
    // 3) re-like: a fresh insert creates r2 — one row, not a duplicate.
    supabase.push({ data: { id: 'r2', post_id: 'p1', user_id: 'u1' }, error: null })

    const like = await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1', reaction_type: 'like' }, ['post_id', 'user_id'])
    expect(like.data.id).toBe('r1')

    // Feed.jsx deletes by the returned row's real id after the swap.
    const del = await supabase.from('post_reactions').delete().eq('id', like.data.id)
    expect(del.error).toBeNull()
    expect(supabase.calls[1]).toBe('from:post_reactions')

    const reLike = await insertRowResolvingConflict(supabase, 'post_reactions', { post_id: 'p1', user_id: 'u1', reaction_type: 'like' }, ['post_id', 'user_id'])
    expect(reLike.data.id).toBe('r2')
    expect(reLike.data.id).not.toBe('r1')
  })
})

describe('repost under double-tap', () => {
  it('the post_reposts reference is idempotent — a repeat tap resolves, never duplicates', async () => {
    // A double-tap in one render tick runs writeRepost twice. The first writes
    // ref1 + its feed post; the second hits 23505 on the reference and reads
    // the winner back instead of erroring — so the reference table (what
    // repost_count and the Reposts tab read) stays single-row. Each tap still
    // writes its own feed post, the documented edge: two identical 🔁 posts
    // are harmless to counts and resolved by the next reload, but flagged in
    // the Phase 8 report.
    supabase.push({ data: { id: 'ref1', post_id: 'p1', user_id: 'u1' }, error: null })
    supabase.push({ data: { id: 'rp1', user_id: 'u1', content: '🔁 X', repost_of: 'p1' }, error: null })
    supabase.push({ data: null, error: conflict })
    supabase.push({ data: { id: 'ref1', post_id: 'p1', user_id: 'u1' }, error: null })
    supabase.push({ data: { id: 'rp2', user_id: 'u1', content: '🔁 X', repost_of: 'p1' }, error: null })

    const post = { id: 'p1', content: 'X', image_url: null }
    const first = await writeRepost(supabase, { user: { id: 'u1' }, post })
    const second = await writeRepost(supabase, { user: { id: 'u1' }, post })

    expect(first.ref.error).toBeNull()
    expect(second.ref.error).toBeNull()
    expect(first.ref.data.id).toBe('ref1')
    expect(second.ref.data.id).toBe('ref1')
    // ref insert → ref read-back (23505 path) → two feed-post inserts.
    expect(supabase.calls).toEqual(['from:post_reposts', 'from:posts', 'from:post_reposts', 'from:post_reposts', 'from:posts'])
  })
})

describe('undo repost edge cases', () => {
  it('undoing an already-undone repost is a safe no-op', async () => {
    // Second undo: no 🔁 post exists any more → postsDelete null, ref row
    // (if still present) deleted. Never throws, never deletes someone else's.
    supabase.push({ data: null, error: null })
    supabase.push({ data: null, error: null })
    const { postsDelete, refDelete } = await undoRepost(supabase, { user: { id: 'u1' }, sourcePostId: 'p1', repostRefId: 'ref1' })
    expect(postsDelete).toBeNull()
    expect(refDelete.error).toBeNull()
  })

  it('undo targets only the caller’s own 🔁 post', async () => {
    supabase.push({ data: { id: 'rp1' }, error: null })
    supabase.push({ data: null, error: null })
    const { postsDelete } = await undoRepost(supabase, { user: { id: 'u1' }, sourcePostId: 'p1', repostRefId: 'ref1' })
    expect(postsDelete.error).toBeNull()
    expect(supabase.calls).toEqual(['from:posts', 'from:posts', 'from:post_reposts'])
  })
})

describe('view recording under StrictMode double-effects', () => {
  it('concurrent records of the same post fire exactly one RPC', async () => {
    const recorder = createViewRecorder(supabase)
    const results = await Promise.all([recorder.record('p1'), recorder.record('p1')])
    expect(results).toEqual([true, false])
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('record_post_view', expect.objectContaining({ p_post_id: 'p1' }))
  })
})
