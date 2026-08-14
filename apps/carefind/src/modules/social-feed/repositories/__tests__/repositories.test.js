import { describe, it, expect, vi } from 'vitest'

// Chainable-thenable supabase query mock. Every builder step returns the same
// awaitable query object, so any call shape (select→order→range, insert→select
// →single, update→eq→select…) resolves with the configured queryData/queryError.
const mockSupabase = vi.hoisted(() => {
  const query = () => {
    const q = {}
    q.select = vi.fn(() => q)
    q.order = vi.fn(() => q)
    q.range = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.in = vi.fn(() => q)
    q.or = vi.fn(() => q)
    q.single = vi.fn(() => q)
    q.maybeSingle = vi.fn(() => q)
    q.insert = vi.fn(() => q)
    q.update = vi.fn(() => q)
    q.delete = vi.fn(() => q)
    q.then = (resolve) => resolve({ data: mockSupabase.queryData, error: mockSupabase.queryError })
    return q
  }
  return {
    queryData: [],
    queryError: null,
    // Singleton chain: every .from() shares one query object so assertions
    // on supabase.from().<step>().<step> see the calls the repository made.
    q: query(),
    from: vi.fn(() => mockSupabase.q),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }
})

vi.mock('../../../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => mockSupabase.q),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}))

import { postRepository } from '../../repositories/postRepository'
import { commentRepository } from '../../repositories/commentRepository'

const supabase = (await import('../../../../config/supabaseClient')).supabase

describe('postRepository', () => {
  it('exposes the full post API surface', () => {
    expect(postRepository.getFeed).toBeDefined()
    expect(postRepository.getPostById).toBeDefined()
    expect(postRepository.createPost).toBeDefined()
    expect(postRepository.updatePost).toBeDefined()
    expect(postRepository.deletePost).toBeDefined()
    expect(postRepository.getReactions).toBeDefined()
    expect(postRepository.addReaction).toBeDefined()
    expect(postRepository.removeReaction).toBeDefined()
    expect(postRepository.getSavedPosts).toBeDefined()
    expect(postRepository.savePost).toBeDefined()
    expect(postRepository.unsavePost).toBeDefined()
    expect(postRepository.getCommentCounts).toBeDefined()
  })

  it('getFeed for foryou reads posts without a post_type filter', async () => {
    mockSupabase.queryData = []
    const data = await postRepository.getFeed('foryou')
    expect(supabase.from).toHaveBeenCalledWith('posts')
    expect(supabase.from().select().order().range().eq).not.toHaveBeenCalled()
    expect(data).toEqual([])
  })

  it('getFeed for a specific tab filters by post_type', async () => {
    await postRepository.getFeed('visual')
    expect(supabase.from().select().order().range().eq).toHaveBeenCalledWith('post_type', 'visual')
  })

  it('getFeed throws when the query fails', async () => {
    mockSupabase.queryError = new Error('boom')
    await expect(postRepository.getFeed('foryou')).rejects.toThrow('boom')
    mockSupabase.queryError = null
  })

  it('createPost inserts the post', async () => {
    const post = { content: 'hello', post_type: 'text' }
    await postRepository.createPost(post)
    expect(supabase.from).toHaveBeenCalledWith('posts')
    expect(supabase.from().insert).toHaveBeenCalledWith(post)
    expect(supabase.from().insert().select().single).toHaveBeenCalled()
  })

  it('updatePost only updates the caller’s own post', async () => {
    await postRepository.updatePost('p1', 'u1', { content: 'edited' })
    expect(supabase.from().update).toHaveBeenCalledWith({ content: 'edited' })
    expect(supabase.from().update().eq).toHaveBeenCalledWith('id', 'p1')
    expect(supabase.from().update().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('deletePost only deletes the caller’s own post', async () => {
    await postRepository.deletePost('p1', 'u1')
    expect(supabase.from).toHaveBeenCalledWith('posts')
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('id', 'p1')
    expect(supabase.from().delete().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('addReaction defaults to a like', async () => {
    await postRepository.addReaction('p1', 'u1')
    expect(supabase.from).toHaveBeenCalledWith('post_reactions')
    expect(supabase.from().insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', reaction_type: 'like' })
  })

  it('removeReaction only removes the caller’s own reaction', async () => {
    await postRepository.removeReaction('p1', 'u1')
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('post_id', 'p1')
    expect(supabase.from().delete().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('getCommentCounts aggregates comment counts per post', async () => {
    mockSupabase.queryData = [{ post_id: 'a' }, { post_id: 'a' }, { post_id: 'b' }]
    const counts = await postRepository.getCommentCounts(['a', 'b'])
    expect(counts).toEqual({ a: 2, b: 1 })
    mockSupabase.queryData = []
  })
})

describe('commentRepository', () => {
  it('getComments reads from post_comments filtered by post', async () => {
    await commentRepository.getComments('p1')
    expect(supabase.from).toHaveBeenCalledWith('post_comments')
    expect(supabase.from().select().eq).toHaveBeenCalledWith('post_id', 'p1')
  })

  it('addComment sends no parent_id for a top-level comment', async () => {
    await commentRepository.addComment('p1', 'u1', 'hello')
    expect(supabase.from().insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', content: 'hello', mentions: [] })
  })

  it('addComment includes parent_id when replying', async () => {
    await commentRepository.addComment('p1', 'u1', 'hello', 'c9')
    expect(supabase.from().insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', content: 'hello', parent_id: 'c9', mentions: [] })
  })

  it('addComment stores resolved mentions on the row', async () => {
    await commentRepository.addComment('p1', 'u1', 'hello', null, [{ username: 'DrAda', user_id: 'u9' }])
    expect(supabase.from().insert).toHaveBeenCalledWith({ post_id: 'p1', user_id: 'u1', content: 'hello', mentions: [{ username: 'DrAda', user_id: 'u9' }] })
  })

  it('updateComment trims the content before saving', async () => {
    await commentRepository.updateComment('c1', 'u1', '  trimmed  ')
    expect(supabase.from().update).toHaveBeenCalledWith({ content: 'trimmed' })
    expect(supabase.from().update().eq).toHaveBeenCalledWith('id', 'c1')
    expect(supabase.from().update().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('deleteComment only deletes the caller’s own comment', async () => {
    await commentRepository.deleteComment('c1', 'u1')
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('id', 'c1')
    expect(supabase.from().delete().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('resolveMentions matches display_name case-insensitively', async () => {
    mockSupabase.queryData = [{ id: 'u9', display_name: 'DrAda' }]
    const mentions = await commentRepository.resolveMentions(['drada', 'ghost'])
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(supabase.from().select().or).toHaveBeenCalledWith('display_name.ilike.drada,display_name.ilike.ghost')
    expect(mentions).toEqual([{ username: 'DrAda', user_id: 'u9' }])
    mockSupabase.queryData = []
  })

  it('resolveMentions returns [] for no usernames', async () => {
    await expect(commentRepository.resolveMentions([])).resolves.toEqual([])
  })

  it('addCommentLike inserts a like for the caller', async () => {
    await commentRepository.addCommentLike('c1', 'u1')
    expect(supabase.from).toHaveBeenCalledWith('post_comment_likes')
    expect(supabase.from().insert).toHaveBeenCalledWith({ comment_id: 'c1', user_id: 'u1' })
  })

  it('removeCommentLike only removes the caller’s own like', async () => {
    await commentRepository.removeCommentLike('c1', 'u1')
    expect(supabase.from().delete().eq).toHaveBeenCalledWith('comment_id', 'c1')
    expect(supabase.from().delete().eq().eq).toHaveBeenCalledWith('user_id', 'u1')
  })
})
