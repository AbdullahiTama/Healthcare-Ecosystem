import { describe, it, expect } from 'vitest'
import {
  likeCount, userHasLiked, commentTotal, countFrom, userHasReposted,
  isSaved, isFollowing, isLocked, formatCount, timeAgo, resolveSourceFrom,
} from './postSelectors.js'

describe('postSelectors', () => {
  it('counts likes for one post only', () => {
    const reactions = [
      { id: 'r1', post_id: 'p1', user_id: 'u1' },
      { id: 'r2', post_id: 'p1', user_id: 'u2' },
      { id: 'r3', post_id: 'p2', user_id: 'u1' },
    ]
    expect(likeCount(reactions, 'p1')).toBe(2)
    expect(likeCount(reactions, 'p2')).toBe(1)
    expect(likeCount(reactions, 'nope')).toBe(0)
  })

  it('reports whether a specific viewer liked a post', () => {
    const reactions = [{ id: 'r1', post_id: 'p1', user_id: 'u1' }]
    expect(userHasLiked(reactions, 'p1', 'u1')).toBe(true)
    expect(userHasLiked(reactions, 'p1', 'u2')).toBe(false)
    // A logged-out viewer has liked nothing.
    expect(userHasLiked(reactions, 'p1', null)).toBe(false)
  })

  it('reads counts out of a keyed map, defaulting to 0', () => {
    expect(commentTotal({ p1: 3 }, 'p1')).toBe(3)
    expect(commentTotal({}, 'p1')).toBe(0)
    expect(countFrom({ p1: 7 }, 'p1')).toBe(7)
    expect(countFrom(undefined, 'p1')).toBe(0)
  })

  it('reports repost and save membership', () => {
    expect(userHasReposted([{ post_id: 'p1' }], 'p1')).toBe(true)
    expect(userHasReposted([], 'p1')).toBe(false)
    expect(isSaved([{ post_id: 'p1' }], 'p1')).toBe(true)
    expect(isSaved([{ post_id: 'p2' }], 'p1')).toBe(false)
  })

  it('reports following only for the viewer own follow rows', () => {
    const follows = [{ id: 'f1', follower_id: 'u1', following_id: 'a1' }]
    expect(isFollowing(follows, 'a1', 'u1')).toBe(true)
    // Someone else following the author does not mean the viewer does.
    expect(isFollowing(follows, 'a1', 'u2')).toBe(false)
    expect(isFollowing(follows, 'a1', null)).toBe(false)
  })

  it('locks subscriber-only posts unless yours or unlocked', () => {
    const post = { id: 'p1', user_id: 'a1', subscriber_only: true }
    expect(isLocked(post, [], 'u1')).toBe(true)
    expect(isLocked(post, ['a1'], 'u1')).toBe(false)
    // Your own subscriber-only post is never locked to you.
    expect(isLocked(post, [], 'a1')).toBe(false)
    // Legacy premium posts are treated as subscriber-only.
    expect(isLocked({ id: 'p2', user_id: 'a1', post_type: 'premium' }, [], 'u1')).toBe(true)
    expect(isLocked({ id: 'p3', user_id: 'a1' }, [], 'u1')).toBe(false)
  })

  // These strings are already on screen. The assertions below are the CURRENT
  // output, transcribed from Feed.jsx:1687-1700 — this task must not change them.
  it('formats counts compactly', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(null)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1000)).toBe('1k')
    expect(formatCount(1500)).toBe('1.5k')
    // At and above 10k the fraction is dropped.
    expect(formatCount(12500)).toBe('13k')
    expect(formatCount(1000000)).toBe('1M')
    expect(formatCount(2500000)).toBe('2.5M')
  })

  it('renders relative time', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 30 * 1000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60 * 1000).toISOString())).toBe('5m ago')
    expect(timeAgo(new Date(now - 3 * 3600 * 1000).toISOString())).toBe('3h ago')
    expect(timeAgo(new Date(now - 2 * 86400 * 1000).toISOString())).toBe('2d ago')
  })

  it('resolves a repost source from the loaded page or the fetched map', () => {
    const posts = [{ id: 's1', content: 'source' }]
    const sources = { s2: { id: 's2', content: 'fetched' } }
    expect(resolveSourceFrom(posts, sources, 's1').content).toBe('source')
    expect(resolveSourceFrom(posts, sources, 's2').content).toBe('fetched')
    expect(resolveSourceFrom(posts, sources, 's3')).toBeNull()
  })
})
