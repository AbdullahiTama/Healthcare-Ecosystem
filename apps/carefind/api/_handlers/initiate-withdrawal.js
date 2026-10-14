import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'
import { createTransferRecipient, initiateTransfer, checkBalance, resolveAccount } from '../_lib/paystackTransfer.js'
import { getRequiredAuth, isInstantEligible, getDailyCap } from '../_lib/trustLevels.js'
import { reconcileWithdrawal } from '../_lib/withdrawalRecovery.js'
import { settleWithdrawal, checkOtp, checkWithdrawalPin, verifyBankAccount, sendSecurityAlert, OTP_PURPOSES, getPayoutAccountForWithdrawal, payoutAccountRequired, limitsForDestination, applyLimits, limitMessage, getWithdrawalDraft, destinationFingerprint, voidWithdrawalDraft } from '@care-ecosystem/shared-payments'
import { getFinancialConfig } from '../_lib/financialConfig.js'
import { getSecurityMailer } from '../_lib/securityMailer.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  let { bankCode, bankName, accountNumber, accountName } = req.body
  const { amount, pin, otp, payoutAccountId } = req.body
  const coins = Number(amount)

  // A saved, identity-verified payout account decides WHERE the money goes: its details come from the database and
  // whatever bank details the browser sent are ignored. When the platform requires saved accounts
  // (financial_config.payout_account_required) a typed-in destination is refused.
  let saved = null
  if (payoutAccountId) {
    saved = await getPayoutAccountForWithdrawal(supabase, { ownerType: 'user', ownerId: user.id, id: payoutAccountId })
    if (!saved) return res.status(400).json({ error: 'That payout account is not available. Choose another or add a new one.', code: 'payout_account_not_found' })
    ;({ bank_code: bankCode, bank_name: bankName, account_number: accountNumber, account_name: accountName } = saved)
  } else if (await payoutAccountRequired(supabase)) {
    return res.status(400).json({ error: 'Add and verify a payout account before withdrawing.', code: 'payout_account_required' })
  }

  if (!Number.isInteger(coins) || coins < 5 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
  }

  const { data: trustInfo } = await supabase.rpc('get_withdrawal_trust', { p_user_id: user.id })
  const trust = Array.isArray(trustInfo) ? trustInfo[0] : trustInfo
  const trustLevel = trust?.trust_level || 'new'
  const requiredAuth = getRequiredAuth(trustLevel, coins)

  // The PIN is the second factor; the email OTP below is the third. The gate is the shared one (CareHub uses the same):
  // format, lockout, constant-time compare, and the owner alert when THIS wrong attempt locks the PIN.
  if (!pin) {
    return res.status(400).json({
      error: 'Authentication required',
      trustLevel,
      requiredAuth,
    })
  }
  const pinCheck = await checkWithdrawalPin(supabase, user.id, pin, {
    onLocked: () => (user.email ? sendSecurityAlert('pin_locked', async () => (await getSecurityMailer()).sendPinLocked({ to: user.email })) : null),
  })
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error, code: pinCheck.code, ...(pinCheck.code === 'pin_not_set' ? { needsPin: true } : {}) })
  }

  // The submit must match the request the code was issued for: a resumed or
  // repurposed form forces a fresh code instead of burning this one (Phase 1).
  // Amount AND destination are compared: a code issued for one payout account
  // must not authorize another. A mismatch keeps the draft (no void).
  {
    const draft = await getWithdrawalDraft(supabase, { userId: user.id }).catch(() => null)
    let fingerprint = null
    try {
      fingerprint = destinationFingerprint({ userId: user.id, savedId: payoutAccountId, bankCode, accountNumber })
    } catch (err) {
      return res.status(503).json({ error: 'Withdrawals are temporarily unavailable. Try again shortly.', code: 'draft_unavailable' })
    }
    if (!draft || Number(draft.amount) !== coins || draft.destination_fp !== fingerprint) {
      return res.status(400).json({ error: 'Your withdrawal details changed — request a fresh code.', code: 'draft_mismatch' })
    }
  }

  // Third factor: a fresh code emailed to the account, checked LAST - after the PIN and before the account is resolved
  // or any money is reserved. The PIN alone is a static secret a shoulder-surfer can read; the code proves the person
  // also controls the account's email. Single use (verify_otp consumes it); 5 wrong tries burn it.
  const otpCheck = await checkOtp({ supabase, userId: user.id, purpose: OTP_PURPOSES.WITHDRAWAL, code: otp })
  if (!otpCheck.ok) return res.status(otpCheck.status).json({ error: otpCheck.error, code: otpCheck.code })
  // The code is consumed: void its draft so the next withdrawal starts clean (best-effort — a void failure must not
  // fail the withdrawal; the draft expires in 10 min anyway).
  await voidWithdrawalDraft(supabase, { userId: user.id, reason: 'consumed' }).catch(() => null)

  // Verify the account name belongs to the account number BEFORE any money is reserved (shared with CareHub). A bank that
  // cannot confirm names is accepted with the typed name, but that destination is then treated as NEW below.
  const account = await verifyBankAccount(resolveAccount, { bankCode, accountNumber, accountName })
  if (!account.ok) return res.status(account.status).json({ error: account.error })
  const verifiedAccountName = account.accountName
  const unverifiedDestination = account.unverified === true
  if (unverifiedDestination) {
    console.warn(JSON.stringify({ event: 'withdrawal.unverified_destination', app: 'carefind', bankCode: String(bankCode) }))
  }

  // Reserve: ONE atomic database step checks the balance and the rolling 24h cap, debits the coins through the
  // ledger, creates the request and derives its Paystack reference from the request id. The amount paid out
  // (after the fee) is computed there from financial_config, not here. No Paystack call happens while any lock
  // is held: the reservation has committed before the first provider call below.
  // Limits for this destination (H02). The trust ladder is the base; a verified identity can LIFT it (saved accounts only,
  // as before); a destination the person has never been paid at, and the day after a PIN change, LOWER it to the
  // cooling-off cap. This applies to a typed-in destination exactly as to a saved one: there is no request shape that
  // avoids it. The result goes to the engine as its own rolling-24h cap, enforced atomically under the wallet lock.
  let dailyCapCoins = getDailyCap(trustLevel)
  let extraLimit = null
  try {
    const limits = await limitsForDestination(supabase, {
      ownerType: 'user', userId: user.id, historyOwnerId: user.id,
      destination: { bankCode, accountNumber }, saved, unverified: unverifiedDestination,
    })
    const coinValueKobo = await getFinancialConfig(supabase, 'coin_value_kobo')
    const applied = applyLimits({ trustCapCoins: dailyCapCoins, limits, coinValueKobo })
    dailyCapCoins = applied.capCoins
    if (applied.reason) extraLimit = { reason: applied.reason, capKobo: applied.capCoins * coinValueKobo, coolingEndsAt: limits.coolingEndsAt, tier: limits.tier }
  } catch (err) {
    // The cap could not be decided. Failing open would let a withdrawal skip the cooling-off rules, so nothing is reserved.
    console.error(JSON.stringify({ event: 'withdrawal.limits_unavailable', app: 'carefind', message: String(err.message).slice(0, 120) }))
    return res.status(503).json({ error: 'Withdrawals are temporarily unavailable. Try again shortly.', code: 'limits_unavailable' })
  }

  const { data: created, error: createError } = await supabase.rpc('create_withdrawal', {
    p_user_id: user.id,
    p_coins: coins,
    p_bank_name: bankName,
    p_bank_code: bankCode,
    p_account_number: accountNumber,
    p_account_name: verifiedAccountName,
    p_daily_cap_coins: dailyCapCoins,
  })

  if (createError || !created) {
    console.error('[initiate-withdrawal] create_withdrawal failed', createError?.message)
    return res.status(500).json({ error: 'Could not process withdrawal request' })
  }
  if (created.outcome === 'daily_limit') {
    return res.status(429).json({
      error: 'daily_limit',
      message: extraLimit
        ? limitMessage(extraLimit)
        : `Daily withdrawal limit reached. Your ${trustLevel} level allows up to ${getDailyCap(trustLevel)} CareCoins in any 24 hours.`,
      dailyCapCoins,
      ...(extraLimit ? { limitReason: extraLimit.reason, coolingEndsAt: extraLimit.coolingEndsAt } : {}),
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

    // Record that a transfer call is about to be made BEFORE making it, and make no call unless that was recorded: from here
    // on "processing" means a call may have created the transfer (a timeout proves nothing), and only a provider-confirmed
    // non-payment may release the coins. If the mark cannot be written nothing was sent, so the reservation is released.
    const marked = await supabase.rpc('mark_withdrawal_transfer_attempt', { p_request_id: requestId })
    if (marked.error || marked.data !== 'ok') {
      const refunded = await releaseUnsent('attempt_not_recorded')
      return res.status(503).json({ error: 'Could not start the transfer. Please try again shortly.', refunded })
    }

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
          payload: {
            fullName: user.user_metadata?.full_name || 'there',
            amount: payoutNaira.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' }),
            coins: String(coins),
            reference,
            bankName,
            accountNumber: `••••${String(accountNumber).slice(-4)}`,
          },
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
      const now = new Date().toISOString()
      const row = { id: requestId, status: 'processing', paystack_reference: reference, paystack_transfer_code: null, created_at: now, updated_at: now }
      // Only a DEFINITE Paystack refusal (the request was understood and declined) is confirmed-not-sent; a timeout is not.
      const recovery = await reconcileWithdrawal(supabase, row, err.paystackRejected ? { graceMs: 0, confirmedNotSent: true } : {})
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
