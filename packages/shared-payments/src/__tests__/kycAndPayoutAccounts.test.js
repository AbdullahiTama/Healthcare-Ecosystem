import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashIdentifier, kycStatus, verifyIdentity, verifySelfie } from '../kyc/identity.js'
import { ProviderError } from '../errors.js'
import {
  listPayoutAccounts, getPayoutAccountForWithdrawal, payoutAccountRequired, addPayoutAccount,
  setDefaultPayoutAccount, removePayoutAccount, sendPayoutAccountOtp,
} from '../payoutAccounts.js'
import { hashOtp } from '../otp.js'

process.env.OTP_HMAC_SECRET = 'test-secret'

// A tiny supabase fake: tables are arrays; .from().select().eq()...maybeSingle()/await; .rpc() is a map of stubs.
function fakeDb({ tables = {}, rpc = {} } = {}) {
  const calls = []
  const query = (rows) => {
    let result = rows
    const q = {
      select: () => q,
      eq: (col, val) => { result = result.filter((r) => r[col] === val); return q },
      order: () => q,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: result, error: null }),
    }
    return q
  }
  return {
    calls,
    from: (t) => query(tables[t] || []),
    rpc: vi.fn(async (name, args) => {
      calls.push([name, args])
      const v = rpc[name]
      return typeof v === 'function' ? v(args) : { data: v ?? null, error: null }
    }),
  }
}

const user = { id: 'u1', email: 'ada@x.com', email_confirmed_at: '2026-01-01' }
const BVN = '22222222222'
const NIN = '11111111111'
const person = { firstName: 'ADA', middleName: 'CHINYERE', lastName: 'OBI', providerRef: 'corr-1' }
const provider = (over = {}) => ({
  lookupBvn: vi.fn(async () => person),
  lookupNin: vi.fn(async () => ({ ...person, providerRef: 'corr-2' })),
  verifySelfie: vi.fn(async () => ({ matched: true, confidence: 98, providerRef: 'corr-3' })),
  ...over,
})

describe('hashIdentifier', () => {
  it('is keyed, domain-separated and never contains the number', () => {
    const h = hashIdentifier('bvn', BVN)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain(BVN)
    expect(hashIdentifier('nin', BVN)).not.toBe(h)
    expect(hashIdentifier('bvn', '22222222223')).not.toBe(h)
    expect(hashIdentifier('bvn', BVN)).toBe(h)
  })
})

describe('verifyIdentity', () => {
  const ok = () => fakeDb({
    rpc: { kyc_begin_attempt: 'ok', kyc_save_verified: 'ok' },
    tables: { kyc_verifications: [{ user_id: 'u1', tier: 1, bvn_last4: '2222', nin_last4: '1111', legal_first_name: 'ADA', legal_middle_name: 'CHINYERE', legal_last_name: 'OBI', verified_at: 'x' }] },
  })

  it('verifies, stores only hashes + last4 + legal name, and returns the status without any hash', async () => {
    const db = ok()
    const r = await verifyIdentity({ supabase: db, provider: provider(), user, bvn: BVN, nin: NIN })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ verified: true, tier: 1, bvnLast4: '2222', ninLast4: '1111', legalName: 'ADA CHINYERE OBI' })
    const saved = db.calls.find(([n]) => n === 'kyc_save_verified')[1]
    expect(saved).toMatchObject({ p_user_id: 'u1', p_first: 'ADA', p_last: 'OBI', p_bvn_last4: '2222', p_nin_last4: '1111' })
    expect(saved.p_bvn_hash).toBe(hashIdentifier('bvn', BVN))
    expect(JSON.stringify(db.calls)).not.toContain(BVN)
    expect(JSON.stringify(db.calls)).not.toContain(NIN)
    expect(JSON.stringify(r.body)).not.toMatch(/hash/i)
  })

  it('rejects malformed numbers (including numbers that are not strings) before any lookup', async () => {
    const db = ok(); const p = provider()
    for (const [bvn, nin] of [['123', NIN], [BVN, 'abc'], [22222222222, NIN], [undefined, undefined]]) {
      expect((await verifyIdentity({ supabase: db, provider: p, user, bvn, nin })).status).toBe(400)
    }
    expect(p.lookupBvn).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('stops at the attempt cap and when already verified, without calling the provider', async () => {
    const p = provider()
    const locked = await verifyIdentity({ supabase: fakeDb({ rpc: { kyc_begin_attempt: 'locked' } }), provider: p, user, bvn: BVN, nin: NIN })
    expect(locked).toMatchObject({ status: 429, body: { code: 'kyc_locked' } })
    const done = await verifyIdentity({ supabase: fakeDb({ rpc: { kyc_begin_attempt: 'already_verified' } }), provider: p, user, bvn: BVN, nin: NIN })
    expect(done.status).toBe(409)
    expect(p.lookupBvn).not.toHaveBeenCalled()
  })

  it('maps provider outcomes: unknown ID -> 422, outage -> 502, and never saves', async () => {
    const db = ok()
    const nf = await verifyIdentity({ supabase: db, provider: provider({ lookupBvn: async () => { throw new ProviderError({ code: 'not_found', message: 'x' }) } }), user, bvn: BVN, nin: NIN })
    expect(nf).toMatchObject({ status: 422, body: { code: 'id_not_found' } })
    const down = await verifyIdentity({ supabase: db, provider: provider({ lookupNin: async () => { throw new ProviderError({ code: 'timeout', message: 'x' }) } }), user, bvn: BVN, nin: NIN })
    expect(down).toMatchObject({ status: 502, body: { code: 'kyc_unavailable' } })
    expect(db.calls.some(([n]) => n === 'kyc_save_verified')).toBe(false)
  })

  it("refuses a BVN and NIN that belong to different people", async () => {
    const db = ok()
    const r = await verifyIdentity({ supabase: db, provider: provider({ lookupNin: async () => ({ firstName: 'TUNDE', middleName: '', lastName: 'BELLO', providerRef: 'x' }) }), user, bvn: BVN, nin: NIN })
    expect(r).toMatchObject({ status: 422, body: { code: 'identity_mismatch' } })
    expect(db.calls.some(([n]) => n === 'kyc_save_verified')).toBe(false)
  })

  it('reports an identity already linked to another account', async () => {
    const db = fakeDb({ rpc: { kyc_begin_attempt: 'ok', kyc_save_verified: 'bvn_in_use' } })
    expect(await verifyIdentity({ supabase: db, provider: provider(), user, bvn: BVN, nin: NIN })).toMatchObject({ status: 409, body: { code: 'id_in_use' } })
  })
})

