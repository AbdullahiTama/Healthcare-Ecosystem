// What happens AFTER the database settled a refund for a customer: their email, "your money is on its way".
// One effect serves every seam that can flip a refund to completed - the cancel call, the webhook (which reaches
// CareFind's endpoint for both apps), and the cron's three jobs - so whichever path changed the refund is the one
// that notifies, and a replay that changed nothing sends nothing. The brand follows the original charge (a CareHub
// appointment refunds as CareHub, a CareFind checkout as CareFind); the row is stamped with that app so its drain
// renders the right template. Nothing here moves money and nothing here may fail a settlement.
const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })

/**
 * @param {object} deps
 * @param {object} deps.supabase                       service-role client
 * @param {(message: object) => Promise<void>} deps.send  enqueue the email; may throw
 * @param {{error: Function}} [deps.logger]
 * @returns {(result: object) => Promise<void>}        applies to a settle_refund() result
 */
export function createRefundEffects({ supabase, send, logger = { error() {} } }) {
  async function safeSend(message) {
    try {
      await send(message)
    } catch (err) {
      logger.error('refund.email.failed', { template: message.templateKey, message: err.message })
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
    if (result?.result !== 'completed') return
    if (!result?.id) return

    try {
      // The entity row decides BOTH the brand (which app owns the charge) and the fallback copy of the payer.
      let row = null
      if (result.entity_type === 'appointment') {
        const { data } = await supabase.from('appointments').select('client_email, client_name, source').eq('id', result.entity_id).maybeSingle()
        row = data
      } else if (result.entity_type === 'payment_intent') {
        const { data } = await supabase.from('payment_intents').select('application').eq('id', result.entity_id).maybeSingle()
        row = data
      }
      const app = (result.entity_type === 'appointment' && row?.source === 'carehub') || (result.entity_type === 'payment_intent' && row?.application === 'carehub')
        ? 'carehub'
        : 'carefind'

      const auth = await payerFromAuth(result.customer_id)
      const toEmail = auth?.email || (result.entity_type === 'appointment' ? row?.client_email : null)
      const fullName = auth?.fullName || (result.entity_type === 'appointment' ? row?.client_name : null)
      if (!toEmail) {
        logger.error('refund.email.no_recipient', { id: result.id })
        return
      }

      await safeSend({
        templateKey: 'refund_completed',
        toEmail,
        app,
        payload: {
          fullName: fullName || 'there',
          amount: NGN.format((result.amount_kobo || 0) / 100),
          reference: result.reference || '',
        },
        subject: app === 'carehub' ? 'CareHub: refund completed' : 'CareFind: refund completed',
        sourceId: result.id,
        idempotencyKey: `refund-completed:${result.id}`,
      })
    } catch (err) {
      logger.error('refund.email.failed', { id: result.id, message: err.message })
    }
  }
}
