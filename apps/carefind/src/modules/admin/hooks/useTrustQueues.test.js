import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { loadTrustQueues, TRUST_CAPS } from './useTrustQueues'

beforeEach(() => callAdminAuth.mockReset())

describe('loadTrustQueues', () => {
  it('settles each source on its own', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_verification_requests') return { data: [{ id: 'v1' }] }
      if (action === 'list_business_claims') throw new Error('boom')
      if (action === 'list_reports') return { data: [] }
    })
    const r = await loadTrustQueues()
    expect(r.verifications).toEqual({ status: 'ok', data: [{ id: 'v1' }] })
    expect(r.claims).toEqual({ status: 'error' })
    expect(r.reports).toEqual({ status: 'ok', data: [] })
  })

  it('treats a response without a list as an error, not an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    const r = await loadTrustQueues()
    expect(r.verifications.status).toBe('error')
  })

  it('exposes the server cap for reports', () => {
    expect(TRUST_CAPS.reports).toBe(30)
  })
})