describe('verifySelfie', () => {
  const verified = () => fakeDb({ tables: { kyc_verifications: [{ user_id: 'u1', tier: 1, bvn_hash: hashIdentifier('bvn', BVN), verified_at: 'x' }] }, rpc: { kyc_save_selfie: 'ok' } })
  it('needs a verified identity, and the same BVN as before', async () => {
    const p = provider()
    expect((await verifySelfie({ supabase: fakeDb(), provider: p, user, bvn: BVN, selfieImage: 'x' })).body.code).toBe('kyc_required')
    expect((await verifySelfie({ supabase: verified(), provider: p, user, bvn: '33333333333', selfieImage: 'x' })).body.code).toBe('id_mismatch')
    expect(p.verifySelfie).not.toHaveBeenCalled()
  })
  it('records tier 2 on a match and refuses a mismatch', async () => {
    const db = verified()
    expect((await verifySelfie({ supabase: db, provider: provider(), user, bvn: BVN, selfieImage: 'img' })).status).toBe(200)
    expect(db.calls.find(([n]) => n === 'kyc_save_selfie')[1]).toMatchObject({ p_user_id: 'u1', p_confidence: 98 })
    const no = await verifySelfie({ supabase: verified(), provider: provider({ verifySelfie: async () => ({ matched: false, confidence: 10 }) }), user, bvn: BVN, selfieImage: 'img' })
    expect(no).toMatchObject({ status: 422, body: { code: 'selfie_mismatch' } })
  })
})

describe('kycStatus', () => {
  it('is unverified for a person with no row', async () => {
    expect((await kycStatus(fakeDb(), 'u1')).body).toMatchObject({ verified: false, tier: 0, legalName: null })
  })
})

// ---------------------------------------------------------------------------------------------------------------------

const KYC_ROW = { user_id: 'u1', tier: 1, legal_first_name: 'ADA', legal_middle_name: 'CHINYERE', legal_last_name: 'OBI' }
const banks = { nameFor: async (c) => ({ '058': 'Guaranty Trust Bank', '999991': 'PalmPay' }[c] || null) }
const mailer = () => ({ sendPayoutAccount: vi.fn(async () => ({ ok: true })), sendOtp: vi.fn(async () => ({ ok: true })) })

