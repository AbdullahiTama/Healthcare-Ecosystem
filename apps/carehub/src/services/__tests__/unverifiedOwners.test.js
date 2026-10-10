import { describe, it, expect, beforeEach, vi } from 'vitest'

// sbFetch reads the session first; stub it (no session -> anon key) and mock the
// network so the real sbFetch request assembly and error handling are exercised.
vi.mock('../../lib/authClient.js', () => ({
  authClient: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

import { getUnverifiedOwnerBusinessIds, partitionByOwnerVerification, summarizeBulkApproval } from '../supabase.js'

let calls

const answerWith = (status, payload) => {
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, options })
    const text = payload === undefined ? '' : JSON.stringify(payload)
    return { ok: status >= 200 && status < 300, status, text: async () => text }
  })
}

beforeEach(() => {
  calls = []
})

describe('getUnverifiedOwnerBusinessIds', () => {
  it('calls the admin RPC with POST and returns the ids', async () => {
    answerWith(200, ['biz-1', 'biz-2'])
    const ids = await getUnverifiedOwnerBusinessIds()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('rpc/admin_unverified_owner_business_ids')
    expect(calls[0].options.method).toBe('POST')
    expect(ids).toEqual(['biz-1', 'biz-2'])
  })

  it('unwraps an array of single-key objects', async () => {
    answerWith(200, [{ admin_unverified_owner_business_ids: 'biz-1' }, { admin_unverified_owner_business_ids: 'biz-3' }])
    expect(await getUnverifiedOwnerBusinessIds()).toEqual(['biz-1', 'biz-3'])
  })

  it('returns an empty list for an empty response', async () => {
    answerWith(200, undefined)
    expect(await getUnverifiedOwnerBusinessIds()).toEqual([])
  })

  it('re-fetches on every call so a refresh picks up a newly verified owner', async () => {
    answerWith(200, ['biz-1', 'biz-2'])
    expect(await getUnverifiedOwnerBusinessIds()).toEqual(['biz-1', 'biz-2'])
    answerWith(200, ['biz-2'])
    expect(await getUnverifiedOwnerBusinessIds()).toEqual(['biz-2'])
  })

  it('propagates a request failure so the caller can decide how to degrade', async () => {
    answerWith(500, { message: 'boom' })
    await expect(getUnverifiedOwnerBusinessIds()).rejects.toThrow(/500/)
  })
})

describe('partitionByOwnerVerification', () => {
  it('approves everything when the unverified set is empty', () => {
    expect(partitionByOwnerVerification(['a', 'b'], new Set())).toEqual({ approvable: ['a', 'b'], skipped: [] })
  })

  it('skips everything when every id is unverified', () => {
    expect(partitionByOwnerVerification(['a', 'b'], new Set(['a', 'b']))).toEqual({ approvable: [], skipped: ['a', 'b'] })
  })

  it('splits a mix and preserves order', () => {
    expect(partitionByOwnerVerification(['a', 'b', 'c', 'd'], new Set(['b', 'd']))).toEqual({ approvable: ['a', 'c'], skipped: ['b', 'd'] })
  })

  it('ignores unverified ids that are not in the selection', () => {
    expect(partitionByOwnerVerification(['a'], new Set(['x', 'y']))).toEqual({ approvable: ['a'], skipped: [] })
  })

  it('handles an empty selection and a missing set', () => {
    expect(partitionByOwnerVerification([], new Set(['a']))).toEqual({ approvable: [], skipped: [] })
    expect(partitionByOwnerVerification(['a'], undefined)).toEqual({ approvable: ['a'], skipped: [] })
  })
})

describe('summarizeBulkApproval', () => {
  it('reports all approved with no note', () => {
    expect(summarizeBulkApproval([true, true], 0)).toEqual({ approved: 2, skippedUnverified: 0, failed: 0, message: 'Approved 2 businesses — undo?' })
  })

  it('separates approved, unverified (pre-skipped plus refused) and failed', () => {
    const r = summarizeBulkApproval([true, 'unverified', false, true], 1, ['No permission'])
    expect(r).toMatchObject({ approved: 2, skippedUnverified: 2, failed: 1 })
    expect(r.message).toBe('Approved 2 businesses — undo? (Skipped 2: owner has not verified their email; Failed 1: No permission)')
  })

  it('never labels plain failures as unverified', () => {
    const r = summarizeBulkApproval([false, false], 0, ['No permission', 'No permission'])
    expect(r).toEqual({ approved: 0, skippedUnverified: 0, failed: 2, message: 'Failed 2: No permission' })
    expect(r.message).not.toMatch(/verified/)
  })

  it('names the first of several distinct reasons and counts the rest', () => {
    expect(summarizeBulkApproval([false, false, false], 0, ['No permission', 'Failed to fetch', 'No permission']).message)
      .toBe('Failed 3: No permission (+1 more reason)')
    expect(summarizeBulkApproval([false, false, false], 0, ['a', 'b', 'c']).message).toBe('Failed 3: a (+2 more reasons)')
  })

  it('falls back to a generic reason when no message is available', () => {
    const msg = summarizeBulkApproval([false], 0).message
    expect(msg).toBe('Failed 1: the request was refused or could not be completed')
    expect(msg).not.toMatch(/error above/)
    expect(summarizeBulkApproval([false], 0, ['   ', '']).message).toBe(msg)
  })

  it('collapses whitespace and truncates a long reason to 120 characters', () => {
    const long = 'Supabase error (500):\n  ' + 'x'.repeat(300)
    const msg = summarizeBulkApproval([false], 0, [long]).message
    const reason = msg.replace('Failed 1: ', '')
    expect(reason).toHaveLength(120)
    expect(reason.endsWith('…')).toBe(true)
    expect(reason).not.toMatch(/\n/)
  })

  it('shapes the whole sentence for approved + unverified + failed', () => {
    expect(summarizeBulkApproval([true, true, 'unverified', false], 1, ['No permission']).message)
      .toBe('Approved 2 businesses — undo? (Skipped 2: owner has not verified their email; Failed 1: No permission)')
  })

  it('reports pre-skipped only', () => {
    expect(summarizeBulkApproval([], 3)).toEqual({ approved: 0, skippedUnverified: 3, failed: 0, message: 'Skipped 3: owner has not verified their email' })
  })

  it('returns an empty message when nothing happened', () => {
    expect(summarizeBulkApproval([], 0).message).toBe('')
  })
})
