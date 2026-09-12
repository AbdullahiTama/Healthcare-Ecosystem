import { createClient } from '@supabase/supabase-js'
import { verifyBusiness } from './_lib/verifyBusiness.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Admin review for ecommerce applications — Approve/Reject/Suspended
// Service-role only: caller must be platform admin (is_platform_admin()).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  // Verify platform admin via is_platform_admin RPC or businesses row check
  // verifyBusiness already ensures businesses row, but we need platform flag
  const { data: bizRow } = await supabase.from('businesses').select('is_platform_admin').eq('id', business.id).maybeSingle()
  const isAdmin = bizRow?.is_platform_admin === true
  // Fallback: check via RPC if exists
  if (!isAdmin) {
    try {
      const { data: isPlat } = await supabase.rpc('is_platform_admin')
      if (!isPlat) return res.status(403).json({ error: 'Admin access required' })
    } catch (e) {
      return res.status(403).json({ error: 'Admin access required' })
    }
  }

  const { business_id: targetBusinessId, status, rejection_reason } = req.body || {}
  const allowed = ['Approved','Rejected','Suspended','Under Review']
  if (!targetBusinessId || !status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'business_id and valid status (Approved/Rejected/Suspended/Under Review) required' })
  }

  const patch = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewer_id: business.id,
    updated_at: new Date().toISOString(),
  }
  if (status === 'Rejected' && rejection_reason) patch.rejection_reason = String(rejection_reason).slice(0, 500)

  const { error } = await supabase.from('ecommerce_applications').update(patch).eq('business_id', targetBusinessId)
  if (error) return res.status(400).json({ error: error.message })

  return res.status(200).json({ success: true, status })
}
