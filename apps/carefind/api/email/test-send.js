import { createClient } from '@supabase/supabase-js'
import { EmailService } from '@care-ecosystem/shared-email'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const emailService = new EmailService()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { templateKey, toEmail, payload } = req.body || {}
  if (!templateKey || !toEmail) return res.status(400).json({ error: 'templateKey and toEmail are required' })

  try {
    const row = await emailService.enqueue({ templateKey, toEmail, payload, subject: `[TEST] ${templateKey}` })
    emailService.processBatch().catch(e => console.error('[email/test-send] process failed', e))
    return res.status(202).json({ ok: true, outboxId: row.id, message: `Test email queued to ${toEmail}` })
  } catch (e) {
    console.error('[email/test-send] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
