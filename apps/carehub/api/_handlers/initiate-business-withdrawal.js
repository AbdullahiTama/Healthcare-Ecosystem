import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { createTransferRecipient, initiateTransfer, checkBalance, transferReference } from '../_lib/paystackTransfer.js'
import { reconcileBusinessWithdrawal } from '../_lib/withdrawalRecovery.js'
import { emailService } from '../../src/lib/emailService.js'

// Business wallet withdrawal (ADR-005). Mirrors CareFind's initiate-withdrawal
// flow: bank details are submitted at withdrawal time, request_business_withdrawal
// atomically reserves the AVAILABLE balance and records the request, then the
// Paystack transfer fires immediately. No admin-approval step.
//
// Authorization: the caller must be the owner of the parent business that owns
// the requested business_id (the parent itself or one of its branches), which
// is exactly the scope current_business_ids() gives the owner in CareHub.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { business_id: businessId, amount, bankCode, bankName, accountNumber, accountName } = req.body || {}
  const amountKobo = parseInt(amount, 10)
  if (!businessId || !amountKobo || amountKobo <= 0 || !bankCode || !bankName || !accountNumber || !accountName) {
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

  // Check Paystack balance before proceeding.
  try {
    const available = await checkBalance()
    if (available < amountKobo) {
      return res.status(503).json({ error: 'Payment provider balance low â€” try again later' })
    }
  } catch (err) {
    return res.status(502).json({ error: 'Could not check payment provider balance' })
  }

  // Reuse a previous attempt's reference if a pending/processing request never
  // got its transfer code attached (crash window) â€” Paystack dedupes by reference,
  // so re-initiating the same transfer can't double-pay.
  const { data: prior } = await supabase
    .from('business_withdrawal_requests')
    .select('paystack_reference')
    .eq('business_id', businessId)
    .in('status', ['pending', 'processing'])
    .is('paystack_transfer_code', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const reference = prior?.paystack_reference || transferReference(businessId)

  // Tracks how far this request got, so a failure can be recovered correctly: once the
  // balance is reserved and the transfer did not start, the money must come back.
  let reserved = false
  let transferStarted = false

  try {
    // Create or reuse the Paystack transfer recipient for this business.
    const recipientCode = await createTransferRecipient({
      bankCode,
      accountNumber,
      accountName,
      businessId,
    })

    // Reserve the available balance and record the request (atomic).
    // The reference is stored at creation time so there's never a crash
    // window where a pending request lacks a reference.
    const { data: requestResult, error: requestError } = await supabase.rpc('request_business_withdrawal', {
      p_business_id: businessId,
      p_amount: amountKobo,
      p_bank_name: bankName,
      p_account_number: accountNumber,
      p_account_name: accountName,
      p_reference: reference,
    })

    if (requestError || requestResult !== 'ok') {
      return res.status(400).json({
        error: requestResult === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request',
      })
    }

    reserved = true

    // Initiate the Paystack transfer (idempotent by reference).
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareHub business withdrawal: â‚¦${(amountKobo / 100).toLocaleString()}`,
      reference,
    })

    transferStarted = true

    // Attach transfer details by reference (unique), not "latest pending".
    await supabase
      .from('business_withdrawal_requests')
      .update({
        status: 'processing',
        paystack_transfer_code: transferCode,
        paystack_recipient_code: recipientCode,
      })
      .eq('business_id', businessId)
      .eq('paystack_reference', reference)

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

    return res.status(200).json({
      success: true,
      transferCode,
      reference,
      amount: amountKobo,
    })
  } catch (err) {
    // The balance was reserved but no transfer started: give it back, but only when Paystack
    // confirms nothing was created (see withdrawalRecovery.js). An explicit Paystack rejection
    // is checked immediately; an ambiguous failure (timeout, dropped connection) is left
    // pending for the reconcile-payments cron, which waits out the grace period before
    // believing "not found".
    if (reserved && !transferStarted) {
      try {
        const { data: row } = await supabase
          .from('business_withdrawal_requests')
          .select('id, status, paystack_reference, paystack_transfer_code, created_at')
          .eq('business_id', businessId)
          .eq('paystack_reference', reference)
          .maybeSingle()
        if (row && ['pending', 'processing'].includes(row.status)) {
          const recovery = await reconcileBusinessWithdrawal(supabase, row, err.paystackRejected ? { graceMs: 0 } : {})
          if (recovery.outcome === 'refunded') {
            return res.status(502).json({ error: `${err.message || 'Payment provider error'}. The amount has been returned to your wallet.`, refunded: true })
          }
          console.error('[initiate-business-withdrawal] transfer failed; left pending for reconciliation', { reference, detail: recovery.detail })
        }
      } catch (recoveryErr) {
        console.error('[initiate-business-withdrawal] recovery after failed transfer errored', { reference, message: recoveryErr.message })
      }
      return res.status(502).json({
        error: `${err.message || 'Payment provider error'}. We are checking this withdrawal; your balance will be corrected automatically if it did not go through.`,
        pending: true,
      })
    }
    return res.status(502).json({ error: err.message || 'Payment provider error' })
  }
}
