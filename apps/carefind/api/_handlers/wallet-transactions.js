import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { userOwnsBusiness } from '../_lib/businessOwnership.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Wallet transactions endpoint — returns the business's wallet transactions
// for the appointment revenue ledger.
//
// GET /api/wallet-transactions?business_id=...
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { business_id: businessId } = req.query || {}
  if (!businessId) return res.status(400).json({ error: 'Missing business_id' })

  // Only the business owner may read its wallet and ledger
  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  // An unknown business and one the caller does not own answer identically so ids cannot be probed.
  if (!(await userOwnsBusiness(supabase, user, businessId))) {
    return res.status(404).json({ error: 'Business not found' })
  }

  // Fetch wallet and transactions
  const [{ data: wallet }, { data: transactions }] = await Promise.all([
    supabase.from('business_wallets').select('*').eq('business_id', businessId).maybeSingle(),
    supabase.from('business_wallet_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  return res.status(200).json({
    success: true,
    wallet: wallet || { business_id: businessId, held_balance: 0, available_balance: 0 },
    transactions: transactions || [],
  })
}
