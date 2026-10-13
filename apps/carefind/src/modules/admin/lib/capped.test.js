import { describe, it, expect, vi, afterEach } from 'vitest'
import { capped } from './capped'

afterEach(() => { vi.useRealTimers() })

describe('capped', () => {
  it('resolves with the promise when it settles first, and clears the timer', async () => {
    vi.useFakeTimers()
    await expect(capped(Promise.resolve('done'), 10000)).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('resolves after ms when the promise never settles', async () => {
    vi.useFakeTimers()
    let resolved = false
    capped(new Promise(() => {}), 10000).then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(9999)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
