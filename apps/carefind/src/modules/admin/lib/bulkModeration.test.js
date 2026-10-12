import { describe, it, expect } from 'vitest'
import { reportsToResolve } from './bulkModeration'

const item = (over = {}) => ({ id: 'p1', source: 'report', target_id: 'p1', raw: { id: 'r1', post_id: 'p1', status: 'pending' }, ...over })

describe('reportsToResolve', () => {
  it('returns every pending report on the same post, by report id', () => {
    const reports = [
      { id: 'r1', post_id: 'p1', status: 'pending' },
      { id: 'r2', post_id: 'p1', status: 'pending' },
      { id: 'r3', post_id: 'p1', status: 'resolved' },
      { id: 'r4', post_id: 'p2', status: 'pending' },
    ]
    expect(reportsToResolve(item(), reports).map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('never returns the post id as a report id', () => {
    const reports = [{ id: 'r1', post_id: 'p1', status: 'pending' }]
    expect(reportsToResolve(item(), reports).map(r => r.id)).not.toContain('p1')
  })

  it('returns nothing when every report on the post is already resolved', () => {
    expect(reportsToResolve(item(), [{ id: 'r1', post_id: 'p1', status: 'resolved' }])).toEqual([])
  })

  it('falls back to the item\'s own report when it has no post id', () => {
    const noPost = item({ id: 'r9', target_id: null, raw: { id: 'r9', post_id: null, status: 'pending' } })
    expect(reportsToResolve(noPost, []).map(r => r.id)).toEqual(['r9'])
  })
})
