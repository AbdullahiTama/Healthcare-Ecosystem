// Withdrawal limits for money sent to a SAVED payout account. They reach the withdrawal engine as its per-call daily cap
// (create_withdrawal.p_daily_cap_coins / create_business_withdrawal.p_daily_cap_kobo), so the engine enforces them
// atomically under the wallet lock, together with its own balance and cap checks.
//
//   * KYC tier (people, CareFind) - a verified identity LIFTS the trust ladder. Tier 1 (BVN + NIN) and tier 2 (+ selfie)
//     each guarantee a rolling-24h ceiling, and a person gets whichever is HIGHER: the tier ceiling or their own trust
//     cap (a veteran with a long clean history keeps their larger cap). Owner decision 2026-10-10: a verified person
//     sending money to an account proven to be theirs is lower risk than an anonymous new user.
//   * New account cooling-off (people and businesses) - for `cooloffHours` after an account is saved, the owner's rolling
//     24h total is capped at a small amount whatever the tier. This only ever LOWERS the cap, and is applied last. A
//     thief who somehow gets an account saved cannot drain the wallet at once, and the owner has time to see the alert.
// The numbers live in financial_config (so they change without a deploy); the defaults below match the seeded rows.

export const LIMIT_KEYS = {
  tier1: 'kyc_tier1_daily_cap_kobo',
  tier2: 'kyc_tier2_daily_cap_kobo',
  cooloffHours: 'payout_account_cooloff_hours',
  cooloffCap: 'payout_account_cooloff_daily_cap_kobo',
  businessCap: 'business_withdrawal_daily_cap_kobo', // the engine's own business ceiling: a cooling-off cap may only LOWER it
  pinCooloffHours: 'pin_change_cooloff_hours',        // H02: after the PIN is set or reset, the cooling-off cap applies this long
  kycEnabled: 'kyc_enabled',                          // H06: 0 (default, and when the row is missing) = identity verification is OFF
}

export const LIMIT_DEFAULTS = Object.freeze({
  [LIMIT_KEYS.tier1]: 5_000_000,      // N50,000
  [LIMIT_KEYS.tier2]: 50_000_000,     // N500,000
  [LIMIT_KEYS.cooloffHours]: 24,
  [LIMIT_KEYS.cooloffCap]: 2_000_000, // N20,000
  [LIMIT_KEYS.businessCap]: 100_000_000, // N1,000,000 (seeded by the withdrawal engine)
  [LIMIT_KEYS.pinCooloffHours]: 24,
  [LIMIT_KEYS.kycEnabled]: 0,
})

/** Read the limit settings, falling back to the defaults for a missing or non-numeric row. */
export async function readLimitConfig(supabase) {
  const keys = Object.values(LIMIT_KEYS)
  const { data } = await supabase.from('financial_config').select('key, value').in('key', keys)
  const out = { ...LIMIT_DEFAULTS }
  for (const row of data || []) {
    const n = Number(row.value)
    if (keys.includes(row.key) && Number.isFinite(n) && n >= 0) out[row.key] = n
  }
  return {
    tier1CapKobo: out[LIMIT_KEYS.tier1],
    tier2CapKobo: out[LIMIT_KEYS.tier2],
    cooloffHours: out[LIMIT_KEYS.cooloffHours],
    cooloffCapKobo: out[LIMIT_KEYS.cooloffCap],
    businessCapKobo: out[LIMIT_KEYS.businessCap],
    pinCooloffHours: out[LIMIT_KEYS.pinCooloffHours],
    // H06: identity verification is OFF unless the row says exactly 1. Nothing about money may depend on it while it is off.
    kycEnabled: Number(out[LIMIT_KEYS.kycEnabled]) === 1,
  }
}

/** Is identity verification switched on? (financial_config.kyc_enabled = 1). Off by default and when the row is missing. */
export async function isKycEnabled(supabase) {
  try {
    return (await readLimitConfig(supabase)).kycEnabled
  } catch {
    return false
  }
}

/** When does an account stop being "new"? -> Date | null (null when it is no longer new or has no timestamp). */
export function coolingOffEndsAt(verifiedAt, cooloffHours, now = Date.now()) {
  const t = new Date(verifiedAt).getTime()
  if (!Number.isFinite(t) || !(cooloffHours > 0)) return null
  const ends = t + cooloffHours * 3_600_000
  return ends > now ? new Date(ends) : null
}

