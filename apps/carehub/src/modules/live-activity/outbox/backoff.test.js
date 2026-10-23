import { describe, it, expect } from 'vitest'
import { backoffMs, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from './backoff'

describe('backoffMs', () => {
  it('doubles from 2 s', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([2000, 4000, 8000, 16000])
  })
  it('is capped at 5 minutes however many attempts have failed', () => {
    expect(backoffMs(20)).toBe(300000)
    expect(backoffMs(1000)).toBe(300000)
    expect(BACKOFF_MAX_MS).toBe(300000)
    expect(BACKOFF_BASE_MS).toBe(2000)
  })
  it('treats a missing, negative or non-numeric attempt count as the first attempt', () => {
    for (const a of [undefined, null, -3, NaN, 'x']) expect(backoffMs(a)).toBe(2000)
  })
})
