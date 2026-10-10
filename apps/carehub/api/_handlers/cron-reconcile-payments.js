import { supabase } from '../_lib/supabase.js'
import { reconcileBusinessWithdrawals } from '../_lib/withdrawalRecovery.js'
import { reconcileCommissions } from '../_lib/commissionReconcile.js'
import { runRefundSweeps } from '@care-ecosystem/shared-payments'
import { applyRefundResult } from '../_lib/refundEffects.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'

// Cron: backstop for the two ways CareHub money gets stuck.
//   * business withdrawals still pending/processing after the grace period (the Paystack
//     transfer call failed ambiguously, or its webhook never arrived) - checked against
//     Paystack by reference: succeeded -> completed, failed/never created -> refunded.
//   * refunds: finish card refunds the provider has not answered, refund payments that could not be applied and
//     appointments cancelled while paid (the same sweep CareFind runs; every step is idempotent).
//   * referral commissions: backfill payments that predate the commission engine and report inconsistencies
//     (new commissions are created by the database inside the plan renewal itself).
//
// This endpoint moves money, so like process-email-outbox it fails closed on CRON_SECRET.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron/reconcile-payments] CRON_SECRET is not set - refusing to run')
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' })
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (token !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const result = { withdrawals: null, commissions: null, refunds: null }
  let failed = false

  // Independent jobs: one failing must not stop the other.
  try {
    result.withdrawals = await reconcileBusinessWithdrawals(supabase)
  } catch (err) {
    failed = true
    result.withdrawals = { error: err.message }
    console.error('[cron/reconcile-payments] withdrawals failed:', err)
  }
  try {
    result.commissions = await reconcileCommissions(supabase)
  } catch (err) {
    failed = true
    result.commissions = { error: err.message }
    console.error('[cron/reconcile-payments] commissions failed:', err)
  }

  try {
    result.refunds = await runRefundSweeps(supabase, getPaystackProvider(), { logger: paymentLogger, onSettled: (settled) => applyRefundResult(supabase, settled) })
  } catch (err) {
    failed = true
    result.refunds = { error: err.message }
    console.error('[cron/reconcile-payments] refunds failed:', err)
  }

  return res.status(failed ? 500 : 200).json(result)
}