/**
 * The limits that apply to one withdrawal to a saved account, as separate parts (the caller combines them with its own
 * wallet's cap - see applyLimits for CareFind coins).
 * @param {object} p
 * @param {'user'|'business'} p.ownerType
 * @param {number} p.tier           the person's KYC tier (0-2)
 * @param {string} p.accountVerifiedAt
 * @returns {{ tierCapKobo: number|null, coolingCapKobo: number|null, coolingEndsAt: Date|null, tier: number, config }}
 *   tierCapKobo    the ceiling a verified PERSON is guaranteed (null for tier 0 and for businesses). Lifts, never lowers.
 *   coolingCapKobo the cooling-off cap while the account is new (null once it is not). Lowers, never lifts. For a
 *                  business it is also held under the engine's own business ceiling.
 */
export async function limitsForWithdrawal(supabase, { ownerType, tier, accountVerifiedAt, now = Date.now() }) {
  const config = await readLimitConfig(supabase)
  const coolingEndsAt = coolingOffEndsAt(accountVerifiedAt, config.cooloffHours, now)

  let tierCapKobo = null
  // Business wallets keep their own, higher engine cap; the tier ceilings are for personal CareCoin wallets.
  if (ownerType === 'user') {
    if (tier >= 2) tierCapKobo = config.tier2CapKobo
    else if (tier === 1) tierCapKobo = config.tier1CapKobo
  }
  const coolingCapKobo = coolingEndsAt
    ? (ownerType === 'business' ? Math.min(config.cooloffCapKobo, config.businessCapKobo) : config.cooloffCapKobo)
    : null

  return { tierCapKobo, coolingCapKobo, coolingEndsAt, tier, config }
}

/**
 * CareFind: the daily cap, in coins, to hand to create_withdrawal.
 *   cap = max(trust cap, tier ceiling)   (a verified identity lifts the ladder; it never lowers it)
 *   cap = min(cap, cooling-off cap)      (a new account lowers it; applied last)
 * -> { capCoins, reason: 'new_account'|'kyc_tier'|null }  reason names the rule that set the final number, for messages.
 */
export function applyLimits({ trustCapCoins, limits, coinValueKobo }) {
  let capCoins = trustCapCoins
  let reason = null
  if (limits?.tierCapKobo != null) {
    const tierCoins = capInCoins(limits.tierCapKobo, coinValueKobo)
    if (tierCoins > capCoins) { capCoins = tierCoins; reason = 'kyc_tier' }
  }
  if (limits?.coolingCapKobo != null) {
    const coolCoins = capInCoins(limits.coolingCapKobo, coinValueKobo)
    if (coolCoins < capCoins) { capCoins = coolCoins; reason = limits.coolingReason || 'new_account' }
  }
  return { capCoins, reason }
}

/** Whole coins that fit under a kobo ceiling (a coin is coinValueKobo). Never negative. */
export function capInCoins(capKobo, coinValueKobo) {
  if (!(coinValueKobo > 0)) return 0
  return Math.max(0, Math.floor(capKobo / coinValueKobo))
}

const naira = (kobo) => `N${(kobo / 100).toLocaleString('en-NG')}`

/** What to tell the person when the engine says daily_limit and one of OUR limits was the binding one. */
export function limitMessage({ reason, capKobo, coolingEndsAt, tier }) {
  if (reason === 'new_account') {
    return `This payout account is new, so withdrawals are limited to ${naira(capKobo)} in any 24 hours until ${new Date(coolingEndsAt).toUTCString()}.`
  }
  if (reason === 'new_destination') {
    return `This is the first withdrawal to this bank account, so withdrawals are limited to ${naira(capKobo)} in any 24 hours. Once a withdrawal to it completes the limit no longer applies to it.`
  }
  if (reason === 'pin_changed') {
    return `Your withdrawal PIN was changed recently, so withdrawals are limited to ${naira(capKobo)} in any 24 hours until ${new Date(coolingEndsAt).toUTCString()}.`
  }
  if (reason === 'kyc_tier') {
    return tier >= 2
      ? `Your daily withdrawal limit is ${naira(capKobo)}. Try again later.`
      : `Your daily withdrawal limit is ${naira(capKobo)}. A selfie check raises it.`
  }
  return 'Daily withdrawal limit reached. Try again later.'
}

/** Per-account cooling-off view for the UI. */
export function accountCooling(verifiedAt, config, now = Date.now()) {
  const ends = coolingOffEndsAt(verifiedAt, config.cooloffHours, now)
  return ends ? ends.toISOString() : null
}

/** The tier of a person (0 when never verified). */
export async function kycTier(supabase, userId) {
  const { data } = await supabase.from('kyc_verifications').select('tier').eq('user_id', userId).maybeSingle()
  return Number(data?.tier) || 0
}

/**
 * Has this owner already received a COMPLETED withdrawal at this bank account? A lookup failure counts as "no" (the
 * cooling-off cap then applies: failing toward the cap, never toward uncapped money).
 */
