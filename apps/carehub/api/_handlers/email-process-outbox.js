import { supabase } from '../_lib/supabase.js'
import { requirePlatformAdmin } from '../_lib/requirePlatformAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Triggers real sends from the trusted sender, so only a platform admin may call it (it used to accept any signed-in
  // user). The scheduled drain uses the cron handler, not this endpoint.
  const { status: authStatus, error: authError } = await requirePlatformAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  try {
    const { EmailService } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()
    const result = await emailService.processBatch()
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[email/process-outbox] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
