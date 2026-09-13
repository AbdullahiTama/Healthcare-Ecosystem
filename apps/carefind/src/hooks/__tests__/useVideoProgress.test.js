import { describe, it, expect, beforeEach } from 'vitest'
import { getContinueWatchingIds } from '../useVideoProgress.js'

describe('getContinueWatchingIds', () => {
  it('returns empty array for empty progress', () => {
    expect(getContinueWatchingIds({})).toEqual([])
  })

  it('returns video ids with progress between 5% and 95%', () => {
    const progress = {
      'video-1': { percent: 50, updatedAt: Date.now() },
      'video-2': { percent: 10, updatedAt: Date.now() },
      'video-3': { percent: 96, updatedAt: Date.now() },
    }
    const ids = getContinueWatchingIds(progress)
    expect(ids).toContain('video-1')
    expect(ids).toContain('video-2')
    expect(ids).not.toContain('video-3')
  })

  it('sorts by most recently watched', () => {
    const now = Date.now()
    const progress = {
      'video-1': { percent: 50, updatedAt: now - 1000 },
      'video-2': { percent: 50, updatedAt: now },
    }
    const ids = getContinueWatchingIds(progress)
    expect(ids[0]).toBe('video-2')
  })

  it('limits to 10 items', () => {
    const progress = {}
    for (let i = 0; i < 15; i++) {
      progress[`video-${i}`] = { percent: 50, updatedAt: Date.now() - i }
    }
    const ids = getContinueWatchingIds(progress)
    expect(ids.length).toBe(10)
  })

  it('excludes videos with 0% progress', () => {
    const progress = {
      'video-1': { percent: 0, updatedAt: Date.now() },
      'video-2': { percent: 3, updatedAt: Date.now() },
    }
    const ids = getContinueWatchingIds(progress)
    expect(ids).not.toContain('video-1')
    expect(ids).not.toContain('video-2')
  })
})
