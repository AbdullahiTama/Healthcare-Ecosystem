import { describe, it, expect, vi } from 'vitest'
import {
  LIMIT_DEFAULTS, readLimitConfig, coolingOffEndsAt, limitsForWithdrawal, limitsForDestination, hasCompletedWithdrawalTo, isKycEnabled, applyLimits, capInCoins, limitMessage, kycTier,
} from '../withdrawalLimits.js'
import { checkWithdrawalPin, hashPin, randomPinSalt } from '../pin.js'
import { listPayoutAccounts } from '../payoutAccounts.js'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString()

function db({ config = [], kyc = null, accounts = [], pins = [], paid = [], businessPaid = [], failHistory = false } = {}) {
  const table = {
    financial_config: config, kyc_verifications: kyc ? [kyc] : [], payout_accounts: accounts,
    withdrawal_pins: pins, withdrawal_requests: paid, business_withdrawal_requests: businessPaid,
  }
  const query = (rows) => {
    let result = rows
    const q = {
      select: () => q,
      in: (c, vals) => { result = result.filter((r) => vals.includes(r[c])); return q },
      eq: (c, v) => { result = result.filter((r) => r[c] === v); return q },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => (failHistory ? { data: null, error: { message: 'boom' } } : { data: result[0] ?? null }),
      then: (r) => r({ data: result, error: null }),
    }
    return q
  }
  return { from: (t) => query(table[t] || []) }
}

describe('readLimitConfig', () => {
  it('uses the seeded defaults when nothing is configured', async () => {
    expect(await readLimitConfig(db())).toEqual({ tier1CapKobo: 5_000_000, tier2CapKobo: 50_000_000, cooloffHours: 24, cooloffCapKobo: 2_000_000, businessCapKobo: 100_000_000, pinCooloffHours: 24, kycEnabled: false })
  })
  it('reads overrides, and ignores junk rows', async () => {
    const c = await readLimitConfig(db({ config: [
      { key: 'kyc_tier1_daily_cap_kobo', value: '1000000' }, { key: 'payout_account_cooloff_hours', value: 'abc' }, { key: 'kyc_tier2_daily_cap_kobo', value: -5 },
    ] }))
    expect(c.tier1CapKobo).toBe(1_000_000)
    expect(c.cooloffHours).toBe(LIMIT_DEFAULTS.payout_account_cooloff_hours)
    expect(c.tier2CapKobo).toBe(50_000_000)
  })
})

describe('coolingOffEndsAt', () => {
  it('is the end of the window for a new account, null once passed or when disabled', () => {
    expect(coolingOffEndsAt(hoursAgo(1), 24, NOW).getTime()).toBe(NOW + 23 * 3_600_000)
    expect(coolingOffEndsAt(hoursAgo(25), 24, NOW)).toBeNull()
    expect(coolingOffEndsAt(hoursAgo(1), 0, NOW)).toBeNull()
    expect(coolingOffEndsAt(undefined, 24, NOW)).toBeNull()
    expect(coolingOffEndsAt('not a date', 24, NOW)).toBeNull()
  })
})

describe('limitsForWithdrawal', () => {
  const run = (over) => limitsForWithdrawal(db(), { ownerType: 'user', tier: 1, accountVerifiedAt: hoursAgo(100), now: NOW, ...over })

  it('people: tier 1 and tier 2 guarantee their ceilings; tier 0 gets none (the legacy path)', async () => {
    expect((await run({ tier: 1 })).tierCapKobo).toBe(5_000_000)
    expect((await run({ tier: 2 })).tierCapKobo).toBe(50_000_000)
    expect((await run({ tier: 0 })).tierCapKobo).toBeNull()
  })

  it('a new account has a cooling-off cap; an old one does not', async () => {
    const young = await run({ tier: 2, accountVerifiedAt: hoursAgo(2) })
    expect(young.coolingCapKobo).toBe(2_000_000)
    expect(young.coolingEndsAt).toBeInstanceOf(Date)
    expect((await run({ accountVerifiedAt: hoursAgo(100) })).coolingCapKobo).toBeNull()
  })

  it('businesses: no tier ceiling; the cooling-off cap is held under the engine\'s business ceiling', async () => {
    expect((await run({ ownerType: 'business', tier: 2 })).tierCapKobo).toBeNull()
    expect((await run({ ownerType: 'business', accountVerifiedAt: hoursAgo(1) })).coolingCapKobo).toBe(2_000_000)
    const lowEngine = await limitsForWithdrawal(db({ config: [{ key: 'business_withdrawal_daily_cap_kobo', value: 1_000_000 }] }), { ownerType: 'business', tier: 0, accountVerifiedAt: hoursAgo(1), now: NOW })
    expect(lowEngine.coolingCapKobo).toBe(1_000_000)
  })

  it('limitsForDestination looks the tier up for a saved account (people only) when identity verification is switched on', async () => {
    const d = db({ kyc: { user_id: 'u1', tier: 2 }, config: [{ key: 'kyc_enabled', value: 1 }] })
    const dest = { bankCode: '058', accountNumber: '0123456789' }
    const saved = { verified_at: hoursAgo(100) }
    expect((await limitsForDestination(d, { ownerType: 'user', userId: 'u1', destination: dest, saved, now: NOW })).tierCapKobo).toBe(50_000_000)
    expect((await limitsForDestination(d, { ownerType: 'user', userId: 'nobody', destination: dest, saved, now: NOW })).tierCapKobo).toBeNull()
    expect(await kycTier(d, 'u1')).toBe(2)
  })
})

