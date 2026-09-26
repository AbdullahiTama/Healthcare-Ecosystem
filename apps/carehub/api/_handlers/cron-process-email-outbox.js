import { emailService } from '../../src/lib/emailService.js'

// Vercel Cron Jobs invoke the configured path with GET, not POST. The previous
// revision rejected anything but POST, so the schedule could never have run
// even with the import fixed. GET and POST are both accepted.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Fail closed. The previous guard was `if (token && process.env.CRON_SECRET)`,
  // which meant a request with no Authorization header skipped the check
  // entirely and could drain the outbox unauthenticated.
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron/process-email-outbox] CRON_SECRET is not set — refusing to run')
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' })
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await emailService.processBatch()
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/process-email-outbox] failed', err)
    return res.status(500).json({ error: err.message })
  }
}
