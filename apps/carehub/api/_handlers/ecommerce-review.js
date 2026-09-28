import { requirePlatformAdmin } from '../_lib/authorization.js'
import { supabase } from '../_lib/supabase.js'

// Admin review for ecommerce applications â€” Approve/Reject/Suspended
// Service-role only: caller must be platform admin (is_platform_admin()).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await requirePlatformAdmin(req)
  if (authError) return res.status(403).json({ error: authError })

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
