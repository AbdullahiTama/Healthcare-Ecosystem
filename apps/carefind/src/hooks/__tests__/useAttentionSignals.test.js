import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getUserAttentionState } from '../useAttentionSignals.js'

describe('getUserAttentionState', () => {
  it('returns all false for unknown user', () => {
    const signals = {}
    const state = getUserAttentionState(signals, 'user-1')
    expect(state).toEqual({
      hasStory: false,
      isLive: false,
      hasNewPosts: false,
    })
  })

  it('returns hasStory when user has active stories', () => {
    const signals = {
      'user-1': { hasStory: true },
    }
    const state = getUserAttentionState(signals, 'user-1')
    expect(state.hasStory).toBe(true)
  })

  it('returns isLive when user is currently live', () => {
    const signals = {
      'user-1': { isLive: true },
    }
    const state = getUserAttentionState(signals, 'user-1')
    expect(state.isLive).toBe(true)
  })

  it('returns hasNewPosts when user has recent posts', () => {
    const signals = {
      'user-1': { hasRecentPosts: true },
    }
    const state = getUserAttentionState(signals, 'user-1')
    expect(state.hasNewPosts).toBe(true)
  })

  it('combines multiple signals', () => {
    const signals = {
      'user-1': { hasStory: true, isLive: true, hasRecentPosts: true },
    }
    const state = getUserAttentionState(signals, 'user-1')
    expect(state).toEqual({
      hasStory: true,
      isLive: true,
      hasNewPosts: true,
    })
  })
})
