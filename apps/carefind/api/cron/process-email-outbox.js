import { createClient } from '@supabase/supabase-js'
import { EmailService } from '@care-ecosystem/shared-email'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const emailService = new EmailService()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token && process.env.CRON_SECRET) {
    if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  }

  const result = await emailService.processBatch()
  return res.status(200).json({ ok: true, ...result })
}
