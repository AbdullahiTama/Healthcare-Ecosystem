import { createClient } from '@supabase/supabase-js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'
import { reconcileWithdrawal } from '../_lib/withdrawalRecovery.js'
import { IN_FLIGHT_GRACE_MS } from '../_lib/withdrawalAdmin.js'

// Cron: reconcile automated withdrawals that are still `pending` after the grace period.
//
// Covers the two ways a withdrawal gets stuck: initiate-withdrawal debited the wallet but
// the Paystack call failed ambiguously (no transfer code), or the transfer was created
// but its webhook never arrived. Each row is checked against Paystack by reference:
// succeeded -> completed, failed or never created -> refunded, still in flight -> left.
//
// Unlike the email crons this endpoint moves money, so it REQUIRES CRON_SECRET: a request
// without the matching bearer token is rejected, and so is a deployment with no secret set.

const BATCH_SIZE = 50

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

  const cutoff = new Date(Date.now() - IN_FLIGHT_GRACE_MS).toISOString()
  const { data: rows, error } = await supabase
    .from('withdrawal_requests')
    .select('id, user_id, amount, status, paystack_reference, paystack_transfer_code, created_at')
    .eq('status', 'pending')
    .not('paystack_reference', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) return res.status(500).json({ error: error.message })

  const summary = { checked: 0, refunded: 0, completed: 0, waiting: 0, errors: 0 }
  for (const row of rows || []) {
    summary.checked++
    try {
      const result = await reconcileWithdrawal(supabase, row)
      summary[result.outcome]++
      if (result.outcome === 'refunded') {
        console.warn('[reconcile-withdrawals] refunded unsettled withdrawal', { id: row.id, reference: row.paystack_reference })
        await notifyRefunded(supabase, row)
      }
    } catch (err) {
      summary.errors++
      console.error('[reconcile-withdrawals] row failed', { id: row.id, reference: row.paystack_reference, message: err.message })
    }
  }

  return res.status(200).json(summary)
}

async function notifyRefunded(supabase, row) {
  try {
    const { data: authData } = await supabase.auth.admin.getUserById(row.user_id)
    const email = authData?.user?.email
    if (!email) return
    await enqueueOutbox({
      templateKey: 'withdrawal_failed',
      toEmail: email,
      payload: { fullName: email, amount: row.amount, reference: row.paystack_reference },
      subject: 'CareFind: withdrawal failed',
      sourceId: row.id,
      idempotencyKey: `withdrawal-failed:${row.paystack_reference}`,
    })
    flushOutbox().catch((err) => console.error('[reconcile-withdrawals] flush error:', err))
  } catch (err) {
    console.error('[reconcile-withdrawals] notify error:', err)
  }
}
