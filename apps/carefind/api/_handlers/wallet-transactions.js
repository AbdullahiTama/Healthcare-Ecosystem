import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'

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

  // Ownership mirrors CareHub's identity model (businesses.email is the owner's login email;
  // branches share their parent's email, so the parent's owner may read a branch wallet).
  // An unknown business and a business the caller does not own answer identically so ids
  // cannot be probed.
  const { data: biz } = await supabase
    .from('businesses')
    .select('id, email, parent_business_id')
    .eq('id', businessId)
    .maybeSingle()

  const callerEmail = String(user.email || '').trim().toLowerCase()
  let owns = Boolean(callerEmail && biz && String(biz.email || '').trim().toLowerCase() === callerEmail)
  if (!owns && callerEmail && biz?.parent_business_id) {
    const { data: parent } = await supabase
      .from('businesses')
      .select('email')
      .eq('id', biz.parent_business_id)
      .maybeSingle()
    owns = String(parent?.email || '').trim().toLowerCase() === callerEmail
  }
  if (!owns) return res.status(404).json({ error: 'Business not found' })

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
