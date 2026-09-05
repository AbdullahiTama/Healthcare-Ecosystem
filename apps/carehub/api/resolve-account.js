import { resolveAccount } from './_lib/paystackTransfer.js'

// POST /api/resolve-account
// Resolves a bank account name from bank code + account number via Paystack.
// Used by the withdrawal form to auto-populate the account name field.
export default async function resolveAccountHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { bankCode, accountNumber } = req.body || {}

  if (!bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Bank code and account number are required' })
  }

  const acct = String(accountNumber).trim()
  if (!/^\d{10}$/.test(acct)) {
    return res.status(400).json({ error: 'Account number must be exactly 10 digits' })
  }

  try {
    const result = await resolveAccount({ bankCode: String(bankCode).trim(), accountNumber: acct })
    return res.status(200).json({ accountName: result.accountName })
  } catch (err) {
    const paystackMsg = err.paystackMessage || err.message || String(err)
    console.error('[resolve-account] Failed:', {
      paystackMessage: paystackMsg,
      bankCode,
      accountNumber: acct,
      error: err.message,
    })
    
    const isUnsupportedBank = /not supported|does not support|unable to resolve|cannot resolve/i.test(paystackMsg)
    const isAccountNotFound = /not found|does not exist|invalid account/i.test(paystackMsg)
    
    let userMessage = 'Could not verify account. Check that the bank and account number are correct.'
    if (isUnsupportedBank) {
      userMessage = 'This bank does not support automatic account verification. You can manually enter your account name.'
    } else if (isAccountNotFound) {
      userMessage = 'Account not found. Please check the account number and bank selection.'
    }
    
    return res.status(400).json({
      error: userMessage,
      detail: paystackMsg,
      unsupportedBank: isUnsupportedBank,
    })
  }
}
