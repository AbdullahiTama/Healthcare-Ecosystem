// What happens AFTER the database moved a refund for a customer: their email. One effect serves every seam that can
// move a refund - the cancel call, the webhook (which reaches CareFind's endpoint for both apps), and the cron's three
// jobs - so whichever path changed the refund is the one that notifies, and a replay that changed nothing sends
// nothing. Three moments, three emails, each with a key that is the refund id so a seam that runs twice still sends one:
//   requested  "we are refunding your payment"      (request_refund answered `requested`)
//   completed  "your refund is complete"             (the provider confirmed it, or CareCoins were returned)
//   failed     "your refund needs attention"         (the provider refused or failed it; the team is alerted by reconciliation)
// The brand follows the original charge (a CareHub appointment refunds as CareHub, a CareFind checkout as CareFind);
// the row is stamped with that app so its drain renders the right template. Nothing here moves money and nothing here
// may fail a settlement.
const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })

const KINDS = {
  requested: { templateKey: 'refund_requested', key: 'refund-requested', subject: 'refund requested' },
  completed: { templateKey: 'refund_completed', key: 'refund-completed', subject: 'refund completed' },
  failed: { templateKey: 'refund_failed', key: 'refund-failed', subject: 'refund needs attention' },
}

/**
 * @param {object} deps
 * @param {object} deps.supabase                       service-role client
 * @param {(message: object) => Promise<void>} deps.send  enqueue the email; may throw
 * @param {{error: Function}} [deps.logger]
 * @returns {(result: object) => Promise<void>}        applies to a settle_refund() result, or to a `{ result: 'requested', ... }` event
 */
export function createRefundEffects({ supabase, send, logger = { error() {} } }) {
  async function safeSend(message) {
    try {
      await send(message)
    } catch (err) {
      logger.error('email.enqueue_failed', { family: 'refund', template: message.templateKey, id: message.sourceId, message: String(err.message).replace(/\S+@\S+/g, '[email]').slice(0, 120) })
    }
  }

  async function payerFromAuth(customerId) {
    if (!customerId) return null
    try {
      const { data } = await supabase.auth.admin.getUserById(customerId)
      return data?.user ? { email: data.user.email || null, fullName: data.user.user_metadata?.full_name || null } : null
    } catch (err) {
      logger.error('refund.email.auth_lookup_failed', { message: err.message })
      return null
    }
  }

  return async function applyRefundResult(result) {
    const kind = KINDS[result?.result]
    if (!kind) return
    if (!result?.id) return

    try {
      // The entity row decides BOTH the brand (which app owns the charge) and the fallback copy of the payer.
      let row = null
      let customerId = result.customer_id || null
      if (result.entity_type === 'appointment') {
        const { data } = await supabase.from('appointments').select('client_email, client_name, source, patient_user_id').eq('id', result.entity_id).maybeSingle()
        row = data
        customerId = customerId || data?.patient_user_id || null
      } else if (result.entity_type === 'payment_intent') {
        const { data } = await supabase.from('payment_intents').select('application, customer_id').eq('id', result.entity_id).maybeSingle()
        row = data
        customerId = customerId || data?.customer_id || null
      }
      const app = (result.entity_type === 'appointment' && row?.source === 'carehub') || (result.entity_type === 'payment_intent' && row?.application === 'carehub')
        ? 'carehub'
        : 'carefind'

      const auth = await payerFromAuth(customerId)
      const toEmail = auth?.email || (result.entity_type === 'appointment' ? row?.client_email : null)
      const fullName = auth?.fullName || (result.entity_type === 'appointment' ? row?.client_name : null)
      if (!toEmail) {
        logger.error('refund.email.no_recipient', { id: result.id, kind: result.result })
        return
      }

      const reason = result.entity_type === 'appointment' ? 'Appointment cancelled' : 'Your payment could not be applied'
      await safeSend({
        templateKey: kind.templateKey,
        toEmail,
        app,
        payload: {
          fullName: fullName || 'there',
          // a card refund is naira; a CareCoin refund (no kobo) is the coins that went back to the wallet
          amount: result.amount_kobo > 0 ? NGN.format(result.amount_kobo / 100) : (result.coins > 0 ? `${result.coins} CareCoins` : NGN.format(0)),
          reference: result.reference || '',
          ...(result.result === 'requested' ? { reason } : {}),
        },
        subject: `${app === 'carehub' ? 'CareHub' : 'CareFind'}: ${kind.subject}`,
        sourceId: result.id,
        idempotencyKey: `${kind.key}:${result.id}`,
      })
    } catch (err) {
      logger.error('refund.email.failed', { id: result.id, message: err.message })
    }
  }
}
