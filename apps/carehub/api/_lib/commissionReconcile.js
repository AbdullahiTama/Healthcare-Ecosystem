// Referral commissions are created by the database, inside the plan renewal itself (renew_business_plan ->
// _record_referral_commission), so every plan payment already has its commission or a review flag. This job
// is the safety net and the monitor:
//   * backfill_missing_commissions() repairs payments that predate the engine (oldest first, no window
//     and no per-business caps; repeated runs finish the job);
//   * reconcile_commissions() lists every inconsistency (missing / wrong type, rate, base or agent /
//     first-payment integrity / paid by both programs). Anything it reports is logged loudly.
export async function reconcileCommissions(supabase, { backfillLimit = 500 } = {}) {
  const summary = { created: 0, problems: 0, byKind: {}, errors: 0 }

  const { data: created, error: backfillErr } = await supabase.rpc('backfill_missing_commissions', { p_limit: backfillLimit })
  if (backfillErr) throw new Error(backfillErr.message)
  summary.created = Number(created) || 0

  const { data: problems, error: reconcileErr } = await supabase.rpc('reconcile_commissions')
  if (reconcileErr) throw new Error(reconcileErr.message)
  for (const p of problems || []) {
    summary.problems++
    summary.byKind[p.kind] = (summary.byKind[p.kind] || 0) + 1
    console.error('[reconcile] commission inconsistency', { kind: p.kind, paymentId: p.payment_id, businessId: p.business_id, agentId: p.agent_id, detail: p.detail })
  }
  return summary
}
