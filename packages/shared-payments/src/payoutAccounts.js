const isValidAccountNumber = (v) => typeof v === 'string' && /^\d{10}$/.test(v)
import { OTP_PURPOSES, checkOtp, sendOtp } from './otp.js'
import { sendSecurityAlert } from './alerts.js'
import { accountCooling, kycTier, readLimitConfig } from './withdrawalLimits.js'

// Saved payout accounts: a bank account an owner (a person on CareFind, a business on CareHub) has saved to be paid into.
// To save one the API requires, in this order (cheapest first, all before any row is written):
//   1. the account resolves at the bank (Paystack); the NAME is the bank's, never typed
//   2. a fresh emailed one-time code (purpose payout_account)  -> else 400 otp_*
// No identity verification is required (H02, owner decision D1a): the bank's own account name is stored and shown, and the
// protection against a hijacked session is the emailed code, the withdrawal PIN and code on every withdrawal, the owner
// alert below, and the cooling-off cap on any destination the owner has not been paid at before (withdrawalLimits.js).
// The database then refuses duplicates and more than 5 active accounts. Withdrawals read the account from the
// database, so a browser can never choose where money goes by sending bank details. -> { status, body }

const MASK = (n) => String(n).slice(-4)

const publicShape = (r, config) => ({
  id: r.id,
  bankCode: r.bank_code,
  bankName: r.bank_name,
  accountLast4: MASK(r.account_number),
  accountName: r.account_name,
  isDefault: r.is_default,
  verifiedAt: r.verified_at,
  // When set, withdrawals to this (new) account are capped until this time.
  coolingEndsAt: accountCooling(r.verified_at, config),
})

export async function listPayoutAccounts(supabase, { ownerType, ownerId, userId }) {
  const { data, error } = await supabase
    .from('payout_accounts')
    .select('id, bank_code, bank_name, account_number, account_name, is_default, verified_at')
    .eq('owner_type', ownerType).eq('owner_id', ownerId).eq('status', 'verified')
    .order('created_at', { ascending: true })
  if (error) return { status: 500, body: { error: 'Could not load your payout accounts' } }
  // `required` tells the UI whether typing in a destination is still allowed (the server enforces it regardless);
  // `limits` lets it show what the person can withdraw (the server enforces these too).
  const config = await readLimitConfig(supabase)
  // H06: identity verification is off unless switched on; then no KYC row is read and no tier figure is shown.
  const tier = config.kycEnabled && ownerType === 'user' && userId ? await kycTier(supabase, userId) : 0
  return {
    status: 200,
    body: {
      accounts: (data || []).map((r) => publicShape(r, config)),
      required: await payoutAccountRequired(supabase),
      kycEnabled: config.kycEnabled,
      limits: {
        tier,
        dailyCapKobo: config.kycEnabled && ownerType === 'user' ? (tier >= 2 ? config.tier2CapKobo : tier === 1 ? config.tier1CapKobo : null) : null,
        nextTierCapKobo: config.kycEnabled && ownerType === 'user' && tier === 1 ? config.tier2CapKobo : null,
        cooloffHours: config.cooloffHours,
        cooloffCapKobo: ownerType === 'business' ? Math.min(config.cooloffCapKobo, config.businessCapKobo) : config.cooloffCapKobo,
      },
    },
  }
}

/** The full details (incl. account number) of one verified account the owner owns - for the withdrawal handlers ONLY. */
export async function getPayoutAccountForWithdrawal(supabase, { ownerType, ownerId, id }) {
  if (!id) return null
  const { data } = await supabase
    .from('payout_accounts')
    .select('id, bank_code, bank_name, account_number, account_name, verified_at')
    .eq('id', id).eq('owner_type', ownerType).eq('owner_id', ownerId).eq('status', 'verified')
    .maybeSingle()
  return data || null
}

/** Is a saved account mandatory for withdrawals right now? (financial_config.payout_account_required) */
export async function payoutAccountRequired(supabase) {
  const { data } = await supabase.from('financial_config').select('value').eq('key', 'payout_account_required').maybeSingle()
  return Number(data?.value) === 1
}

export function sendPayoutAccountOtp({ supabase, user, mailer, ip = null }) {
  return sendOtp({ supabase, user, purpose: OTP_PURPOSES.PAYOUT_ACCOUNT, mailer, ip })
}

/**
 * @param {object} p
 * @param {(a:{bankCode:string,accountNumber:string}) => Promise<{accountName:string}>} p.resolveAccount  throws if it cannot
 * @param {{ nameFor(code:string): Promise<string|null> }} p.banks
 */
