import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { requestWithdrawalOtp } from '../_lib/emailOtp.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// POST /api/withdrawal-pin-otp — email a 6-digit code used to arm/change the withdrawal PIN.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })
  if (!user.email_confirmed_at) {
    return res.status(403).json({ error: 'Confirm your email before requesting a PIN code' })
  }

  const result = await requestWithdrawalOtp(supabase, user)
  if (result.error) return res.status(result.status).json({ error: result.error })

  try {
    await enqueueOutbox({
      templateKey: 'withdrawal_pin_otp',
      toEmail: user.email,
      payload: { fullName: user.user_metadata?.full_name, code: result.code, minutes: 10 },
      subject: 'CareFind: your withdrawal PIN code',
      idempotencyKey: 'pin-otp:' + user.id + ':' + Date.now(),
    })
    flushOutbox().catch((e) => console.error('[withdrawal-pin-otp] outbox flush error:', e))
  } catch (e) {
    console.error('[withdrawal-pin-otp] email enqueue error:', e)
    return res.status(500).json({ error: 'Could not send the code' })
  }

  return res.status(200).json({ ok: true })
}
