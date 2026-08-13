import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { paystackFetch } from '../_lib/paystack.js'
import { creditTopup } from '../_lib/paystackCredit.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Called when the user is redirected back from Paystack, so the wallet
// updates immediately rather than waiting on the webhook. This is the
// server-verified replacement for what Wallet.jsx used to do itself:
// read `?coins=&naira=` off the URL and credit the wallet directly,
// trusting whatever numbers were in the address bar. Nothing here is
// trusted from the client except which reference to look up ΓÇö the coins,
// amount, and owning user all come from Paystack's own verify response.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }

  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  const { metadata, amount } = paystackData.data
  if (!metadata?.user_id || !metadata?.coins) {
    return res.status(400).json({ error: 'Transaction has no package metadata' })
  }
  // The reference must belong to the person asking about it ΓÇö otherwise
  // anyone who saw someone else's reference in a shared link could poll
  // this endpoint and read (though not redirect the credit toward
  // themselves, thanks to the check below) another user's payment.
  if (metadata.user_id !== user.id) {
    return res.status(403).json({ error: 'This transaction does not belong to you' })
  }

  const result = await creditTopup(supabase, {
    userId: metadata.user_id,
    coins: parseInt(metadata.coins),
    nairaAmount: amount,
    reference,
  })

  if (result.alreadyProcessed) return res.status(200).json({ alreadyProcessed: true })
  return res.status(200).json({ credited: parseInt(metadata.coins), newBalance: result.newBalance })
}
