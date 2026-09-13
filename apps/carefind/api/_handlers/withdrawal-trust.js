import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  if (req.method === 'GET') {
    const { data, error } = await supabase.rpc('get_withdrawal_trust', {
      p_user_id: user.id,
    })
    if (error) {
      return res.status(500).json({ error: 'Could not retrieve trust information' })
    }

    const trust = Array.isArray(data) ? data[0] : data
    return res.status(200).json({
      trustLevel: trust?.trust_level || 'new',
      totalWithdrawals: trust?.total_withdrawals || 0,
      totalAmount: trust?.total_amount || 0,
      instantThreshold: trust?.instant_threshold || 0,
      deviceTrustEnabled: trust?.device_trust_enabled || false,
      biometricEnabled: trust?.biometric_enabled || false,
      consecutiveSuccess: trust?.consecutive_success || 0,
    })
  }

  if (req.method === 'POST') {
    const { action } = req.body || {}

    if (action === 'enable_device') {
      const { device_id } = req.body || {}
      if (!device_id) {
        return res.status(400).json({ error: 'Device ID is required' })
      }

      const { data, error } = await supabase.rpc('enable_device_trust', {
        p_user_id: user.id,
        p_device_id: device_id,
      })
      if (error) {
        return res.status(500).json({ error: 'Could not enable device trust' })
      }
      if (data !== true) {
        return res.status(403).json({ error: 'You must reach trusted level before enabling device trust' })
      }
      return res.status(200).json({ ok: true })
    }

    if (action === 'enable_biometric') {
      const { data: trustRows, error: fetchError } = await supabase.rpc('get_withdrawal_trust', {
        p_user_id: user.id,
      })
      if (fetchError) {
        return res.status(500).json({ error: 'Could not verify trust level' })
      }
      const trust = Array.isArray(trustRows) ? trustRows[0] : trustRows
      const level = trust?.trust_level || 'new'

      if (level === 'new') {
        return res.status(403).json({ error: 'You must reach trusted level before enabling biometric authentication' })
      }

      const { error: updateError } = await supabase
        .from('withdrawal_trust')
        .update({ biometric_enabled: true, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)

      if (updateError) {
        return res.status(500).json({ error: 'Could not enable biometric authentication' })
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