// H02: the cooling-off cap follows the DESTINATION and the PIN age, not only a saved account.
describe('limitsForDestination', () => {
  const DEST = { bankCode: '058', accountNumber: '0123456789' }
  const CAP = 2_000_000
  const user = (db_, over = {}) => limitsForDestination(db_, { ownerType: 'user', userId: 'u1', historyOwnerId: 'u1', destination: DEST, now: NOW, ...over })
  const paidTo = { user_id: 'u1', bank_code: '058', account_number: '0123456789', status: 'completed' }

  it('a typed-in destination never paid before is capped (the saved-account-only bypass is closed)', async () => {
    const l = await user(db())
    expect(l).toMatchObject({ coolingCapKobo: CAP, coolingReason: 'new_destination', coolingEndsAt: null, destinationKnown: false })
  })

  it('a typed-in destination with a completed withdrawal in the owner history is known: no cap', async () => {
    const l = await user(db({ paid: [paidTo] }))
    expect(l).toMatchObject({ coolingCapKobo: null, coolingReason: null, destinationKnown: true })
  })

  it('history of ANOTHER owner, another account number, another bank or a non-completed status does not count', async () => {
    for (const row of [{ ...paidTo, user_id: 'u2' }, { ...paidTo, account_number: '0999999999' }, { ...paidTo, bank_code: '057' }, { ...paidTo, status: 'failed' }]) {
      expect((await user(db({ paid: [row] }))).coolingCapKobo).toBe(CAP)
    }
  })

  it('a saved account inside its window is capped as new_account with an end; past the window it is known', async () => {
    const young = await user(db(), { saved: { verified_at: hoursAgo(2) } })
    expect(young).toMatchObject({ coolingCapKobo: CAP, coolingReason: 'new_account' })
    expect(young.coolingEndsAt.getTime()).toBe(NOW + 22 * 3_600_000)
    expect((await user(db(), { saved: { verified_at: hoursAgo(25) } })).coolingCapKobo).toBeNull()
  })

  it('a saved account still inside its window is known once a withdrawal to it has completed', async () => {
    expect((await user(db({ paid: [paidTo] }), { saved: { verified_at: hoursAgo(2) } })).coolingCapKobo).toBeNull()
  })

  it('a destination the bank could not confirm is always new, even with history or a settled saved account', async () => {
    expect((await user(db({ paid: [paidTo] }), { unverified: true })).coolingReason).toBe('new_destination')
    expect((await user(db(), { saved: { verified_at: hoursAgo(100) }, unverified: true })).coolingCapKobo).toBe(CAP)
  })

  it('after a PIN change every destination is capped until the window ends, known or not', async () => {
    const pins = [{ user_id: 'u1', pin_set_at: hoursAgo(3) }]
    const l = await user(db({ paid: [paidTo], pins }))
    expect(l).toMatchObject({ coolingCapKobo: CAP, coolingReason: 'pin_changed', destinationKnown: true })
    expect(l.coolingEndsAt.getTime()).toBe(NOW + 21 * 3_600_000)
  })

  it('an old PIN, a never-changed PIN (null) and no PIN row do not cap', async () => {
    for (const pins of [[{ user_id: 'u1', pin_set_at: hoursAgo(30) }], [{ user_id: 'u1', pin_set_at: null }], []]) {
      expect((await user(db({ paid: [paidTo], pins }))).coolingCapKobo).toBeNull()
    }
  })

  it('new destination AND recent PIN change: the open-ended rule names the message, the cap is applied once', async () => {
    const l = await user(db({ pins: [{ user_id: 'u1', pin_set_at: hoursAgo(1) }] }))
    expect(l).toMatchObject({ coolingCapKobo: CAP, coolingReason: 'new_destination' })
  })

  it('configuration turns each rule off independently, without a deploy', async () => {
    const pins = [{ user_id: 'u1', pin_set_at: hoursAgo(1) }]
    const noPin = await user(db({ paid: [paidTo], pins, config: [{ key: 'pin_change_cooloff_hours', value: 0 }] }))
    expect(noPin.coolingCapKobo).toBeNull()
    const noDest = await user(db({ config: [{ key: 'payout_account_cooloff_hours', value: 0 }] }))
    expect(noDest.coolingCapKobo).toBeNull()
    const pinStillOn = await user(db({ pins, config: [{ key: 'payout_account_cooloff_hours', value: 0 }] }))
    expect(pinStillOn.coolingReason).toBe('pin_changed')
  })

  it('a history lookup that FAILS counts as unknown: it caps, never uncaps', async () => {
    expect((await user(db({ paid: [paidTo], failHistory: true }))).coolingCapKobo).toBe(CAP)
    expect(await hasCompletedWithdrawalTo(db({ paid: [paidTo], failHistory: true }), { ownerType: 'user', historyOwnerId: 'u1', bankCode: '058', accountNumber: '0123456789' })).toBe(false)
  })

  it('a business: history is the business, the cap sits under the engine ceiling, and the PIN is the owners', async () => {
    const bizPaid = { business_id: 'b1', bank_code: '058', account_number: '0123456789', status: 'completed' }
    const base = { ownerType: 'business', userId: 'u1', historyOwnerId: 'b1', destination: DEST, now: NOW }
    expect((await limitsForDestination(db({ businessPaid: [bizPaid] }), base)).coolingCapKobo).toBeNull()
    expect((await limitsForDestination(db({ businessPaid: [{ ...bizPaid, business_id: 'b2' }] }), base)).coolingCapKobo).toBe(CAP)
    const low = db({ config: [{ key: 'business_withdrawal_daily_cap_kobo', value: 1_000_000 }] })
    expect((await limitsForDestination(low, base)).coolingCapKobo).toBe(1_000_000)
    const pinned = await limitsForDestination(db({ businessPaid: [bizPaid], pins: [{ user_id: 'u1', pin_set_at: hoursAgo(1) }] }), base)
    expect(pinned.coolingReason).toBe('pin_changed')
  })

  it('applyLimits and limitMessage carry the new reasons', async () => {
    const l = await user(db())
    expect(applyLimits({ trustCapCoins: 1000, limits: l, coinValueKobo: 20_000 })).toEqual({ capCoins: 100, reason: 'new_destination' })
    expect(limitMessage({ reason: 'new_destination', capKobo: CAP })).toMatch(/first withdrawal to this bank account.*N20,000/)
    expect(limitMessage({ reason: 'pin_changed', capKobo: CAP, coolingEndsAt: new Date('2026-10-11T00:00:00Z') })).toMatch(/PIN was changed recently.*N20,000.*Oct 2026/)
  })
})

