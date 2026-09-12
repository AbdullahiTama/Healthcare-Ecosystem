import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { hashPin, verifyPin, isValidPin } from '../_lib/pinCrypto.js'
import { createTransferRecipient, initiateTransfer, checkBalance, normalizeAccountName, resolveAccount, transferReference } from '../_lib/paystackTransfer.js'

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
  const coins = parseInt(amount, 10)

  if (!coins || coins < 5 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ error: 'Missing or invalid withdrawal details' })
  }

  // ── Withdrawal PIN gate ─────────────────────────────────────────────────────
  if (!pin) {
    return res.status(400).json({ error: 'Withdrawal PIN is required' })
  }
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
  // ── End PIN gate ───────────────────────────────────────────────────────────

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
      return res.status(503).json({ error: 'Payment provider balance low — try again later' })
    }
  } catch (err) {
    return res.status(502).json({ error: 'Could not check payment provider balance' })
  }

  // Reuse a previous attempt's reference if a pending request never got its
  // transfer code attached (crash window) — Paystack dedupes by reference, so
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

  try {
    // Verify the typed account name actually belongs to the account number.
    let resolved
    try {
      resolved = await resolveAccount({ bankCode, accountNumber })
    } catch (err) {
      return res.status(400).json({ error: 'Could not verify account details. Check the bank and account number and try again.' })
    }
    if (!resolved || !resolved.accountName) {
      return res.status(400).json({ error: 'Could not verify account details. Check the bank and account number and try again.' })
    }
    const submitted = normalizeAccountName(accountName)
    const resolvedName = normalizeAccountName(resolved.accountName)
    if (!submitted || submitted !== resolvedName) {
      return res.status(400).json({ error: 'Account name does not match the account number. Use the name registered with your bank.' })
    }
    const verifiedAccountName = resolved.accountName

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
    })

    if (requestError || requestResult !== 'ok') {
      return res.status(400).json({
        error: requestResult === 'insufficient' ? 'insufficient' : 'Could not process withdrawal request',
      })
    }

    // Initiate the Paystack transfer (idempotent by reference)
    const { transferCode } = await initiateTransfer({
      recipientCode,
      amountKobo,
      reason: `CareFind withdrawal: ${coins} CareCoins (₦${payoutNaira.toLocaleString()})`,
      reference,
    })

    // Attach transfer details by reference (unique), not "latest pending"
    await supabase
      .from('withdrawal_requests')
      .update({
        paystack_transfer_code: transferCode,
        paystack_recipient_code: recipientCode,
      })
      .eq('user_id', user.id)
      .eq('paystack_reference', reference)

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