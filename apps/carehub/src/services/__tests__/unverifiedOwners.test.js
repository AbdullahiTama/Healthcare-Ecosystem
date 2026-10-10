import { describe, it, expect, beforeEach, vi } from 'vitest'

// sbFetch reads the session first; stub it (no session -> anon key) and mock the
// network so the real sbFetch request assembly and error handling are exercised.
vi.mock('../../lib/authClient.js', () => ({
  authClient: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

import { getUnverifiedOwnerBusinessIds, partitionByOwnerVerification } from '../supabase.js'

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
