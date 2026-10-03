import { createClient } from '@supabase/supabase-js'
import { sweepWithdrawals } from '../_lib/withdrawalRecovery.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // Fail closed. This guard used to read `if (token && process.env.CRON_SECRET)`,
  // which meant a request with no Authorization header skipped the check entirely
  // and could drain the outbox unauthenticated. Now that the schedule runs every
  // minute that endpoint is a standing unauthenticated trigger, so the secret is
  // required to be configured before it will do anything. Mirrors the guard in
  // apps/carehub/api/_handlers/cron-process-email-outbox.js.
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron/process-email-outbox] CRON_SECRET is not set - refusing to run')
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' })
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let result
  try {
    const { EmailService } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()
    result = await emailService.processBatch()
  } catch (e) {
    console.error('[cron/process-email-outbox] failed', e)
    return res.status(500).json({ error: e.message })
  }

  // Withdrawal-reconciliation sweep (financial audit H-1/H-2) rides this existing daily schedule
  // rather than its own vercel.json entry: this project is on Vercel Hobby, already at its cron
  // count with process-email-outbox and subscription-expiry. cron/reconcile-withdrawals.js stays
  // as a standalone endpoint for a manual run or a future dedicated schedule. Isolated in its own
  // try/catch so a failure here can never block email delivery, or vice versa.
  let withdrawals
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    withdrawals = await sweepWithdrawals(supabase)
  } catch (e) {
    console.error('[cron/process-email-outbox] withdrawal sweep failed', e)
    withdrawals = { error: e.message }
  }

  return res.status(200).json({ ok: true, ...result, withdrawals })
}
