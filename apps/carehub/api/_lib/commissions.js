import { REFERRAL_RATES, ACCRUED_WHILE_INACTIVE } from '../src/lib/referral_program.js'

// CareHub Referral Agent — server-side commission job (the money path).
//
// This runs ONLY from api/verify-plan-payment.js (service-role client, RLS
// bypassed by design), after a Paystack charge is confirmed and the
// plan_payments row is written. Never import or call this from the client.
//
// Contract:
//   — no referring agent         → nothing created
//   — agent not active + !ACCRUED_WHILE_INACTIVE → no commission; a review flag
//     is recorded instead so admin can resolve it later
//   — otherwise                  → exactly one commissions row; UNIQUE(payment_id)
//     makes a double-run harmless (second insert hits the unique constraint and
//     is swallowed, never creating a duplicate)
export async function computeCommission(supabase, { paymentId, businessId, nairaCharged, isFirstPayment }) {
  if (!paymentId || !businessId) return { commission: null, flag: null }

  const { data: business } = await supabase
    .from('businesses')
    .select('id, referring_agent_id')
    .eq('id', businessId)
    .maybeSingle()
  if (!business?.referring_agent_id) return { commission: null, flag: null }

  const { data: agent } = await supabase
    .from('agents')
    .select('id, status')
    .eq('id', business.referring_agent_id)
    .maybeSingle()

  if (!agent) {
    await flagForReview(supabase, paymentId, 'no_agent_for_attribution')
    return { commission: null, flag: true }
  }

  if (agent.status !== 'active' && !ACCRUED_WHILE_INACTIVE) {
    await flagForReview(supabase, paymentId, 'agent_' + agent.status)
    return { commission: null, flag: true }
  }

  const type = isFirst ? 'referral_bonus' : 'residual'
  const rate = REFERRAL_RATES[type]
  const amount = Math.round((Number(nairaCharged) || 0) * rate * 100) / 100

  // If the commission insert collides on UNIQUE(payment_id), a previous run
  // already recorded this payment — treat it as already handled, not an error.
  try {
    const { data, error } = await supabase.from('commissions').insert({
      agent_id: agent.id,
      business_id: business.id,
      payment_id: paymentId,
      type,
      amount,
      rate,
      status: 'accrued',
    }).select('id').single()
    if (error) throw error
    return { commission: data, flag: null }
  } catch (e) {
    if (String(e.code || e.message || '').indexOf('23505') >= 0) {
      return { commission: null, flag: null } // already recorded
    }
    console.error('Commission write failed (payment ' + paymentId + '):', e)
    return { commission: null, flag: null }
  }
}

async function flagForReview(supabase, paymentId, reason) {
  try {
    await supabase.from('commission_review_flags').insert({ payment_id: paymentId, reason })
  } catch (e) {
    // Journal write is best effort — never fails the renewal.
    console.error('Commission review flag write failed:', e)
  }
}