import { createClient } from '@supabase/supabase-js'
import { verifyUser } from './_lib/verifyUser.js'
import { createTransferRecipient, initiateTransfer, checkBalance, transferReference } from './_lib/paystackTransfer.js'

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

  const { amount, bankCode, bankName, accountNumber, accountName } = req.body
  const coins = parseInt(amount, 10)

  if (!coins || coins < 5 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
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
      return res.status(503).json({ error: 'Payment provider balance low ΓÇö try again later' })
    }
  } catch (err) {
    return res.status(502).json({ error: 'Could not check payment provider balance' })
  }

  const reference = transferReference(user.id)

  try {
    // Create or reuse Paystack transfer recipient
    const recipientCode = await createTransferRecipient({
      bankCode,
      accountNumber,
      accountName,
      userId: user.id,
    })

    // Deduct coins and record the withdrawal request (atomic via RPC)
    const { data: requestResult, error: requestError } = await supabase.rpc('request_withdrawal', {
      p_amount: coins,
      p_bank_name: bankName,
      p_account_number: accountNumber,
      p_account_name: accountName,
    })

    if (requestError || requestResult !== 'ok') {
      return res.status(400).json({
        error: requestResult === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request',
      })
    }

    // Initiate the Paystack transfer
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareFind withdrawal: ${coins} CareCoins (Γéª${payoutNaira.toLocaleString()})`,
      reference,
    })

    // Update the withdrawal request with Paystack reference
    const { data: pendingRequests } = await supabase
      .from('withdrawal_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)

    if (pendingRequests && pendingRequests.length > 0) {
      await supabase
        .from('withdrawal_requests')
        .update({
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
      coins,
      payoutNaira,
    })
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Payment provider error' })
  }
}
