const isValidAccountNumber = (v) => typeof v === 'string' && /^\d{10}$/.test(v)
import { OTP_PURPOSES, checkOtp, sendOtp } from './otp.js'
import { matchBusinessName, matchPersonName } from './kyc/nameMatch.js'

// Saved payout accounts: a bank account an owner (a person on CareFind, a business on CareHub) has PROVEN is theirs.
// To save one the API requires, in this order (cheapest and safest first, all before any row is written):
//   1. a verified identity (BVN + NIN)                         -> else 403 kyc_required
//   2. the account resolves at the bank (Paystack); the NAME is the bank's, never typed
//   3. that name matches the verified legal name               -> else 422 name_mismatch
//      (a business may also match its registered business name)
//   4. a fresh emailed one-time code (purpose payout_account)  -> else 400 otp_*
// The database then refuses duplicates and more than 5 active accounts. Withdrawals read the account from the
// database, so a browser can never choose where money goes by sending bank details. -> { status, body }

const MASK = (n) => String(n).slice(-4)

const publicShape = (r) => ({
  id: r.id,
  bankCode: r.bank_code,
  bankName: r.bank_name,
  accountLast4: MASK(r.account_number),
  accountName: r.account_name,
  isDefault: r.is_default,
  verifiedAt: r.verified_at,
})

export async function listPayoutAccounts(supabase, { ownerType, ownerId }) {
  const { data, error } = await supabase
    .from('payout_accounts')
    .select('id, bank_code, bank_name, account_number, account_name, is_default, verified_at')
    .eq('owner_type', ownerType).eq('owner_id', ownerId).eq('status', 'verified')
    .order('created_at', { ascending: true })
  if (error) return { status: 500, body: { error: 'Could not load your payout accounts' } }
  // `required` tells the UI whether typing in a destination is still allowed (the server enforces it regardless).
  return { status: 200, body: { accounts: (data || []).map(publicShape), required: await payoutAccountRequired(supabase) } }
}

/** The full details (incl. account number) of one verified account the owner owns - for the withdrawal handlers ONLY. */
export async function getPayoutAccountForWithdrawal(supabase, { ownerType, ownerId, id }) {
  if (!id) return null
  const { data } = await supabase
    .from('payout_accounts')
    .select('id, bank_code, bank_name, account_number, account_name')
    .eq('id', id).eq('owner_type', ownerType).eq('owner_id', ownerId).eq('status', 'verified')
    .maybeSingle()
  return data || null
}

/** Is a saved account mandatory for withdrawals right now? (financial_config.payout_account_required) */
export async function payoutAccountRequired(supabase) {
  const { data } = await supabase.from('financial_config').select('value').eq('key', 'payout_account_required').maybeSingle()
  return Number(data?.value) === 1
}

export function sendPayoutAccountOtp({ supabase, user, mailer }) {
  return sendOtp({ supabase, user, purpose: OTP_PURPOSES.PAYOUT_ACCOUNT, mailer })
}

/**
 * @param {object} p
 * @param {(a:{bankCode:string,accountNumber:string}) => Promise<{accountName:string}>} p.resolveAccount  throws if it cannot
 * @param {{ nameFor(code:string): Promise<string|null> }} p.banks
 * @param {string} [p.businessName]  CareHub only: the registered name the account may also match
 */
export async function addPayoutAccount({ supabase, user, ownerType, ownerId, bankCode, accountNumber, otp, resolveAccount, banks, businessName, mailer }) {
  if (!bankCode || !isValidAccountNumber(accountNumber)) {
    return { status: 400, body: { error: 'Choose a bank and enter a valid 10-digit account number.', code: 'invalid_account' } }
  }

  // 1. identity
  const { data: kyc, error: kycError } = await supabase
    .from('kyc_verifications')
    .select('tier, legal_first_name, legal_middle_name, legal_last_name')
    .eq('user_id', user.id).maybeSingle()
  if (kycError) return { status: 500, body: { error: 'Could not check your verification' } }
  if (!kyc || kyc.tier < 1) {
    return { status: 403, body: { error: 'Verify your identity (BVN and NIN) before adding a payout account.', code: 'kyc_required' } }
  }

  // 2. the account, at the bank
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

  // 3. the name
  const person = matchPersonName(resolved.accountName, { first: kyc.legal_first_name, middle: kyc.legal_middle_name, last: kyc.legal_last_name })
  const business = ownerType === 'business' && businessName ? matchBusinessName(resolved.accountName, businessName) : { matches: false, score: 0 }
  const match = person.matches ? person : business.matches ? business : null
  if (!match) {
    return {
      status: 422,
      body: {
        error: ownerType === 'business'
          ? 'The account name must match the verified owner or the registered business name.'
          : 'The account name must match the name on your verified BVN.',
        code: 'name_mismatch',
        accountName: resolved.accountName,
      },
    }
  }

  // 4. the inbox (checked last so a rejected account does not burn the code)
  const code = await checkOtp({ supabase, userId: user.id, purpose: OTP_PURPOSES.PAYOUT_ACCOUNT, code: otp })
  if (!code.ok) return { status: code.status, body: { error: code.error, code: code.code } }

  const { data: added, error } = await supabase.rpc('payout_account_add', {
    p_owner_type: ownerType, p_owner_id: ownerId, p_created_by: user.id,
    p_bank_code: String(bankCode), p_bank_name: bankName, p_account_number: accountNumber,
    p_account_name: resolved.accountName, p_score: match.score,
  })
  if (error) return { status: 500, body: { error: 'Could not save the payout account' } }
  if (added?.outcome === 'duplicate') return { status: 409, body: { error: 'This account is already saved.', code: 'duplicate_account' } }
  if (added?.outcome === 'limit') return { status: 409, body: { error: 'You can save up to 5 payout accounts. Remove one first.', code: 'account_limit' } }
  if (added?.outcome !== 'ok') return { status: 500, body: { error: 'Could not save the payout account' } }

  if (mailer && user.email) await mailer.sendPayoutAccount({ to: user.email, event: 'added', bankName, accountLast4: MASK(accountNumber) }).catch(() => {})
  return { status: 201, body: { ok: true, id: added.id, accountName: resolved.accountName, bankName } }
}

export async function setDefaultPayoutAccount({ supabase, ownerType, ownerId, id }) {
  const { data, error } = await supabase.rpc('payout_account_set_default', { p_owner_type: ownerType, p_owner_id: ownerId, p_id: id })
  if (error) return { status: 500, body: { error: 'Could not update the default account' } }
  return data === 'ok' ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'Payout account not found' } }
}

/** Removing an account is a security-relevant change: it needs the withdrawal PIN (checked by the handler) and alerts the owner. */
export async function removePayoutAccount({ supabase, user, ownerType, ownerId, id, mailer }) {
  const existing = await getPayoutAccountForWithdrawal(supabase, { ownerType, ownerId, id })
  const { data, error } = await supabase.rpc('payout_account_disable', { p_owner_type: ownerType, p_owner_id: ownerId, p_id: id })
  if (error) return { status: 500, body: { error: 'Could not remove the payout account' } }
  if (data !== 'ok') return { status: 404, body: { error: 'Payout account not found' } }
  if (mailer && user.email && existing) {
    await mailer.sendPayoutAccount({ to: user.email, event: 'removed', bankName: existing.bank_name, accountLast4: MASK(existing.account_number) }).catch(() => {})
  }
  return { status: 200, body: { ok: true } }
}
