import { describe, it, expect } from 'vitest'
import {
  MAX_POST_IMAGES,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_BYTES,
  validateVideoFile,
} from './mediaLimits'

// Issue #7 — videos were capped at "12MB (about 15 seconds)", a size number
// silently deciding duration. The cap is now explicit seconds with a matching
// size ceiling, and these tests pin both messages and boundaries.

describe('mediaLimits (issue #7)', () => {
  it('allows at least one minute of video', () => {
    expect(MAX_VIDEO_SECONDS).toBeGreaterThanOrEqual(60)
  })

  it('accepts a one-minute clip within the size ceiling', () => {
    const result = validateVideoFile({ size: MAX_VIDEO_BYTES - 1, duration: 60 })
    expect(result).toBeNull()
  })

  it('rejects an oversized clip with a readable reason', () => {
    const result = validateVideoFile({ size: MAX_VIDEO_BYTES + 1, duration: 30 })
    expect(result).toMatch(/too large/i)
    expect(result).toContain('100')
  })

  it('rejects a clip past the duration ceiling regardless of size', () => {
    const result = validateVideoFile({ size: 1024, duration: MAX_VIDEO_SECONDS + 1 })
    expect(result).toMatch(/minutes|minute/i)
    expect(result).toMatch(/trim/i)
  })

  it('treats unreadable duration as pass-through to the size check', () => {
    expect(validateVideoFile({ size: 1024, duration: 0 })).toBeNull()
    expect(validateVideoFile({ size: 1024, duration: NaN })).toBeNull()
  })

  it('exposes exactly five photo slots', () => {
    expect(MAX_POST_IMAGES).toBe(5)
  })
})
