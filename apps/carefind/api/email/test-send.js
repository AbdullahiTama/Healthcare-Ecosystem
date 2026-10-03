import { createClient } from '@supabase/supabase-js'
import { EmailService, TEMPLATE_REGISTRY, isValidEmail } from '@care-ecosystem/shared-email'
import { requireAdmin } from '../_lib/requireAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // The client is built per request, not at import: a missing env var must not crash the module load.
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Mails any address from the trusted sender with a caller-chosen payload, so only an active admin may call it.
  const { status: authStatus, error: authError } = await requireAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  const { templateKey, toEmail, payload } = req.body || {}
  if (!templateKey || !toEmail) return res.status(400).json({ error: 'templateKey and toEmail are required' })
  if (!Object.hasOwn(TEMPLATE_REGISTRY, templateKey)) return res.status(400).json({ error: `Unknown templateKey: ${String(templateKey).slice(0, 64)}` })
  if (!isValidEmail(toEmail)) return res.status(400).json({ error: 'toEmail must be a valid email address' })

  try {
    const emailService = new EmailService({ supabase })
    const row = await emailService.enqueue({ templateKey, toEmail, payload, subject: `[TEST] ${templateKey}` })
    emailService.processBatch().catch(e => console.error('[email/test-send] process failed', e))
    return res.status(202).json({ ok: true, outboxId: row.id, message: `Test email queued to ${toEmail}` })
  } catch (e) {
    console.error('[email/test-send] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
