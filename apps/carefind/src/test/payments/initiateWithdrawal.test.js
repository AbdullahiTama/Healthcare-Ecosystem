import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashPin, randomPinSalt } from '../../../api/_lib/pinCrypto.js'

const { mockSupabase, mockVerifyUser, mockPaystack } = vi.hoisted(() => ({
  mockSupabase: {},
  mockVerifyUser: vi.fn(),
  mockPaystack: {
    createTransferRecipient: vi.fn(),
    initiateTransfer: vi.fn(),
    checkBalance: vi.fn(),
    resolveAccount: vi.fn(),
    normalizeAccountName: (n) => (n || '').trim().toLowerCase().replace(/\s+/g, ' '),
    transferReference: (userId) => `cf_wd_${userId.slice(0, 8)}_testref`,
  },
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }))
vi.mock('../../../api/_lib/verifyUser.js', () => ({ verifyUser: mockVerifyUser }))
vi.mock('../../../api/_lib/paystackTransfer.js', () => mockPaystack)

import handler from '../../../api/_handlers/initiate-withdrawal.js'

let pinRow = []
let verifyResult = true

function makeReq(body) {
  return { method: 'POST', url: '/api/initiate-withdrawal', headers: {}, body }
}

function makeRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => { res.body = obj; return res }
  return res
}

const VALID_BODY = {
  amount: '10',
  bankCode: '001',
  bankName: 'Bank A',
  accountNumber: '0123456789',
  accountName: 'Test User',
  pin: '1234',
}

describe('initiate-withdrawal PIN gate', () => {
  beforeEach(() => {
    mockVerifyUser.mockReset()
    mockVerifyUser.mockResolvedValue({ id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' })

    mockSupabase.rpc = vi.fn()
    mockSupabase.from = vi.fn()
    mockSupabase.auth = { getUser: vi.fn() }

    pinRow = []
    verifyResult = true
    mockSupabase.rpc.mockImplementation(async (fn) => {
      if (fn === 'get_withdrawal_pin') return { data: pinRow, error: null }
      if (fn === 'verify_withdrawal_pin') return { data: verifyResult, error: null }
      if (fn === 'request_withdrawal') return { data: 'ok', error: null }
      return { data: null, error: null }
    })

    mockSupabase.from.mockImplementation((table) => {
      const result = table === 'wallets'
        ? Promise.resolve({ data: { balance: 100 }, error: null })
        : table === 'withdrawal_requests'
          ? Promise.resolve({ data: [{ id: 'wr-1' }], error: null })
          : Promise.resolve({ data: null, error: null })
      const chain = Object.assign(result, {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => chain,
        update: () => chain,
        insert: () => chain,
      })
      return chain
    })

    mockPaystack.checkBalance.mockReset().mockResolvedValue(1000000)
    mockPaystack.resolveAccount.mockReset().mockResolvedValue({ accountName: 'Test User', accountNumber: '0123456789' })
    mockPaystack.createTransferRecipient.mockReset().mockResolvedValue('RCP_TEST')
    mockPaystack.initiateTransfer.mockReset().mockImplementation(async ({ reference }) => ({ transferCode: 'TRF_TEST', reference }))
  })

  it('rejects when no PIN is set (get_withdrawal_pin empty) with 400', async () => {
    pinRow = []
    const res = await handler(makeReq(VALID_BODY), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('Set a withdrawal PIN first')
    // The existing flow must NOT run — nothing after the gate executes.
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('request_withdrawal', expect.anything())
    expect(mockPaystack.checkBalance).not.toHaveBeenCalled()
  })

  it('rejects a missing pin with 400', async () => {
    pinRow = [{ pin_hash: 'h'.repeat(128), pin_salt: 's'.repeat(32), failed_attempts: 0, locked_until: null }]
    const res = await handler(makeReq({ ...VALID_BODY, pin: undefined }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('Withdrawal PIN is required')
  })

  it('rejects a malformed pin with 400', async () => {
    const res = await handler(makeReq({ ...VALID_BODY, pin: 'abc' }), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('rejects a wrong pin with 403', async () => {
    const salt = randomPinSalt()
    pinRow = [{ pin_hash: hashPin('1234', salt), pin_salt: salt, failed_attempts: 0, locked_until: null }]
    verifyResult = false
    const res = await handler(makeReq({ ...VALID_BODY, pin: '9999' }), makeRes())
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('Incorrect withdrawal PIN')
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('request_withdrawal', expect.anything())
  })

  it('rejects while the PIN is locked out with 403 and the remaining time', async () => {
    pinRow = [{
      pin_hash: 'h'.repeat(128),
      pin_salt: 's'.repeat(32),
      failed_attempts: 5,
      locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }]
    const res = await handler(makeReq(VALID_BODY), makeRes())
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/Too many failed attempts\. Try again in \d+ minutes?\./)
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('verify_withdrawal_pin', expect.anything())
  })

  it('passes the PIN gate and runs the existing withdrawal flow on a correct pin', async () => {
    const salt = randomPinSalt()
    pinRow = [{ pin_hash: hashPin('1234', salt), pin_salt: salt, failed_attempts: 0, locked_until: null }]
    verifyResult = true

    const res = await handler(makeReq(VALID_BODY), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.transferCode).toBe('TRF_TEST')

    // PIN gate ran first.
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_withdrawal_pin', { p_user_id: 'user-1' })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('verify_withdrawal_pin', {
      p_user_id: 'user-1',
      p_pin_hash: expect.stringMatching(/^[0-9a-f]{128}$/),
      p_pin_salt: salt,
    })

    // The entire pre-existing flow still executes, unchanged.
    expect(mockSupabase.from).toHaveBeenCalledWith('wallets')
    expect(mockPaystack.checkBalance).toHaveBeenCalled()
    expect(mockPaystack.resolveAccount).toHaveBeenCalledWith({ bankCode: '001', accountNumber: '0123456789' })
    expect(mockPaystack.createTransferRecipient).toHaveBeenCalledWith({
      bankCode: '001',
      accountNumber: '0123456789',
      accountName: 'Test User',
      userId: 'user-1',
    })
    expect(mockSupabase.rpc).toHaveBeenCalledWith('request_withdrawal', {
      p_user_id: 'user-1',
      p_amount: 10,
      p_bank_name: 'Bank A',
      p_account_number: '0123456789',
      p_account_name: 'Test User',
    })
    expect(mockPaystack.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      recipientCode: 'RCP_TEST',
      amountKobo: 160000,
    }))
    expect(mockSupabase.from).toHaveBeenCalledWith('withdrawal_requests')
  })

  it('does not include the pin in the request_withdrawal payload', async () => {
    const salt = randomPinSalt()
    pinRow = [{ pin_hash: hashPin('1234', salt), pin_salt: salt, failed_attempts: 0, locked_until: null }]
    verifyResult = true
    await handler(makeReq(VALID_BODY), makeRes())

    const requestCall = mockSupabase.rpc.mock.calls.find(([fn]) => fn === 'request_withdrawal')
    expect(requestCall[1]).not.toHaveProperty('pin')
  })
})