import { createClient } from '@supabase/supabase-js'
import { createBudget } from '@care-ecosystem/shared-payments'
import { runFinanceJobs } from '../_lib/financeJobs.js'
import { EmailService } from '@care-ecosystem/shared-email'

// One deadline for the whole invocation (email drain + the finance steps). vercel.json gives this function 60 s; the budget leaves room
// to answer. Override with CRON_BUDGET_MS if the plan's limit differs.
const BUDGET_MS = Number(process.env.CRON_BUDGET_MS) > 0 ? Number(process.env.CRON_BUDGET_MS) : 50_000

export default async function handler(req, res) {
  const budget = createBudget(BUDGET_MS)
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

  // One service-role client for the whole invocation, INJECTED into the email service: left to itself the shared
  // package resolves '@supabase/supabase-js' from its own directory, which on Vercel has no node_modules (see
  // EmailService.loadCreateClient), so a drain that built its own client could die with "Cannot find package".
  let supabase
  let result
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const emailService = new EmailService({ supabase })
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

  // The financial work, as named steps with intervals (vendor payouts, withdrawal sweep, refund sweep, reconciliation): see
  // _lib/financeJobs.js. This endpoint is driven every minute, so each step runs only when its slot is due, the whole invocation shares
  // one deadline (a step that no longer fits runs next minute), and a failing step never blocks the others or the email delivery above.
  let finance
  try {
    finance = await runFinanceJobs(supabase, { budget })
  } catch (e) {
    console.error('[cron/process-email-outbox] finance jobs failed', e)
    finance = { error: e.message }
  }

  return res.status(200).json({ ok: true, ...result, finance })
}
