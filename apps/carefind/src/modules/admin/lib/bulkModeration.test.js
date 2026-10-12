import { describe, it, expect, vi } from 'vitest'
import { reportsToResolve, runBulk, summarizeBulk } from './bulkModeration'

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

const ver = { id: 'v1', source: 'verification', title: 'Verification: Amina', target_id: 'u1', raw: { profession: 'Pharmacist' } }
const rep = { id: 'p1', source: 'report', title: 'spam', target_id: 'p1', raw: { id: 'r1', post_id: 'p1', status: 'pending' } }
const post = { id: 'p9', source: 'post', title: 'Flagged post', target_id: 'p9', raw: {} }
const deps = (over = {}) => ({ reports: [{ id: 'r1', post_id: 'p1', status: 'pending' }, { id: 'r2', post_id: 'p1', status: 'pending' }], call: vi.fn().mockResolvedValue({}), audit: vi.fn(), ...over })

describe('runBulk', () => {
  it('approves verifications only and names what it skipped', async () => {
    const d = deps()
    const res = await runBulk('approve_verifications', [ver, rep], d)
    expect(d.call).toHaveBeenCalledWith('approve_verification', { id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    expect(res.done).toBe(1)
    expect(res.skipped).toEqual([{ id: 'p1', title: 'spam', why: 'not a verification' }])
  })

  it('dismisses every pending report on a post by report id', async () => {
    const d = deps()
    const res = await runBulk('dismiss_reports', [rep], d)
    expect(d.call).toHaveBeenCalledWith('resolve_report', { id: 'r1' })
    expect(d.call).toHaveBeenCalledWith('resolve_report', { id: 'r2' })
    expect(d.call).not.toHaveBeenCalledWith('resolve_report', { id: 'p1' })
    expect(res.done).toBe(1)
  })

  it('skips a report with nothing left to dismiss', async () => {
    const res = await runBulk('dismiss_reports', [rep], deps({ reports: [{ id: 'r1', post_id: 'p1', status: 'resolved' }] }))
    expect(res.done).toBe(0)
    expect(res.skipped[0].why).toBe('nothing left to dismiss')
  })

  it('deletes the post behind a report or a flagged post, by post id', async () => {
    const d = deps()
    const res = await runBulk('delete_posts', [rep, post, ver], d)
    expect(d.call).toHaveBeenCalledWith('delete_post', { id: 'p1' })
    expect(d.call).toHaveBeenCalledWith('delete_post', { id: 'p9' })
    expect(res.done).toBe(2)
    expect(res.skipped).toHaveLength(1)
  })

  it('skips a report whose post is gone instead of deleting a null id', async () => {
    const d = deps()
    const gone = { id: 'r9', source: 'report', title: 'abuse', target_id: null, raw: { id: 'r9', post_id: null, status: 'pending', posts: null } }
    const res = await runBulk('delete_posts', [gone], d)
    expect(d.call).not.toHaveBeenCalledWith('delete_post', expect.anything())
    expect(res.done).toBe(0)
    expect(res.skipped).toEqual([{ id: 'r9', title: 'abuse', why: 'no post to delete' }])
  })

  it('records a failed item with its reason and carries on', async () => {
    const d = deps({ call: vi.fn().mockRejectedValueOnce(new Error('Not allowed')).mockResolvedValue({}) })
    const res = await runBulk('reject_verifications', [ver, { ...ver, id: 'v2', title: 'Verification: Bola' }], d)
    expect(res.failed).toEqual([{ id: 'v1', title: 'Verification: Amina', why: 'Not allowed' }])
    expect(res.done).toBe(1)
  })

  it('an audit failure does not fail the item', async () => {
    const d = deps({ audit: vi.fn().mockRejectedValue(new Error('down')) })
    const res = await runBulk('approve_verifications', [ver], d)
    expect(res.done).toBe(1)
    expect(res.failed).toEqual([])
  })
})

describe('summarizeBulk', () => {
  it('is a success when everything worked', () => {
    expect(summarizeBulk({ done: 3, skipped: [], failed: [] }, 'Approved')).toEqual({ message: 'Approved 3', type: 'success' })
  })
  it('names skipped and failed items, failures win the type', () => {
    const out = summarizeBulk({ done: 1, skipped: [{ id: 'a', title: 'A', why: 'not a verification' }], failed: [{ id: 'b', title: 'B', why: 'Not allowed' }] }, 'Approved')
    expect(out.type).toBe('error')
    expect(out.message).toBe('Approved 1. Skipped: A (not a verification). Failed: B (Not allowed)')
  })
  it('names an item with no title as Untitled', () => {
    expect(summarizeBulk({ done: 0, skipped: [{ id: 'r1', title: null, why: 'not a verification' }], failed: [] }, 'Approved').message)
      .toBe('Approved 0. Skipped: Untitled (not a verification)')
  })
  it('is a warning when only skips happened', () => {
    expect(summarizeBulk({ done: 0, skipped: [{ id: 'a', title: 'A', why: 'x' }], failed: [] }, 'Dismissed').type).toBe('warning')
  })
})
