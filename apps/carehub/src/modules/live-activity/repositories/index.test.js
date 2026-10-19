import { describe, it, expect } from 'vitest'
import { createLiveActivityRepository } from './index.js'

const recording = () => {
  const calls = []
  return { calls, repo: createLiveActivityRepository({ request: async (path) => { calls.push(path); return [] } }) }
}

describe('liveActivityRepository.getFieldActivities', () => {
  it('defaults to the newest 100', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1')
    expect(calls[0]).toBe('field_activities?business_id=eq.b1&order=created_at.desc&select=*&limit=100')
  })
  it('pages strictly older than the given timestamp', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1', { limit: 50, before: '2026-10-19T12:00:00+00:00' })
    expect(calls[0]).toBe('field_activities?business_id=eq.b1&created_at=lt.2026-10-19T12%3A00%3A00%2B00%3A00&order=created_at.desc&select=*&limit=50')
  })
})
