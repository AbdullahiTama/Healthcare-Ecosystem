import { createClient } from '@supabase/supabase-js'
import { emailService } from '../../src/lib/emailService.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { templateKey, toEmail, payload, subject } = req.body || {}
  if (!templateKey || !toEmail) {
    return res.status(400).json({ error: 'templateKey and toEmail are required' })
  }

  const allowedTemplates = ['registration_owner', 'admin_new_registration', 'business_approved', 'business_rejected', 'business_suspended', 'appointment_confirmed', 'staff_welcome']
  if (!allowedTemplates.includes(templateKey)) {
    return res.status(400).json({ error: `Invalid templateKey. Allowed: ${allowedTemplates.join(', ')}` })
  }

try {
     const row = await emailService.enqueue({ templateKey, toEmail, payload, subject })
     emailService.processBatch().catch(e => console.error('[email/send] immediate process failed', e))
     return res.status(202).json({ ok: true, outboxId: row.id })
   } catch (e) {
    console.error('[email/send] enqueue failed', e)
    return res.status(500).json({ error: e.message })
  }
}
