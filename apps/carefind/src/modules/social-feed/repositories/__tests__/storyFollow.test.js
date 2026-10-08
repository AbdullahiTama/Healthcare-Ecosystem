import { describe, it, expect } from 'vitest'
import { createStoryRepository } from '../storyRepository.js'
import { createFollowRepository } from '../followRepository.js'
import { mockSupabaseClient } from '../../../../test/mockSupabase.js'

describe('storyRepository', () => {
  function build(seed = {}) {
    const client = mockSupabaseClient(seed)
    return { client, repo: createStoryRepository({ client }) }
  }

  it('getActiveStoriesByUsers returns non-expired stories', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const { repo } = build({
      stories: [
        { id: 's1', user_id: 'u1', expires_at: future },
        { id: 's2', user_id: 'u2', expires_at: '2020-01-01' },
      ],
    })
    const result = await repo.getActiveStoriesByUsers(['u1', 'u2'])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })

  it('getActiveStoriesByUsers returns [] for empty input', async () => {
    const { repo } = build()
    expect(await repo.getActiveStoriesByUsers([])).toEqual([])
    expect(await repo.getActiveStoriesByUsers(null)).toEqual([])
  })

  it('getStoriesByUser returns stories ordered by created_at desc', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const { repo } = build({
      stories: [
        { id: 's1', user_id: 'u1', expires_at: future, created_at: '2026-01-01' },
        { id: 's2', user_id: 'u1', expires_at: future, created_at: '2026-01-03' },
      ],
    })
    const result = await repo.getStoriesByUser('u1')
    expect(result).toHaveLength(2)
    expect(result[0].created_at).toBe('2026-01-03')
  })

  it('addStoryReaction inserts a reaction', async () => {
    const { repo, client } = build()
    await repo.addStoryReaction('s1', 'u1')
    const rows = client._rows('story_reactions')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ story_id: 's1', user_id: 'u1', type: 'like' })
  })

  it('removeStoryReaction deletes a reaction', async () => {
    const { repo, client } = build({
      story_reactions: [{ id: 'r1', story_id: 's1', user_id: 'u1', type: 'like' }],
    })
    await repo.removeStoryReaction('s1', 'u1')
    expect(client._rows('story_reactions')).toHaveLength(0)
  })

  it('addStoryComment inserts and returns comment with profile', async () => {
    const { repo, client } = build()
    const result = await repo.addStoryComment('s1', 'u1', 'Nice!')
    expect(result.content).toBe('Nice!')
    expect(result.user_id).toBe('u1')
    expect(client._rows('story_comments')).toHaveLength(1)
  })
})

describe('followRepository', () => {
  function build(seed = {}) {
    const client = mockSupabaseClient(seed)
    return { client, repo: createFollowRepository({ client }) }
  }

  it('getMyFollowing returns following IDs for the user', async () => {
    const { repo } = build({
      follows: [
        { id: 'f1', follower_id: 'me', following_id: 'u1' },
        { id: 'f2', follower_id: 'me', following_id: 'u2' },
        { id: 'f3', follower_id: 'other', following_id: 'u1' },
      ],
    })
    const result = await repo.getMyFollowing('me', ['u1', 'u2', 'u3'])
    expect(result).toEqual(['u1', 'u2'])
  })

  it('getMyFollowing returns [] for empty targetIds', async () => {
    const { repo } = build()
    expect(await repo.getMyFollowing('me', [])).toEqual([])
  })

  it('follow inserts a follow relationship', async () => {
    const { repo, client } = build()
    await repo.follow('follower1', 'following1')
    const rows = client._rows('follows')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ follower_id: 'follower1', following_id: 'following1' })
  })

  it('unfollow deletes the follow relationship', async () => {
    const { repo, client } = build({
      follows: [{ id: 'f1', follower_id: 'me', following_id: 'u1' }],
    })
    await repo.unfollow('me', 'u1')
    expect(client._rows('follows')).toHaveLength(0)
  })

  it('removeFollowById deletes by id', async () => {
    const { repo, client } = build({
      follows: [{ id: 'f1', follower_id: 'me', following_id: 'u1' }],
    })
    await repo.removeFollowById('f1')
    expect(client._rows('follows')).toHaveLength(0)
  })
})
