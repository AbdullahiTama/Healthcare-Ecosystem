import { emailService } from '../../src/lib/emailService.js'

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
