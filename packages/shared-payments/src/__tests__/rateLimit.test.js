import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../rateLimit.js'

describe('createRateLimiter', () => {
  it('allows up to max per window per key, then refuses, then recovers', () => {
    let t = 0
    const allow = createRateLimiter({ windowMs: 1000, max: 2, now: () => t })
    expect([allow('a'), allow('a'), allow('a')]).toEqual([true, true, false])
    expect(allow('b')).toBe(true)
    t = 1001
    expect(allow('a')).toBe(true)
  })
})
