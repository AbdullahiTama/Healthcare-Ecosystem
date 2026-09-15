import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token && process.env.CRON_SECRET) {
    if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { EmailService } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()
    const result = await emailService.processBatch()
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron/process-email-outbox] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
