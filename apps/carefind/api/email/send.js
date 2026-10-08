import { createClient } from '@supabase/supabase-js'
import { isValidEmail } from '@care-ecosystem/shared-email'
import { requireAdmin } from '../_lib/requireAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Mails any address from the trusted sender, and password_reset / email_verification put payload links into the
  // message, so only an active admin may call it (it used to accept any signed-in user).
  const { status: authStatus, error: authError } = await requireAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  const { templateKey, toEmail, payload, subject } = req.body || {}
  if (!templateKey || !toEmail) return res.status(400).json({ error: 'templateKey and toEmail are required' })
  if (!isValidEmail(toEmail)) return res.status(400).json({ error: 'toEmail must be a valid email address' })

  const allowedTemplates = ['customer_registration', 'order_confirmation', 'purchase_confirmed', 'subscription_created', 'subscription_expiry', 'password_reset', 'email_verification', 'appointment_confirmed']
  if (!allowedTemplates.includes(templateKey)) return res.status(400).json({ error: `Invalid templateKey. Allowed: ${allowedTemplates.join(', ')}` })

  try {
    const { EmailService } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()
    const row = await emailService.enqueue({ templateKey, toEmail, payload, subject })
    emailService.processBatch().catch(e => console.error('[email/send] immediate process failed', e))
    return res.status(202).json({ ok: true, outboxId: row.id })
  } catch (e) {
    console.error('[email/send] enqueue failed', e)
    return res.status(500).json({ error: e.message })
  }
}
