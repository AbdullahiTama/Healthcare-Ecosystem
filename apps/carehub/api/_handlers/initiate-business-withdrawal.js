import { checkWithdrawalPin, verifyBankAccount, settleWithdrawal, getPayoutAccountForWithdrawal, payoutAccountRequired } from '@care-ecosystem/shared-payments'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { createTransferRecipient, initiateTransfer, checkBalance, resolveAccount } from '../_lib/paystackTransfer.js'
import { reconcileBusinessWithdrawal } from '../_lib/withdrawalRecovery.js'
import { emailService } from '../../src/lib/emailService.js'

const MAX_AMOUNT_KOBO = 2_000_000_000 // business_withdrawal_requests.amount is a 32-bit integer

// Business wallet withdrawal (ADR-005), through the withdrawal engine (same architecture as CareFind):
//   1. authorise: the verified OWNER, who must also prove the withdrawal PIN (second factor against a stolen
//      session, audit F-08), and own the wallet being drained (the parent business or one of its branches);
//   2. verify the bank account name BEFORE any money is reserved;
//   3. reserve: ONE atomic database step (balance, 24h cap, ledger entry, request row, reference derived from the
//      request id - the client cannot supply or reuse one). No Paystack call happens while a lock is held;
//   4. send the transfer, link it to the request by id; a failure releases or reconciles the reservation.
// There is no fee: the platform's 20% is already taken at booking settlement, the wallet is the business's net.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, user, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  let { bankCode, bankName, accountNumber, accountName } = req.body || {}
  const { business_id: businessId, amount, pin, payoutAccountId } = req.body || {}
  const amountKobo = Number(amount)

  // A saved, identity-verified payout account (owned by the parent business) decides WHERE the money goes: its
  // details come from the database and any bank details the browser sent are ignored. When the platform requires
  // saved accounts (financial_config.payout_account_required) a typed-in destination is refused.
  if (payoutAccountId) {
    const saved = await getPayoutAccountForWithdrawal(supabase, { ownerType: 'business', ownerId: business.id, id: payoutAccountId })
    if (!saved) return res.status(400).json({ error: 'That payout account is not available. Choose another or add a new one.', code: 'payout_account_not_found' })
    ;({ bank_code: bankCode, bank_name: bankName, account_number: accountNumber, account_name: accountName } = saved)
  } else if (await payoutAccountRequired(supabase)) {
    return res.status(400).json({ error: 'Add and verify a payout account before withdrawing.', code: 'payout_account_required' })
  }
  if (!businessId || !Number.isInteger(amountKobo) || amountKobo <= 0 || amountKobo > MAX_AMOUNT_KOBO
      || !bankCode || !bankName || !/^\d{10}$/.test(String(accountNumber || '')) || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
  }

  // The requested business must be the owner's parent or one of its branches.
  const { data: target } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .or(`id.eq.${business.id},parent_business_id.eq.${business.id}`)
    .maybeSingle()
  if (!target) return res.status(403).json({ error: 'You do not own this business' })

  // Second factor. Nothing below runs without it.
  const pinCheck = await checkWithdrawalPin(supabase, user.id, pin)
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error, code: pinCheck.code, ...(pinCheck.code === 'pin_not_set' ? { needsPin: true } : {}) })
  }

  const account = await verifyBankAccount(resolveAccount, { bankCode, accountNumber, accountName })
  if (!account.ok) return res.status(account.status).json({ error: account.error })

  const { data: created, error: createError } = await supabase.rpc('create_business_withdrawal', {
    p_business_id: businessId,
    p_amount_kobo: amountKobo,
    p_bank_name: bankName,
    p_bank_code: bankCode,
    p_account_number: accountNumber,
    p_account_name: account.accountName,
    p_initiated_by: user.id,
  })
  if (createError || !created) {
    console.error('[initiate-business-withdrawal] create_business_withdrawal failed', createError?.message)
    return res.status(500).json({ error: 'Could not process withdrawal request' })
  }
  if (created.outcome === 'daily_limit') {
    return res.status(429).json({ error: 'daily_limit', message: 'Daily withdrawal limit reached for this business. Try again later or contact support.' })
  }
  if (created.outcome === 'below_minimum') {
    return res.status(400).json({ error: 'below_minimum', message: 'That is below the minimum withdrawal amount.' })
  }
  if (created.outcome !== 'ok') {
    return res.status(400).json({ error: created.outcome === 'insufficient' || created.outcome === 'no_wallet' ? 'insufficient' : 'Could not process withdrawal request' })
  }

  const { id: requestId, reference } = created
  let transferAttempted = false

  // Release the reservation for a request whose transfer was never attempted: nothing can have reached the
  // bank, so no provider check is needed.
  const releaseUnsent = async (detail) => {
    try {
      const r = await settleWithdrawal(supabase, 'carehub', { outcome: 'failed', requestId, detail })
      return r.result === 'refunded' || r.result === 'already_refunded'
    } catch (e) {
      console.error('[initiate-business-withdrawal] release of an unsent withdrawal failed; the reconcile cron will settle it', { reference, message: e.message })
      return false
    }
  }

  try {
    try {
      const available = await checkBalance()
      if (available < amountKobo) {
        await releaseUnsent('provider_balance_low')
        return res.status(503).json({ error: 'Payment provider balance low - try again later', refunded: true })
      }
    } catch (err) {
      const refunded = await releaseUnsent('provider_balance_check_failed')
      return res.status(502).json({ error: 'Could not check payment provider balance', refunded })
    }

    const recipientCode = await createTransferRecipient({ bankCode, accountNumber, accountName: account.accountName, businessId })

    transferAttempted = true
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareHub business withdrawal: NGN ${(amountKobo / 100).toLocaleString()}`,
      reference,
    })

    // Link the provider's codes to THIS request by id. Not fatal if it fails: the webhook and the reconcile cron
    // settle by the reference, which is already on the request.
    try {
      await supabase.rpc('attach_business_withdrawal_transfer', { p_request_id: requestId, p_transfer_code: transferCode, p_recipient_code: recipientCode })
    } catch (e) {
      console.error('[initiate-business-withdrawal] could not record the transfer linkage', { reference, message: e.message })
    }

    try {
      await emailService.enqueue({
        templateKey: 'withdrawal_requested',
        toEmail: business.email,
        payload: { businessName: '', amount: 'Your withdrawal request is being processed', reference, bankName, accountNumber },
        subject: 'CareHub: withdrawal requested',
        idempotencyKey: `withdrawal-requested:${reference}`,
      })
      emailService.processBatch().catch(() => {})
    } catch (err) {
      console.warn('[initiate-business-withdrawal] email enqueue failed:', err.message)
    }

    return res.status(200).json({ success: true, transferCode, reference, amount: amountKobo })
  } catch (err) {
    // Before the transfer call nothing was sent: release the reservation at once.
    if (!transferAttempted) {
      const refunded = await releaseUnsent('recipient_failed')
      return res.status(502).json({
        error: refunded ? `${err.message || 'Payment provider error'}. The amount has been returned to your wallet.` : `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
        refunded,
      })
    }

    // The transfer call itself failed. A definite Paystack refusal is checked immediately; an ambiguous failure
    // (timeout, dropped connection) may still have created the transfer, so it is only refunded once Paystack
    // confirms it did not (the cron waits out the grace period before believing "not found").
    try {
      const row = { id: requestId, paystack_reference: reference, paystack_transfer_code: null, created_at: new Date().toISOString() }
      const recovery = await reconcileBusinessWithdrawal(supabase, row, err.paystackRejected ? { graceMs: 0 } : {})
      if (recovery.outcome === 'refunded') {
        return res.status(502).json({ error: `${err.message || 'Payment provider error'}. The amount has been returned to your wallet.`, refunded: true })
      }
      console.error('[initiate-business-withdrawal] transfer failed; left for reconciliation', { reference, detail: recovery.detail })
    } catch (recoveryErr) {
      console.error('[initiate-business-withdrawal] recovery after failed transfer errored', { reference, message: recoveryErr.message })
    }
    return res.status(502).json({
      error: `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
      pending: true,
    })
  }
}
