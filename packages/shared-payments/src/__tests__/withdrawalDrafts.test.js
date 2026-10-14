import { describe, it, expect, vi, afterEach } from 'vitest'
import { destinationFingerprint, createWithdrawalDraft, getWithdrawalDraft, voidWithdrawalDraft } from '../withdrawalDrafts.js'
describe('withdrawalDrafts helper', () => {
  const OLD_ENV = { ...process.env }
  afterEach(() => { process.env = { ...OLD_ENV } })
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
  it('reads the destination fingerprint back with the live draft (the submit gate compares it)', async () => {
    process.env.OTP_HMAC_SECRET = 'test-secret'
    const select = vi.fn().mockReturnThis()
    const supabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select, eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'd-1', amount: 5, destination_fp: 'saved:acc-1' }, error: null }),
      }),
    }
    const draft = await getWithdrawalDraft(supabase, { userId: 'u-1' })
    expect(select).toHaveBeenCalledWith(expect.stringContaining('destination_fp'))
    expect(draft.destination_fp).toBe('saved:acc-1')
  })
  it('voids the live draft by reason, and throws when the void fails', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }
    await voidWithdrawalDraft(supabase, { userId: 'u-1', reason: 'consumed' })
    expect(supabase.rpc).toHaveBeenCalledWith('void_withdrawal_draft', { p_user_id: 'u-1', p_reason: 'consumed' })
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(voidWithdrawalDraft(supabase, { userId: 'u-1', reason: 'reissue' })).rejects.toThrow('draft void failed')
  })
  it('refuses the service-role key as the draft hashing key in production (mirrors otp.js)', async () => {
    delete process.env.OTP_HMAC_SECRET
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    process.env.NODE_ENV = 'production'
    expect(() => destinationFingerprint({ userId: 'u-1', bankCode: '058', accountNumber: '0123456789' }))
      .toThrow('OTP_HMAC_SECRET must be set in production')
    process.env.OTP_HMAC_SECRET = 'test-secret'
    expect(destinationFingerprint({ userId: 'u-1', bankCode: '058', accountNumber: '0123456789' }).startsWith('typed:')).toBe(true)
  })
  it('throws without any key at all, outside production', async () => {
    delete process.env.OTP_HMAC_SECRET
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => destinationFingerprint({ userId: 'u-1', bankCode: '058', accountNumber: '0123456789' }))
      .toThrow('OTP_HMAC_SECRET')
  })
})
