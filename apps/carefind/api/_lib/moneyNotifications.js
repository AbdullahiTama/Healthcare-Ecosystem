// The delivery guarantee for money e-mails. The effects that send them (withdrawal settled / failed, refund completed /
// failed, top-up received) run once, in the call that changed the state; if that call died, or the enqueue failed, a later
// replay reports "already settled" and nothing would ever re-send it. This pass asks the database for money events that
// settled recently and have NO outbox row under their e-mail's idempotency key, and sends exactly those through the same
// effects with the same keys, so a lost enqueue becomes a late e-mail and a replay can never make a duplicate.
//
// It is idempotent (an event already queued is not listed again; the outbox key is unique anyway), bounded (a limit and the
// cron's deadline) and never throws into the cron: one broken event is counted and the rest continue. It sends nothing that
// the original path has not already decided to send: the candidates are settled states, nothing is guessed.
import { emailWithdrawalCompleted, emailWithdrawalFailed } from './withdrawalEffects.js'
import { applyBusinessWithdrawalResult } from './businessWithdrawalEffects.js'
import { applyRefundResult } from './refundEffects.js'
import { runSettlementEffects } from './settlementEffects.js'

const log = (event, fields) => console.info(JSON.stringify({ event, ...fields }))

/**
 * @returns {Promise<{ found: number, sent: number, errors: number, byKind: object, stopped?: string }>}
 */
export async function runNotificationBackfill(supabase, { since = '48 hours', limit = 100, deadline = null } = {}) {
  const { data, error } = await supabase.rpc('list_unnotified_money_events', { p_since: since, p_limit: limit })
  if (error) throw new Error(`list_unnotified_money_events: ${error.message}`)

  const summary = { found: (data || []).length, sent: 0, errors: 0, byKind: {} }
  for (const e of data || []) {
    if (deadline && Date.now() > deadline) { summary.stopped = 'deadline'; break }
    try {
      switch (e.kind) {
        case 'withdrawal_completed':
          await emailWithdrawalCompleted(supabase, { id: e.subject_id, user_id: e.user_id, amount: e.coins, payout_kobo: e.amount_kobo, reference: e.reference })
          break
        case 'withdrawal_failed':
          await emailWithdrawalFailed(supabase, { id: e.subject_id, user_id: e.user_id, amount: e.coins, payout_kobo: e.amount_kobo, reference: e.reference })
          break
        case 'business_withdrawal_completed':
          await applyBusinessWithdrawalResult(supabase, { result: 'completed', id: e.subject_id, reference: e.reference })
          break
        case 'business_withdrawal_failed':
          await applyBusinessWithdrawalResult(supabase, { result: 'refunded', id: e.subject_id, reference: e.reference })
          break
        case 'refund_completed':
        case 'refund_failed':
          await applyRefundResult(supabase, {
            result: e.kind === 'refund_completed' ? 'completed' : 'failed',
            id: e.subject_id, reference: e.reference, customer_id: e.user_id, entity_type: e.entity_type, entity_id: e.entity_id, amount_kobo: e.amount_kobo, coins: e.coins,
          })
          break
        case 'wallet_topup':
        case 'business_wallet_topup': {
          const { data: intent } = await supabase.from('payment_intents').select('*').eq('id', e.subject_id).maybeSingle()
          if (!intent) throw new Error('intent not found')
          await runSettlementEffects(supabase, { outcome: 'settled', purpose: intent.purpose, intent })
          break
        }
        default:
          continue
      }
      summary.sent++
      summary.byKind[e.kind] = (summary.byKind[e.kind] || 0) + 1
    } catch (err) {
      summary.errors++
      console.error('[moneyNotifications] backfill failed', JSON.stringify({ kind: e.kind, id: e.subject_id, message: String(err.message).replace(/\S+@\S+/g, '[email]').slice(0, 120) }))
    }
  }
  if (summary.sent > 0 || summary.errors > 0) log('email.backfilled', { found: summary.found, sent: summary.sent, errors: summary.errors, byKind: summary.byKind })
  return summary
}