describe('addPayoutAccount', () => {
  let db, resolve, m
  beforeEach(() => {
    db = fakeDb({ tables: { kyc_verifications: [KYC_ROW] }, rpc: { verify_otp: 'ok', payout_account_add: { outcome: 'ok', id: 'pa-1' } } })
    resolve = vi.fn(async () => ({ accountName: 'ADA CHINYERE OBI' }))
    m = mailer()
  })
  const add = (over = {}) => addPayoutAccount({ supabase: db, user, ownerType: 'user', ownerId: 'u1', bankCode: '058', accountNumber: '0123456789', otp: '123456', resolveAccount: resolve, banks, mailer: m, ...over })

  it('saves an account whose bank-reported name matches the verified legal name, using the bank name from the directory', async () => {
    const r = await add()
    expect(r.status).toBe(201)
    expect(db.calls.find(([n]) => n === 'payout_account_add')[1]).toMatchObject({
      p_owner_type: 'user', p_owner_id: 'u1', p_created_by: 'u1', p_bank_code: '058', p_bank_name: 'Guaranty Trust Bank',
      p_account_number: '0123456789', p_account_name: 'ADA CHINYERE OBI',
    })
    expect(m.sendPayoutAccount).toHaveBeenCalledWith(expect.objectContaining({ event: 'added', accountLast4: '6789', bankName: 'Guaranty Trust Bank' }))
  })

  it('refuses without a verified identity, before resolving or spending the code', async () => {
    db = fakeDb({ tables: { kyc_verifications: [{ ...KYC_ROW, tier: 0 }] }, rpc: { verify_otp: 'ok' } })
    const r = await add()
    expect(r).toMatchObject({ status: 403, body: { code: 'kyc_required' } })
    expect(resolve).not.toHaveBeenCalled()
    expect(db.calls.some(([n]) => n === 'verify_otp')).toBe(false)
  })

  it("refuses someone else's account (name mismatch), tells them the bank's name, and does NOT burn the code", async () => {
    resolve.mockResolvedValue({ accountName: 'TUNDE BELLO' })
    const r = await add()
    expect(r).toMatchObject({ status: 422, body: { code: 'name_mismatch', accountName: 'TUNDE BELLO' } })
    expect(db.calls.some(([n]) => n === 'verify_otp' || n === 'payout_account_add')).toBe(false)
  })

  it('a wrong or missing code saves nothing', async () => {
    db = fakeDb({ tables: { kyc_verifications: [KYC_ROW] }, rpc: { verify_otp: 'invalid' } })
    expect(await add()).toMatchObject({ status: 400, body: { code: 'otp_invalid' } })
    expect((await add({ otp: undefined })).status).toBe(400)
    expect(db.calls.some(([n]) => n === 'payout_account_add')).toBe(false)
  })

  it('unknown bank, bad number, unresolvable and unsupported banks are refused cleanly', async () => {
    expect((await add({ bankCode: '000' })).body.code).toBe('unknown_bank')
    expect((await add({ accountNumber: '123' })).body.code).toBe('invalid_account')
    resolve.mockRejectedValue(Object.assign(new Error('x'), { paystackMessage: 'Could not resolve account name' }))
    expect((await add()).body.code).toBe('account_not_found')
    resolve.mockRejectedValue(Object.assign(new Error('x'), { paystackMessage: 'bank does not support resolving' }))
    expect((await add()).body.code).toBe('bank_unsupported')
  })

  it('a business account may match the verified owner OR the registered business name', async () => {
    resolve.mockResolvedValue({ accountName: 'GRACE PHARMACY LIMITED' })
    expect((await add({ ownerType: 'business', ownerId: 'biz-1', businessName: 'Grace Pharmacy' })).status).toBe(201)
    expect((await add({ ownerType: 'business', ownerId: 'biz-1', businessName: 'Mercy Pharmacy' })).body.code).toBe('name_mismatch')
    expect((await add({ ownerType: 'user', ownerId: 'u1', businessName: 'Grace Pharmacy' })).body.code).toBe('name_mismatch') // CareFind users never use the business rule
    resolve.mockResolvedValue({ accountName: 'ADA OBI' })
    expect((await add({ ownerType: 'business', ownerId: 'biz-1', businessName: 'Grace Pharmacy' })).status).toBe(201) // the verified owner's own account
  })

  it('maps duplicate and limit outcomes from the database', async () => {
    db = fakeDb({ tables: { kyc_verifications: [KYC_ROW] }, rpc: { verify_otp: 'ok', payout_account_add: { outcome: 'duplicate' } } })
    expect((await add()).body.code).toBe('duplicate_account')
    db = fakeDb({ tables: { kyc_verifications: [KYC_ROW] }, rpc: { verify_otp: 'ok', payout_account_add: { outcome: 'limit' } } })
    expect((await add()).body.code).toBe('account_limit')
  })

  it('the code is bound to the payout_account purpose', async () => {
    await add()
    expect(db.calls.find(([n]) => n === 'verify_otp')[1].p_code_hash).toBe(hashOtp('123456', 'u1', 'payout_account'))
  })
})

