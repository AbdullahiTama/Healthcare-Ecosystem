// What happens AFTER the database settled a CareHub business withdrawal: the owner's email. One effect serves
// every seam that can settle one - the initiation's immediate reconcile, the webhook (which reaches CareFind's
// endpoint for both apps), and the reconcile cron's sweep - so whichever path changed the request is the one that
// notifies, and a replay that changed nothing sends nothing. Nothing here moves money and nothing here may fail a
// settlement: every step is best-effort and swallows its own errors.
//
// The app supplies `send(message)` (enqueue the email with ITS email service, stamped app 'carehub' so the drain
// renders the CareHub brand), so this module depends on neither app's email wiring.
const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
// Only the last four digits ever reach the outbox (its payload is stored); the template masks again as a second guard.
const last4 = (n) => { const d = String(n ?? '').replace(/\D/g, ''); return d ? `••••${d.slice(-4)}` : '' }

/**
 * @param {object} deps
 * @param {object} deps.supabase                       service-role client
 * @param {(message: object) => Promise<void>} deps.send  enqueue + flush one email; may throw
 * @param {{error: Function}} [deps.logger]
 * @returns {(result: object) => Promise<void>}        applies to a settle_business_withdrawal() result
 */
export function createBusinessWithdrawalEffects({ supabase, send, logger = { error() {} } }) {
  async function safeSend(message) {
    try {
      await send(message)
    } catch (err) {
      logger.error('email.enqueue_failed', { family: 'business_withdrawal', template: message.templateKey, id: message.sourceId, message: String(err.message).replace(/\S+@\S+/g, '[email]').slice(0, 120) })
    }
  }

  // result.result: 'completed' | 'refunded' (settle_business_withdrawal) | 'in_flight' (the sweep: still moving at the provider)
  return async function applyBusinessWithdrawalResult(result) {
    if (result?.result !== 'completed' && result?.result !== 'refunded' && result?.result !== 'in_flight') return
    if (!result?.id) return

    try {
      // One lookup: the bank details for the template rows and the owner's address for the envelope.
      const { data: row } = await supabase
        .from('business_withdrawal_requests')
        .select('id, amount, bank_name, account_number, paystack_reference, businesses(name, owner_name, owner_email, email)')
        .eq('id', result.id)
        .maybeSingle()
      if (!row) return
      const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses
      const toEmail = business?.owner_email || business?.email
      if (!toEmail) {
        logger.error('businessWithdrawal.email.no_recipient', { id: row.id })
        return
      }

      const kind = result.result === 'completed' ? 'completed' : result.result === 'in_flight' ? 'processing' : 'failed'
      const reference = row.paystack_reference || result.reference || row.id
      await safeSend({
        templateKey: kind === 'completed' ? 'withdrawal_completed' : kind === 'processing' ? 'withdrawal_processing' : 'withdrawal_failed',
        toEmail,
        app: 'carehub',
        payload: {
          businessName: business?.name || business?.owner_name || '',
          amount: NGN.format((row.amount || 0) / 100),
          reference,
          bankName: row.bank_name || '',
          accountNumber: last4(row.account_number),
        },
        subject: kind === 'completed' ? 'CareHub: withdrawal settled' : kind === 'processing' ? 'CareHub: your withdrawal is still processing' : 'CareHub: withdrawal failed',
        sourceId: row.id,
        idempotencyKey: `business-withdrawal-${kind}:${reference}`,
      })
    } catch (err) {
      logger.error('businessWithdrawal.email.failed', { id: result.id, message: err.message })
    }
  }
}
