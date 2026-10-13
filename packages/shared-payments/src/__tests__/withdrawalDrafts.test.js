import { describe, it, expect, vi } from 'vitest'
import { destinationFingerprint, createWithdrawalDraft, getWithdrawalDraft } from '../withdrawalDrafts.js'
describe('withdrawalDrafts helper', () => {
  it('fingerprints saved accounts plainly and typed ones as keyed HMAC without the raw number', () => {
    process.env.OTP_HMAC_SECRET = 'test-secret'
    expect(destinationFingerprint({ userId: 'u-1', savedId: 'acc-9' })).toBe('saved:acc-9')
    const fp = destinationFingerprint({ userId: 'u-1', bankCode: '058', accountNumber: '0123456789' })
    expect(fp.startsWith('typed:')).toBe(true)
    expect(fp).not.toContain('0123456789')
    expect(fp).toBe(destinationFingerprint({ userId: 'u-1', bankCode: '058', accountNumber: '0123456789' }))
  })
  it('passes the fingerprint through to the RPC and reads back the live draft', async () => {
    process.env.OTP_HMAC_SECRET = 'test-secret'
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: { ok: true, draft_id: 'd-1' }, error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'd-1', amount: 5 }, error: null }),
      }),
    }
    const created = await createWithdrawalDraft(supabase, { userId: 'u-1', app: 'carefind', amount: 5, unit: 'coins', destination: { savedId: 'acc-1' } })
    expect(supabase.rpc).toHaveBeenCalledWith('create_withdrawal_draft', expect.objectContaining({ p_destination_fp: 'saved:acc-1' }))
    expect(created.fingerprint).toBe('saved:acc-1')
    const draft = await getWithdrawalDraft(supabase, { userId: 'u-1' })
    expect(draft).toEqual({ id: 'd-1', amount: 5 })
  })
})