describe('applyLimits: a verified identity LIFTS the trust ladder; a new account lowers it', () => {
  const COIN = 20_000
  const limits = (over) => ({ tierCapKobo: null, coolingCapKobo: null, ...over })

  it('tier 1 (N50,000 = 250 coins) lifts a new user (50), a trusted one (200), but never lowers a veteran (1000)', () => {
    const t1 = limits({ tierCapKobo: 5_000_000 })
    expect(applyLimits({ trustCapCoins: 50, limits: t1, coinValueKobo: COIN })).toEqual({ capCoins: 250, reason: 'kyc_tier' })
    expect(applyLimits({ trustCapCoins: 200, limits: t1, coinValueKobo: COIN })).toEqual({ capCoins: 250, reason: 'kyc_tier' })
    expect(applyLimits({ trustCapCoins: 1000, limits: t1, coinValueKobo: COIN })).toEqual({ capCoins: 1000, reason: null })
  })

  it('tier 2 (N500,000 = 2500 coins) lifts everyone', () => {
    const t2 = limits({ tierCapKobo: 50_000_000 })
    for (const trust of [50, 200, 1000]) expect(applyLimits({ trustCapCoins: trust, limits: t2, coinValueKobo: COIN }).capCoins).toBe(2500)
  })

  it('tier 0 / no limits leave the trust cap exactly as it was', () => {
    expect(applyLimits({ trustCapCoins: 50, limits: limits({}), coinValueKobo: COIN })).toEqual({ capCoins: 50, reason: null })
    expect(applyLimits({ trustCapCoins: 50, limits: null, coinValueKobo: COIN })).toEqual({ capCoins: 50, reason: null })
  })

  it('a new account then LOWERS the lifted cap (N20,000 = 100 coins), whatever the tier or trust', () => {
    const young = limits({ tierCapKobo: 50_000_000, coolingCapKobo: 2_000_000 })
    expect(applyLimits({ trustCapCoins: 1000, limits: young, coinValueKobo: COIN })).toEqual({ capCoins: 100, reason: 'new_account' })
    // an unverified user's cap below the cooling-off cap is not raised by it
    expect(applyLimits({ trustCapCoins: 50, limits: limits({ coolingCapKobo: 2_000_000 }), coinValueKobo: COIN })).toEqual({ capCoins: 50, reason: null })
  })
})

