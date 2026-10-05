import { createClient } from '@supabase/supabase-js'
import { sweepWithdrawals } from '../_lib/withdrawalRecovery.js'
import { runRefundSweeps } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { EmailService } from '@care-ecosystem/shared-email'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // Generate a request ID for this cron invocation and store it in the module
  // so EmailService can pick it up via its package-scoped variable.
  const requestId = crypto.randomUUID?.() || 'cron-' + Date.now()
  globalThis._cronRequestId = requestId

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
    const emailService = new EmailService()
    // drain(), not processBatch(): this endpoint is the minute worker behind
    // Supabase Cron (see supabase/migrations/carefind_20260928_email_outbox_cron.sql),
    // and a single batch per tick cannot clear a backlog. It is bounded by
    // EMAIL_OUTBOX_BATCH_SIZE x EMAIL_OUTBOX_MAX_BATCHES so one tick still
    // finishes inside the function timeout.
    result = await emailService.drain()
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

  // Refund engine sweep: finish card refunds the provider has not answered, refund payments that could not be applied, and
  // refund appointments that were cancelled while paid but never refunded. Each part is isolated; none can block email.
  let refunds
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    refunds = await runRefundSweeps(supabase, getPaystackProvider(), { logger: paymentLogger })
  } catch (e) {
    console.error('[cron/process-email-outbox] refund sweep failed', e)
    refunds = { error: e.message }
  }

  return res.status(200).json({ ok: true, ...result, withdrawals, refunds })
}