describe('listing, lookup and management', () => {
  const rows = [
    { id: 'a1', owner_type: 'user', owner_id: 'u1', status: 'verified', bank_code: '058', bank_name: 'GTBank', account_number: '0123456789', account_name: 'ADA OBI', is_default: true, verified_at: 't' },
    { id: 'a2', owner_type: 'user', owner_id: 'u2', status: 'verified', bank_code: '057', bank_name: 'Zenith', account_number: '0999999999', account_name: 'OTHER', is_default: true, verified_at: 't' },
    { id: 'a3', owner_type: 'user', owner_id: 'u1', status: 'disabled', bank_code: '033', bank_name: 'UBA', account_number: '0111111111', account_name: 'ADA OBI', is_default: false, verified_at: 't' },
  ]
  const db = () => fakeDb({ tables: { payout_accounts: rows, financial_config: [{ key: 'payout_account_required', value: 1 }] }, rpc: { payout_account_set_default: 'ok', payout_account_disable: 'ok' } })

  it('lists only the owner’s active accounts, masked: the full number never reaches the client', async () => {
    const r = await listPayoutAccounts(db(), { ownerType: 'user', ownerId: 'u1' })
    expect(r.body.required).toBe(true)
    expect(r.body.accounts).toEqual([{ id: 'a1', bankCode: '058', bankName: 'GTBank', accountLast4: '6789', accountName: 'ADA OBI', isDefault: true, verifiedAt: 't' }])
    expect(JSON.stringify(r.body)).not.toContain('0123456789')
  })

  it('withdrawal lookup returns full details only for an active account the owner owns', async () => {
    const d = db()
    expect(await getPayoutAccountForWithdrawal(d, { ownerType: 'user', ownerId: 'u1', id: 'a1' })).toMatchObject({ account_number: '0123456789' })
    expect(await getPayoutAccountForWithdrawal(d, { ownerType: 'user', ownerId: 'u1', id: 'a2' })).toBeNull() // someone else's
    expect(await getPayoutAccountForWithdrawal(d, { ownerType: 'user', ownerId: 'u1', id: 'a3' })).toBeNull() // disabled
    expect(await getPayoutAccountForWithdrawal(d, { ownerType: 'business', ownerId: 'u1', id: 'a1' })).toBeNull() // wrong owner type
    expect(await getPayoutAccountForWithdrawal(d, { ownerType: 'user', ownerId: 'u1', id: undefined })).toBeNull()
  })

  it('reads the requirement flag from financial_config', async () => {
    expect(await payoutAccountRequired(db())).toBe(true)
    expect(await payoutAccountRequired(fakeDb({ tables: { financial_config: [{ key: 'payout_account_required', value: 0 }] } }))).toBe(false)
    expect(await payoutAccountRequired(fakeDb())).toBe(false)
  })

  it('set-default and remove report not-found; removing alerts the owner with the last four digits only', async () => {
    const m = mailer()
    expect((await setDefaultPayoutAccount({ supabase: db(), ownerType: 'user', ownerId: 'u1', id: 'a1' })).status).toBe(200)
    expect((await setDefaultPayoutAccount({ supabase: fakeDb({ rpc: { payout_account_set_default: 'not_found' } }), ownerType: 'user', ownerId: 'u1', id: 'x' })).status).toBe(404)
    expect((await removePayoutAccount({ supabase: db(), user, ownerType: 'user', ownerId: 'u1', id: 'a1', mailer: m })).status).toBe(200)
    expect(m.sendPayoutAccount).toHaveBeenCalledWith({ to: 'ada@x.com', event: 'removed', bankName: 'GTBank', accountLast4: '6789' })
    expect((await removePayoutAccount({ supabase: fakeDb({ rpc: { payout_account_disable: 'not_found' } }), user, ownerType: 'user', ownerId: 'u1', id: 'x', mailer: m })).status).toBe(404)
  })

  it('the account code uses the payout_account purpose', async () => {
    const d = fakeDb({ rpc: { issue_otp: 'ok' } })
    const m = mailer()
    await sendPayoutAccountOtp({ supabase: d, user, mailer: m })
    expect(d.calls[0][1].p_purpose).toBe('payout_account')
    expect(m.sendOtp).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'payout_account' }))
  })
})
