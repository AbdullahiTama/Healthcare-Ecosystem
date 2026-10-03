import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { templateKey, toEmail, payload, subject } = req.body || {}
  if (!templateKey || !toEmail) return res.status(400).json({ error: 'templateKey and toEmail are required' })

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
