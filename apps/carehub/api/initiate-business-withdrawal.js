import { createClient } from '@supabase/supabase-js'
import { verifyBusiness } from './_lib/verifyBusiness.js'
import { createTransferRecipient, initiateTransfer, checkBalance, transferReference } from './_lib/paystackTransfer.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

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
      return res.status(503).json({ error: 'Payment provider balance low — try again later' })
    }
  } catch (err) {
    return res.status(502).json({ error: 'Could not check payment provider balance' })
  }

  const reference = transferReference(businessId)

  try {
    // Create or reuse the Paystack transfer recipient for this business.
    const recipientCode = await createTransferRecipient({
      bankCode,
      accountNumber,
      accountName,
      businessId,
    })

    // Reserve the available balance and record the request (atomic).
    const { data: requestResult, error: requestError } = await supabase.rpc('request_business_withdrawal', {
      p_business_id: businessId,
      p_amount: amountKobo,
      p_bank_name: bankName,
      p_account_number: accountNumber,
      p_account_name: accountName,
    })

    if (requestError || requestResult !== 'ok') {
      return res.status(400).json({
        error: requestResult === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request',
      })
    }

    // Initiate the Paystack transfer.
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareHub business withdrawal: ₦${(amountKobo / 100).toLocaleString()}`,
      reference,
    })

    // Attach the Paystack details to the pending request we just created.
    const { data: pendingRequests } = await supabase
      .from('business_withdrawal_requests')
      .select('id')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)

    if (pendingRequests && pendingRequests.length > 0) {
      await supabase
        .from('business_withdrawal_requests')
        .update({
          status: 'processing',
          paystack_reference: reference,
          paystack_transfer_code: transferCode,
          paystack_recipient_code: recipientCode,
        })
        .eq('id', pendingRequests[0].id)
    }

    return res.status(200).json({
      success: true,
      transferCode,
      reference,
      amount: amountKobo,
    })
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Payment provider error' })
  }
}
