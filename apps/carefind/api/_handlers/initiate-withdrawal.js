import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'
import { hashPin, verifyPin, isValidPin } from '../_lib/pinCrypto.js'
import { verifyWithdrawalOtp } from '../_lib/emailOtp.js'
import { createTransferRecipient, initiateTransfer, checkBalance, normalizeAccountName, resolveAccount } from '../_lib/paystackTransfer.js'
import { getRequiredAuth, isInstantEligible, getDailyCap } from '../_lib/trustLevels.js'
import { reconcileWithdrawal } from '../_lib/withdrawalRecovery.js'
import { settleWithdrawal } from '@care-ecosystem/shared-payments'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { amount, bankCode, bankName, accountNumber, accountName, pin, otp } = req.body
  const coins = Number(amount)

  if (!Number.isInteger(coins) || coins < 5 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
  }

  const { data: trustInfo } = await supabase.rpc('get_withdrawal_trust', { p_user_id: user.id })
  const trust = Array.isArray(trustInfo) ? trustInfo[0] : trustInfo
  const trustLevel = trust?.trust_level || 'new'
  const requiredAuth = getRequiredAuth(trustLevel, coins)

  // The PIN is the second factor; the email OTP below is the third. Device trust used to stand in
  // for the PIN, but the client's `deviceToken` was never compared with a stored device, so any
  // non-empty string passed (financial audit F-02). Re-introduce it only with a server-stored,
  // hashed, expiring token.
  const hasPin = !!pin

  if (!hasPin) {
    return res.status(400).json({
      error: 'Authentication required',
      trustLevel,
      requiredAuth,
    })
  }

  if (hasPin) {
    if (!isValidPin(pin)) {
      return res.status(400).json({ error: 'Withdrawal PIN must be 4-6 digits' })
    }

    const { data: pinRows, error: pinFetchError } = await supabase.rpc('get_withdrawal_pin', {
      p_user_id: user.id,
    })
    if (pinFetchError) {
      return res.status(500).json({ error: 'Could not verify withdrawal PIN' })
    }
    const storedPin = Array.isArray(pinRows) ? pinRows[0] : undefined
    if (!storedPin || !storedPin.pin_hash) {
      return res.status(400).json({ error: 'Set a withdrawal PIN first' })
    }
    if (storedPin.locked_until && new Date(storedPin.locked_until).getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((new Date(storedPin.locked_until).getTime() - Date.now()) / 60000))
      return res.status(403).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` })
    }

    const attemptHash = hashPin(pin, storedPin.pin_salt)
    const locallyMatches = verifyPin(pin, storedPin.pin_salt, storedPin.pin_hash)
    const { data: pinVerified, error: pinVerifyError } = await supabase.rpc('verify_withdrawal_pin', {
      p_user_id: user.id,
      p_pin_hash: attemptHash,
      p_pin_salt: storedPin.pin_salt,
    })
    if (pinVerifyError || !locallyMatches || pinVerified !== true) {
      return res.status(403).json({ error: 'Incorrect withdrawal PIN.' })
    }
  }

  // Third factor (E): a fresh email OTP, verified LAST - after the PIN and before the account is
  // resolved or any money is reserved. The PIN alone is a static secret a shoulder-surfer can read;
  // the code proves the person is also in control of the account's email.
  const otpCheck = await verifyWithdrawalOtp(supabase, user.id, otp)
  if (otpCheck.error) return res.status(otpCheck.status).json({ error: otpCheck.error })

  // Verify the typed account name actually belongs to the account number BEFORE any money is reserved.
  // If Paystack reports the bank does not support / cannot resolve the account, allow the manually-entered
  // name (same UX as /api/resolve-account's unsupportedBank branch).
  let verifiedAccountName
  try {
    let resolved
    let isUnsupportedBank = false
    try {
      resolved = await resolveAccount({ bankCode, accountNumber })
    } catch (err) {
      const msg = err.paystackMessage || err.message || ''
      isUnsupportedBank = /not supported|does not support|unable to resolve|cannot resolve/i.test(msg)
      if (!isUnsupportedBank) {
        return res.status(400).json({ error: 'Could not verify account details. Check the bank and account number and try again.' })
      }
      verifiedAccountName = String(accountName).trim()
    }
    if (!isUnsupportedBank) {
      if (!resolved || !resolved.accountName) {
        return res.status(400).json({ error: 'Could not verify account details. Check the bank and account number and try again.' })
      }
      const submitted = normalizeAccountName(accountName)
      const resolvedName = normalizeAccountName(resolved.accountName)
      if (!submitted || submitted !== resolvedName) {
        return res.status(400).json({ error: 'Account name does not match the account number. Use the name registered with your bank.' })
      }
      verifiedAccountName = resolved.accountName
    }
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Payment provider error' })
  }

  // Reserve: ONE atomic database step checks the balance and the rolling 24h cap, debits the coins through the
  // ledger, creates the request and derives its Paystack reference from the request id. The amount paid out
  // (after the fee) is computed there from financial_config, not here. No Paystack call happens while any lock
  // is held: the reservation has committed before the first provider call below.
  const { data: created, error: createError } = await supabase.rpc('create_withdrawal', {
    p_user_id: user.id,
    p_coins: coins,
    p_bank_name: bankName,
    p_bank_code: bankCode,
    p_account_number: accountNumber,
    p_account_name: verifiedAccountName,
    p_daily_cap_coins: getDailyCap(trustLevel),
  })

  if (createError || !created) {
    console.error('[initiate-withdrawal] create_withdrawal failed', createError?.message)
    return res.status(500).json({ error: 'Could not process withdrawal request' })
  }
  if (created.outcome === 'daily_limit') {
    return res.status(429).json({
      error: 'daily_limit',
      message: `Daily withdrawal limit reached. Your ${trustLevel} level allows up to ${getDailyCap(trustLevel)} CareCoins in any 24 hours.`,
      dailyCapCoins: getDailyCap(trustLevel),
    })
  }
  if (created.outcome === 'untraceable_credits') {
    // Plan D1: some credits on this wallet do not trace to a confirmed payment. The reservation
    // already refused them; nothing was debited, no provider call happens, and the reconciliation
    // carries the same finding for the finance team.
    console.warn('[initiate-withdrawal] untraceable credits refused reservation', {
      userId: user.id,
      coins,
      withdrawable: created.withdrawable_coins,
      held: created.untraceable_coins,
    })
    try {
      if (user.email) {
        await enqueueOutbox({
          templateKey: 'wallet_needs_attention',
          toEmail: user.email,
          payload: {
            fullName: user.user_metadata?.full_name || user.email,
            heldCoins: String(created.untraceable_coins ?? ''),
            withdrawableCoins: String(created.withdrawable_coins ?? ''),
          },
          subject: 'CareFind: your wallet needs attention',
          idempotencyKey: 'wallet-needs-attention:' + user.id,
        })
        flushOutbox().catch((e) => console.error('[initiate-withdrawal] outbox flush error:', e))
      }
    } catch (e) { console.error('[initiate-withdrawal] email enqueue error:', e) }
    return res.status(403).json({
      error: 'untraceable_credits',
      message: `Part of your balance (${created.untraceable_coins ?? 0} CareCoins) cannot be traced to a confirmed payment and is on hold while we review it. You can withdraw up to ${created.withdrawable_coins ?? 0} CareCoins.`,
      withdrawableCoins: created.withdrawable_coins,
      heldCoins: created.untraceable_coins,
    })
  }
  if (created.outcome !== 'ok') {
    return res.status(400).json({ error: created.outcome === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request' })
  }

  const { id: requestId, reference, payout_kobo: payoutKobo } = created
  const payoutNaira = Number(payoutKobo) / 100
  let transferAttempted = false

  // Give the coins back for a request whose transfer was never attempted: nothing can have reached the bank,
  // so no provider check is needed.
  const releaseUnsent = async (detail) => {
    try {
      const r = await settleWithdrawal(supabase, 'carefind', { outcome: 'failed', requestId, detail })
      return r.result === 'refunded' || r.result === 'already_refunded'
    } catch (e) {
      console.error('[initiate-withdrawal] release of an unsent withdrawal failed; the sweep will settle it', { reference, message: e.message })
      return false
    }
  }

  try {
    // Check Paystack's balance before sending (we know the exact amount only now).
    try {
      const available = await checkBalance()
      if (available < Number(payoutKobo)) {
        console.error('[initiate-withdrawal] Paystack balance insufficient', { available, payoutKobo, userId: user.id })
        await releaseUnsent('provider_balance_low')
        res.setHeader('Retry-After', '60')
        return res.status(503).json({ error: 'Payment provider balance low - try again later', refunded: true })
      }
    } catch (err) {
      console.error('[initiate-withdrawal] Paystack balance check failed', err)
      const refunded = await releaseUnsent('provider_balance_check_failed')
      return res.status(502).json({ error: 'Could not check payment provider balance', refunded })
    }

    const recipientCode = await createTransferRecipient({ bankCode, accountNumber, accountName: verifiedAccountName, userId: user.id })

    transferAttempted = true
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo: Number(payoutKobo),
      reason: `CareFind withdrawal: ${coins} CareCoins (NGN ${payoutNaira.toLocaleString()})`,
      reference,
    })

    // Link the provider's codes to THIS request by its id (never "the latest row"). A failure here is not
    // fatal: the webhook and the sweep both settle by the reference, which is already on the request.
    try {
      await supabase.rpc('attach_withdrawal_transfer', { p_request_id: requestId, p_transfer_code: transferCode, p_recipient_code: recipientCode })
    } catch (e) {
      console.error('[initiate-withdrawal] could not record the transfer linkage', { reference, message: e.message })
    }

    // Trust is recorded when the transfer SETTLES (the transfer.success / transfer.failed webhook, or the
    // reconcile sweep), not here.
    const { data: updatedTrust } = await supabase.rpc('get_withdrawal_trust', { p_user_id: user.id })
    const trustData = Array.isArray(updatedTrust) ? updatedTrust[0] : updatedTrust

    try {
      if (user.email) {
        await enqueueOutbox({
          templateKey: 'withdrawal_requested',
          toEmail: user.email,
          payload: { fullName: user.user_metadata?.full_name || user.email, amount: 'Requested withdrawal', reference, bankName, accountNumber },
          subject: 'CareFind: withdrawal requested',
          idempotencyKey: 'withdrawal-requested:' + reference,
        })
        flushOutbox().catch((e) => console.error('[initiate-withdrawal] outbox flush error:', e))
      }
    } catch (e) { console.error('[initiate-withdrawal] email enqueue error:', e) }

    return res.status(200).json({
      success: true,
      transferCode,
      reference,
      coins,
      payoutNaira,
      trustLevel,
      instantEligible: isInstantEligible(trustLevel, coins),
      nextThreshold: trustData?.instant_threshold || 0,
    })
  } catch (err) {
    // Before the transfer call nothing was sent: release the reservation at once.
    if (!transferAttempted) {
      const refunded = await releaseUnsent('recipient_failed')
      return res.status(502).json({
        error: refunded ? `${err.message || 'Payment provider error'}. Your CareCoins have been returned to your wallet.` : `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
        refunded,
      })
    }

    // The transfer call itself failed. A definite Paystack refusal is checked immediately; an ambiguous failure
    // (timeout, dropped connection) may still have created the transfer, so it is only refunded once Paystack
    // confirms it did not (the sweep waits out the grace period before believing "not found").
    try {
      const row = { id: requestId, paystack_reference: reference, paystack_transfer_code: null, created_at: new Date().toISOString() }
      const recovery = await reconcileWithdrawal(supabase, row, err.paystackRejected ? { graceMs: 0 } : {})
      if (recovery.outcome === 'refunded') {
        return res.status(502).json({ error: `${err.message || 'Payment provider error'}. Your CareCoins have been returned to your wallet.`, refunded: true })
      }
      console.error('[initiate-withdrawal] transfer failed; left for reconciliation', { reference, detail: recovery.detail })
    } catch (recoveryErr) {
      console.error('[initiate-withdrawal] recovery after failed transfer errored', { reference, message: recoveryErr.message })
    }
    return res.status(502).json({
      error: `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
      pending: true,
    })
  }
}