export async function addPayoutAccount({ supabase, user, ownerType, ownerId, bankCode, accountNumber, otp, resolveAccount, banks, mailer }) {
  if (!bankCode || !isValidAccountNumber(accountNumber)) {
    return { status: 400, body: { error: 'Choose a bank and enter a valid 10-digit account number.', code: 'invalid_account' } }
  }

  // 1. the account, at the bank
  const bankName = await banks.nameFor(bankCode).catch(() => null)
  if (!bankName) return { status: 400, body: { error: 'Unknown bank.', code: 'unknown_bank' } }
  let resolved
  try {
    resolved = await resolveAccount({ bankCode: String(bankCode), accountNumber })
  } catch (err) {
    const unsupported = /not supported|does not support|unable to resolve|cannot resolve/i.test(err?.paystackMessage || err?.message || '')
    return {
      status: 422,
      body: {
        error: unsupported
          ? 'This bank does not support automatic account verification, so it cannot be saved as a payout account.'
          : 'Could not verify this account. Check the bank and account number.',
        code: unsupported ? 'bank_unsupported' : 'account_not_found',
      },
    }
  }
  if (!resolved?.accountName) return { status: 422, body: { error: 'Could not verify this account. Check the bank and account number.', code: 'account_not_found' } }

  // 2. the inbox (checked last so a rejected account does not burn the code)
  const code = await checkOtp({ supabase, userId: user.id, purpose: OTP_PURPOSES.PAYOUT_ACCOUNT, code: otp })
  if (!code.ok) return { status: code.status, body: { error: code.error, code: code.code } }

  const { data: added, error } = await supabase.rpc('payout_account_add', {
    p_owner_type: ownerType, p_owner_id: ownerId, p_created_by: user.id,
    p_bank_code: String(bankCode), p_bank_name: bankName, p_account_number: accountNumber,
    p_account_name: resolved.accountName, p_score: null,
  })
  if (error) return { status: 500, body: { error: 'Could not save the payout account' } }
  if (added?.outcome === 'duplicate') return { status: 409, body: { error: 'This account is already saved.', code: 'duplicate_account' } }
  if (added?.outcome === 'limit') return { status: 409, body: { error: 'You can save up to 5 payout accounts. Remove one first.', code: 'account_limit' } }
  if (added?.outcome !== 'ok') return { status: 500, body: { error: 'Could not save the payout account' } }

  if (mailer && user.email) await sendSecurityAlert('payout_account_added', () => mailer.sendPayoutAccount({ to: user.email, event: 'added', bankName, accountLast4: MASK(accountNumber) }))
  return { status: 201, body: { ok: true, id: added.id, accountName: resolved.accountName, bankName } }
}

/** Changing the default only changes what the app preselects (a withdrawal always names its account), but it is still
 *  a change to where money is offered to go, so the owner is told. */
export async function setDefaultPayoutAccount({ supabase, user, ownerType, ownerId, id, mailer }) {
  const existing = await getPayoutAccountForWithdrawal(supabase, { ownerType, ownerId, id })
  const { data, error } = await supabase.rpc('payout_account_set_default', { p_owner_type: ownerType, p_owner_id: ownerId, p_id: id })
  if (error) return { status: 500, body: { error: 'Could not update the default account' } }
  if (data !== 'ok') return { status: 404, body: { error: 'Payout account not found' } }
  if (mailer && user?.email && existing) {
    await sendSecurityAlert('payout_account_default', () => mailer.sendPayoutAccount({ to: user.email, event: 'default', bankName: existing.bank_name, accountLast4: MASK(existing.account_number) }))
  }
  return { status: 200, body: { ok: true } }
}

/** Removing an account is a security-relevant change: it needs the withdrawal PIN (checked by the handler) and alerts the owner. */
export async function removePayoutAccount({ supabase, user, ownerType, ownerId, id, mailer }) {
  const existing = await getPayoutAccountForWithdrawal(supabase, { ownerType, ownerId, id })
  const { data, error } = await supabase.rpc('payout_account_disable', { p_owner_type: ownerType, p_owner_id: ownerId, p_id: id })
  if (error) return { status: 500, body: { error: 'Could not remove the payout account' } }
  if (data !== 'ok') return { status: 404, body: { error: 'Payout account not found' } }
  if (mailer && user.email && existing) {
    await sendSecurityAlert('payout_account_removed', () => mailer.sendPayoutAccount({ to: user.email, event: 'removed', bankName: existing.bank_name, accountLast4: MASK(existing.account_number) }))
  }
  return { status: 200, body: { ok: true } }
}
