import { createClient } from '@supabase/supabase-js'
import { sweepWithdrawals } from '../_lib/withdrawalRecovery.js'

// Standalone endpoint for the withdrawal-reconciliation sweep (financial audit H-1/H-2): manual/
// on-demand runs, and a dedicated schedule if this project ever moves off Vercel Hobby's cron-count
// cap. Production's actual daily trigger today is the chained call in cron/process-email-outbox.js -
// see that file for why. Requires CRON_SECRET strictly (unlike the email crons) because it moves money.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET is not set' })
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (token !== secret) return res.status(401).json({ error: 'Unauthorized' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    const summary = await sweepWithdrawals(supabase)
    return res.status(200).json(summary)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
