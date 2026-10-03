import { computeCommission } from './commissions.js'

// Backstop for referral commissions. A plan payment can be settled by CareFind's shared Paystack
// webhook (the business closed the tab before the redirect) - and only CareHub's redirect handler
// computes commission, so those payments would never earn their agent anything. This finds
// plan payments from referred businesses that have neither a commission nor a review flag and
// runs computeCommission on them. computeCommission is idempotent (UNIQUE(payment_id)), so
// overlapping with the redirect handler, or running twice, is harmless.
//
// Relies on plan_payments.naira_amount being NAIRA (renew_business_plan is called with
// amount / 100). Rows written before that fix stored kobo; production had none at the time.
export async function reconcileCommissions(supabase, { windowDays = 90, limit = 200 } = {}) {
  const summary = { checked: 0, created: 0, flagged: 0, errors: 0 }

  const { data: referred, error: refErr } = await supabase
    .from('businesses')
    .select('id')
    .not('referring_agent_id', 'is', null)
    .limit(1000)
  if (refErr) throw new Error(refErr.message)
  const businessIds = (referred || []).map((b) => b.id)
  if (businessIds.length === 0) return summary

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { data: payments, error: payErr } = await supabase
    .from('plan_payments')
    .select('id, business_id, naira_amount, is_first_payment, created_at')
    .in('business_id', businessIds)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (payErr) throw new Error(payErr.message)
  if (!payments || payments.length === 0) return summary

  const ids = payments.map((p) => p.id)
  const [{ data: commissions }, { data: flags }] = await Promise.all([
    supabase.from('commissions').select('payment_id').in('payment_id', ids),
    supabase.from('commission_review_flags').select('payment_id').in('payment_id', ids),
  ])
  const handled = new Set([...(commissions || []), ...(flags || [])].map((r) => r.payment_id))

  for (const p of payments) {
    if (handled.has(p.id)) continue
    summary.checked++
    try {
      const result = await computeCommission(supabase, {
        paymentId: p.id,
        businessId: p.business_id,
        nairaCharged: p.naira_amount,
        isFirstPayment: p.is_first_payment,
      })
      if (result?.commission) summary.created++
      else if (result?.flag) summary.flagged++
    } catch (err) {
      summary.errors++
      console.error('[reconcile] commission failed', { paymentId: p.id, message: err.message })
    }
  }
  return summary
}