export async function hasCompletedWithdrawalTo(supabase, { ownerType, historyOwnerId, bankCode, accountNumber }) {
  if (!historyOwnerId || !bankCode || !accountNumber) return false
  const business = ownerType === 'business'
  const { data, error } = await supabase
    .from(business ? 'business_withdrawal_requests' : 'withdrawal_requests')
    .select('id')
    .eq(business ? 'business_id' : 'user_id', historyOwnerId)
    .eq('bank_code', String(bankCode))
    .eq('account_number', String(accountNumber).trim())
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle()
  return !error && Boolean(data)
}

/**
 * The limits for ONE withdrawal, whatever the destination (H02). Three independent rules, and the most restrictive wins:
 *   1. the person's KYC tier ceiling - only for a saved account of a person, and only ever LIFTS (kept as it was; H06 decides its fate);
 *   2. a destination the owner has not been paid at before is capped at the cooling-off amount until the first withdrawal
 *      to it completes. That is a SAVED account still inside its cooling-off window, or any typed-in destination, or a
 *      destination the bank could not confirm (`unverified`). A saved account past its window, or any destination with
 *      a completed withdrawal in the owner's history, is "known". payout_account_cooloff_hours = 0 turns this rule off;
 *   3. for pin_change_cooloff_hours after the PIN was set or reset (withdrawal_pins.pin_set_at), the same cap applies
 *      to every destination. 0 turns it off.
 * The cap is the same number for both rules (payout_account_cooloff_daily_cap_kobo), held under the engine's own
 * business ceiling for a business. It reaches the engine as its per-call rolling-24h cap, so it is enforced atomically
 * under the wallet lock. -> { tierCapKobo, coolingCapKobo, coolingEndsAt, coolingReason, destinationKnown, tier, config }
 *   coolingReason: 'new_account' | 'new_destination' | 'pin_changed' | null (the rule that binds longest)
 * @param {object} p
 * @param {'user'|'business'} p.ownerType
 * @param {string} p.userId          the signed-in person (the PIN and KYC belong to them, also for a business)
 * @param {string} [p.historyOwnerId] whose completed withdrawals make a destination known (the user, or the business)
 * @param {{ bankCode: string, accountNumber: string }} p.destination
 * @param {{ verified_at?: string }|null} [p.saved]  the saved account row when one was chosen
 * @param {boolean} [p.unverified]   the bank could not confirm the account name: always treated as new
 */
export async function limitsForDestination(supabase, { ownerType, userId, historyOwnerId, destination, saved = null, unverified = false, now = Date.now() }) {
  // H06: a KYC row is read ONLY when identity verification is switched on; otherwise the tier is 0 and no ceiling is lifted.
  const kycOn = (await readLimitConfig(supabase)).kycEnabled
  const tier = kycOn && ownerType === 'user' && saved ? await kycTier(supabase, userId) : 0
  const base = await limitsForWithdrawal(supabase, { ownerType, tier, accountVerifiedAt: null, now })
  const { config } = base

  const rules = [] // { reason, endsAt: Date|null (null = until the first completed withdrawal) }

  if (config.cooloffHours > 0) {
    const accountEnds = saved && !unverified ? coolingOffEndsAt(saved.verified_at, config.cooloffHours, now) : null
    const savedAndSettled = Boolean(saved) && !unverified && !accountEnds
    let known = savedAndSettled
    if (!known && !unverified) {
      known = await hasCompletedWithdrawalTo(supabase, {
        ownerType, historyOwnerId: historyOwnerId || (ownerType === 'business' ? null : userId),
        bankCode: destination?.bankCode, accountNumber: destination?.accountNumber,
      })
    }
    if (!known) rules.push(saved && accountEnds ? { reason: 'new_account', endsAt: accountEnds } : { reason: 'new_destination', endsAt: null })
  }

  if (config.pinCooloffHours > 0 && userId) {
    const { data } = await supabase.from('withdrawal_pins').select('pin_set_at').eq('user_id', userId).maybeSingle()
    const pinEnds = coolingOffEndsAt(data?.pin_set_at, config.pinCooloffHours, now)
    if (pinEnds) rules.push({ reason: 'pin_changed', endsAt: pinEnds })
  }

  const capKobo = ownerType === 'business' ? Math.min(config.cooloffCapKobo, config.businessCapKobo) : config.cooloffCapKobo
  // The rule that lasts longest names the message; an open-ended one (no end) outlasts any dated one.
  const binding = rules.length === 0 ? null
    : rules.find((r) => r.endsAt === null) || rules.reduce((a, b) => (b.endsAt > a.endsAt ? b : a))

  return {
    tierCapKobo: base.tierCapKobo,
    coolingCapKobo: binding ? capKobo : null,
    coolingEndsAt: binding?.endsAt ?? null,
    coolingReason: binding?.reason ?? null,
    destinationKnown: !rules.some((r) => r.reason !== 'pin_changed'),
    tier,
    config,
  }
}
