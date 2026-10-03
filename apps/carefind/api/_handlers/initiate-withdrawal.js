import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'
import { hashPin, verifyPin, isValidPin } from '../_lib/pinCrypto.js'
import { createTransferRecipient, initiateTransfer, checkBalance, normalizeAccountName, resolveAccount, transferReference } from '../_lib/paystackTransfer.js'
import { getRequiredAuth, isInstantEligible, getDailyCap } from '../_lib/trustLevels.js'
import { reconcileWithdrawal } from '../_lib/withdrawalRecovery.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TRANSFER_FEE_RATE = 0.2
const COIN_VALUE_NAIRA = 200

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { amount, bankCode, bankName, accountNumber, accountName, pin } = req.body
  const coins = Number(amount)

  if (!Number.isInteger(coins) || coins < 5 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
  }

  const { data: trustInfo } = await supabase.rpc('get_withdrawal_trust', { p_user_id: user.id })
  const trust = Array.isArray(trustInfo) ? trustInfo[0] : trustInfo
  const trustLevel = trust?.trust_level || 'new'
  const requiredAuth = getRequiredAuth(trustLevel, coins)

  // The PIN is the only second factor. Device trust used to stand in for it, but the client's
  // `deviceToken` was never compared with a stored device, so any non-empty string passed
  // (financial audit F-02). Re-introduce it only with a server-stored, hashed, expiring token.
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

  // Verify wallet has enough balance
  const { data: wallet } = await supabase
    .from('wallets').select('balance').eq('user_id', user.id).maybeSingle()

  if (!wallet || wallet.balance < coins) {
    return res.status(400).json({ error: 'insufficient' })
  }

  const nairaAmount = coins * COIN_VALUE_NAIRA
  const payoutNaira = Math.floor(nairaAmount * (1 - TRANSFER_FEE_RATE))
  const amountKobo = payoutNaira * 100

  // Check Paystack balance before proceeding
  try {
    const available = await checkBalance()
    if (available < amountKobo) {
      console.error("[initiate-withdrawal] Paystack balance insufficient", { available, amountKobo, userId: user.id })
      res.setHeader("Retry-After", "60")
      return res.status(503).json({ error: "Payment provider balance low - try again later" })
    }
  } catch (err) {
    console.error("[initiate-withdrawal] Paystack balance check failed", err)
    return res.status(502).json({ error: "Could not check payment provider balance" })
  }

  // Reuse a previous attempt's reference if a pending request never got its
  // transfer code attached (crash window)  Paystack dedupes by reference, so
  // re-initiating the same transfer can't double-pay.
  const { data: prior } = await supabase
    .from('withdrawal_requests')
    .select('paystack_reference')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .is('paystack_transfer_code', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const reference = prior?.paystack_reference || transferReference(user.id)

  // Tracks how far this request got, so a failure can be recovered correctly: once the
  // wallet is debited and the transfer did not start, the coins must come back.
  let debited = false
  let transferStarted = false

  try {
    // Verify the typed account name actually belongs to the account number.
    // If Paystack reports the bank does not support / cannot resolve the account,
    // allow the manually-entered name (same UX as /api/resolve-account's unsupportedBank branch).
    let resolved
    let verifiedAccountName
    let isUnsupportedBank = false
    try {
      resolved = await resolveAccount({ bankCode, accountNumber })
    } catch (err) {
      const msg = err.paystackMessage || err.message || ''
      isUnsupportedBank = /not supported|does not support|unable to resolve|cannot resolve/i.test(msg)
      if (isUnsupportedBank) {
        verifiedAccountName = String(accountName).trim()
      } else {
        return res.status(400).json({ error: 'Could not verify account details. Check the bank and account number and try again.' })
      }
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

    // Create or reuse Paystack transfer recipient
    const recipientCode = await createTransferRecipient({
      bankCode,
      accountNumber,
      accountName: verifiedAccountName,
      userId: user.id,
    })

    // Deduct coins and record the withdrawal request (atomic via RPC)
    // The reference is stored at creation time so there's never a crash
    // window where a pending request lacks a reference.
    const { data: requestResult, error: requestError } = await supabase.rpc('request_withdrawal', {
      p_user_id: user.id,
      p_amount: coins,
      p_bank_name: bankName,
      p_account_number: accountNumber,
      p_account_name: verifiedAccountName,
      p_reference: reference,
      // Rolling 24h ceiling for this trust tier, checked inside the same locked transaction as the debit.
      p_daily_cap_coins: getDailyCap(trustLevel),
    })

    if (requestResult === 'daily_limit') {
      return res.status(429).json({
        error: 'daily_limit',
        message: `Daily withdrawal limit reached. Your ${trustLevel} level allows up to ${getDailyCap(trustLevel)} CareCoins in any 24 hours.`,
        dailyCapCoins: getDailyCap(trustLevel),
      })
    }

    if (requestError || requestResult !== 'ok') {
      return res.status(400).json({
        error: requestResult === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request',
      })
    }

    debited = true

    // Initiate the Paystack transfer (idempotent by reference)
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareFind withdrawal: ${coins} CareCoins (?${payoutNaira.toLocaleString()})`,
      reference,
    })
    transferStarted = true

    // Attach transfer details by reference (unique), not "latest pending"
    await supabase
      .from('withdrawal_requests')
      .update({
        paystack_transfer_code: transferCode,
        paystack_recipient_code: recipientCode,
      })
      .eq('user_id', user.id)
      .eq('paystack_reference', reference)

    // Trust is recorded when the transfer SETTLES (the transfer.success / transfer.failed webhook,
    // or the reconcile-withdrawals sweep), not here. Paystack has only accepted the request at
    // this point; counting it as a completed withdrawal let transfers that later failed or were
    // reversed build a streak toward the higher-trust, lower-friction tiers.
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
    // No trust update here: a transfer that never started is a provider or system failure, not
    // withdrawal behaviour, and every call to the trust RPC counts as a withdrawal.

    // The wallet was debited but no transfer started: give the coins back, but only when
    // Paystack confirms nothing was created (see withdrawalRecovery.js). An explicit
    // Paystack rejection is checked immediately; an ambiguous failure (timeout, dropped
    // connection) is left pending for the reconcile-withdrawals sweep, which waits out the
    // grace period before believing "not found".
    if (debited && !transferStarted) {
      try {
        const { data: row } = await supabase
          .from('withdrawal_requests')
          .select('id, status, paystack_reference, paystack_transfer_code, created_at')
          .eq('user_id', user.id)
          .eq('paystack_reference', reference)
          .maybeSingle()
        if (row && row.status === 'pending') {
          const recovery = await reconcileWithdrawal(supabase, row, err.paystackRejected ? { graceMs: 0 } : {})
          if (recovery.outcome === 'refunded') {
            return res.status(502).json({ error: `${err.message || 'Payment provider error'}. Your CareCoins have been returned to your wallet.`, refunded: true })
          }
          console.error('[initiate-withdrawal] transfer failed; left pending for reconciliation', { reference, detail: recovery.detail })
        }
      } catch (recoveryErr) {
        console.error('[initiate-withdrawal] recovery after failed transfer errored', { reference, message: recoveryErr.message })
      }
      return res.status(502).json({
        error: `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
        pending: true,
      })
    }
    return res.status(502).json({ error: err.message || 'Payment provider error' })
  }
}