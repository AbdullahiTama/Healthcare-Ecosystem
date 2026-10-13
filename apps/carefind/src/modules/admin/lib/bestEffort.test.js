import { describe, it, expect, vi } from 'vitest'
import { bestEffort } from './bestEffort'

describe('bestEffort', () => {
  it('logs a sync throw and does not rethrow', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(bestEffort('x', () => { throw new Error('a') })).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
  it('logs an async rejection and resolves', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(bestEffort('x', () => Promise.reject(new Error('b')))).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
  it('waits for an async follow-up', async () => {
    let done = false
    await bestEffort('x', () => new Promise(r => setTimeout(() => { done = true; r() }, 5)))
    expect(done).toBe(true)
  })
})