describe('capInCoins / limitMessage', () => {
  it('converts a kobo ceiling to whole coins and never goes negative', () => {
    expect(capInCoins(5_000_000, 20_000)).toBe(250)
    expect(capInCoins(2_050_000, 20_000)).toBe(102)
    expect(capInCoins(100, 20_000)).toBe(0)
    expect(capInCoins(5_000_000, 0)).toBe(0)
  })
  it('explains which limit applied', () => {
    expect(limitMessage({ reason: 'new_account', capKobo: 2_000_000, coolingEndsAt: new Date('2026-10-11T00:00:00Z') })).toMatch(/new, so withdrawals are limited to N20,000.*Oct 2026/)
    expect(limitMessage({ reason: 'kyc_tier', capKobo: 5_000_000, tier: 1 })).toMatch(/N50,000.*selfie/)
    expect(limitMessage({ reason: 'kyc_tier', capKobo: 50_000_000, tier: 2 })).not.toMatch(/selfie/)
  })
})

describe('checkWithdrawalPin onLocked', () => {
  const salt = randomPinSalt()
  const client = (failed) => ({
    rpc: async (name) => {
      if (name === 'get_withdrawal_pin') return { data: [{ pin_hash: hashPin('1234', salt), pin_salt: salt, locked_until: null, failed_attempts: failed }] }
      return { data: false }
    },
  })
  it('fires only on the attempt that locks the PIN (the 5th wrong one), and never changes the answer', async () => {
    const cb = vi.fn()
    expect((await checkWithdrawalPin(client(3), 'u', '9999', { onLocked: cb })).code).toBe('pin_incorrect')
    expect(cb).not.toHaveBeenCalled()
    expect((await checkWithdrawalPin(client(4), 'u', '9999', { onLocked: cb })).code).toBe('pin_incorrect')
    expect(cb).toHaveBeenCalledTimes(1)
    const boom = await checkWithdrawalPin(client(4), 'u', '9999', { onLocked: async () => { throw new Error('mail down') } })
    expect(boom).toMatchObject({ ok: false, status: 403, code: 'pin_incorrect' })
  })
  it('does nothing without a callback, and not on a correct PIN', async () => {
    expect((await checkWithdrawalPin(client(4), 'u', '9999')).ok).toBe(false)
    const cb = vi.fn()
    const ok = { rpc: async (n) => (n === 'get_withdrawal_pin' ? { data: [{ pin_hash: hashPin('1234', salt), pin_salt: salt, locked_until: null, failed_attempts: 4 }] } : { data: true }) }
    expect((await checkWithdrawalPin(ok, 'u', '1234', { onLocked: cb })).ok).toBe(true)
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('listPayoutAccounts exposes what the screen needs to explain limits', () => {
  it('marks a new account as cooling off and returns the person\'s tier ceiling and the next one up', async () => {
    const d = db({
      kyc: { user_id: 'u1', tier: 1 },
      config: [{ key: 'payout_account_required', value: 0 }, { key: 'kyc_enabled', value: 1 }],
      accounts: [
        { id: 'new', owner_type: 'user', owner_id: 'u1', status: 'verified', bank_code: '1', bank_name: 'B', account_number: '0123456789', account_name: 'N', is_default: true, verified_at: new Date(Date.now() - 3_600_000).toISOString() },
        { id: 'old', owner_type: 'user', owner_id: 'u1', status: 'verified', bank_code: '2', bank_name: 'B', account_number: '0123456780', account_name: 'N', is_default: false, verified_at: '2020-01-01T00:00:00Z' },
      ],
    })
    const r = await listPayoutAccounts(d, { ownerType: 'user', ownerId: 'u1', userId: 'u1' })
    expect(r.body.accounts.find((a) => a.id === 'new').coolingEndsAt).toBeTruthy()
    expect(r.body.accounts.find((a) => a.id === 'old').coolingEndsAt).toBeNull()
    expect(r.body.limits).toMatchObject({ tier: 1, dailyCapKobo: 5_000_000, nextTierCapKobo: 50_000_000, cooloffHours: 24, cooloffCapKobo: 2_000_000 })
  })
  it('businesses get no tier numbers', async () => {
    const r = await listPayoutAccounts(db({ accounts: [] }), { ownerType: 'business', ownerId: 'b1', userId: 'u1' })
    expect(r.body.limits).toMatchObject({ tier: 0, dailyCapKobo: null, nextTierCapKobo: null })
  })
})

// H06: with identity verification OFF (the default) no KYC row can touch any money number.
describe('H06: identity verification switched OFF', () => {
  const DEST = { bankCode: '058', accountNumber: '0123456789' }
  const verified = { user_id: 'u1', tier: 2 }
  const old = { verified_at: hoursAgo(100) }

  it('isKycEnabled: only exactly 1 turns it on; a missing row, 0, junk and a failing read are all off', async () => {
    expect(await isKycEnabled(db())).toBe(false)
    expect(await isKycEnabled(db({ config: [{ key: 'kyc_enabled', value: 0 }] }))).toBe(false)
    expect(await isKycEnabled(db({ config: [{ key: 'kyc_enabled', value: 'abc' }] }))).toBe(false)
    expect(await isKycEnabled(db({ config: [{ key: 'kyc_enabled', value: 2 }] }))).toBe(false)
    expect(await isKycEnabled(db({ config: [{ key: 'kyc_enabled', value: 1 }] }))).toBe(true)
    expect(await isKycEnabled({ from: () => { throw new Error('db down') } })).toBe(false)
  })

  it('a verified tier-2 person gets NO ceiling lift and the KYC table is not even read', async () => {
    let read = false
    const base = db({ kyc: verified })
    const spy = { from: (t) => { if (t === 'kyc_verifications') read = true; return base.from(t) } }
    const l = await limitsForDestination(spy, { ownerType: 'user', userId: 'u1', historyOwnerId: 'u1', destination: DEST, saved: old, now: NOW })
    expect(l.tierCapKobo).toBeNull()
    expect(l.tier).toBe(0)
    expect(read).toBe(false)
  })

  it('the same person IS lifted once the switch is on (the behaviour is preserved, not removed)', async () => {
    const l = await limitsForDestination(db({ kyc: verified, config: [{ key: 'kyc_enabled', value: 1 }] }), { ownerType: 'user', userId: 'u1', historyOwnerId: 'u1', destination: DEST, saved: old, now: NOW })
    expect(l.tierCapKobo).toBe(50_000_000)
  })

  it('the cooling-off rules do not depend on the switch', async () => {
    const l = await limitsForDestination(db({ kyc: verified }), { ownerType: 'user', userId: 'u1', historyOwnerId: 'u1', destination: DEST, saved: null, now: NOW })
    expect(l).toMatchObject({ coolingCapKobo: 2_000_000, coolingReason: 'new_destination' })
  })

  it('the account list says KYC is off and shows no tier figures, whatever a KYC row says', async () => {
    const d = db({ kyc: verified, accounts: [{ id: 'a', owner_type: 'user', owner_id: 'u1', status: 'verified', bank_code: '1', bank_name: 'B', account_number: '0123456789', account_name: 'N', is_default: true, verified_at: '2020-01-01T00:00:00Z' }] })
    const r = await listPayoutAccounts(d, { ownerType: 'user', ownerId: 'u1', userId: 'u1' })
    expect(r.body.kycEnabled).toBe(false)
    expect(r.body.limits).toMatchObject({ tier: 0, dailyCapKobo: null, nextTierCapKobo: null })
    expect(r.body.accounts).toHaveLength(1)
  })

  it('the account list says KYC is on when it is', async () => {
    const r = await listPayoutAccounts(db({ config: [{ key: 'kyc_enabled', value: 1 }], accounts: [] }), { ownerType: 'user', ownerId: 'u1', userId: 'u1' })
    expect(r.body.kycEnabled).toBe(true)
  })
})
