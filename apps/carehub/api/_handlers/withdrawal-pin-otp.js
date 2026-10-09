import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { requestWithdrawalOtp } from '../_lib/emailOtp.js'
import { emailService } from '../../src/lib/emailService.js'

// POST /api/withdrawal-pin-otp — email a 6-digit code for the withdrawal step-up. The same
// action-neutral code serves both flows: arming/changing the withdrawal PIN (action 'set_pin',
// the default) and confirming a withdrawal (action 'withdrawal'). The action is recorded in the
// outbox payload for audit; it never changes the wording of the email.
const OTP_ACTIONS = new Set(['set_pin', 'withdrawal'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })
  if (!user.email_confirmed_at) {
    return res.status(403).json({ error: 'Confirm your email before requesting a code' })
  }

  const action = req.body?.action ?? 'set_pin'
  if (!OTP_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown OTP action' })

  const result = await requestWithdrawalOtp(supabase, user)
  if (result.error) return res.status(result.status).json({ error: result.error })

  try {
    await emailService.enqueue({
      templateKey: 'withdrawal_pin_otp',
      toEmail: user.email,
      payload: { code: result.code, minutes: 10, action },
      subject: 'CareHub: your withdrawal security code',
      idempotencyKey: `pin-otp:${user.id}:${Date.now()}`,
    })
    emailService.processBatch().catch(() => {})
  } catch (err) {
    console.error('[withdrawal-pin-otp] email enqueue failed:', err.message)
    return res.status(500).json({ error: 'Could not send the code' })
  }

  return res.status(200).json({ ok: true })
}
