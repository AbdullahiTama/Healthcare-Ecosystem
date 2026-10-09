// What happens AFTER the database settled a CareHub business withdrawal: the owner's email. One effect serves
// every seam that can settle one - the initiation's immediate reconcile, the webhook (which reaches CareFind's
// endpoint for both apps), and the reconcile cron's sweep - so whichever path changed the request is the one that
// notifies, and a replay that changed nothing sends nothing. Nothing here moves money and nothing here may fail a
// settlement: every step is best-effort and swallows its own errors.
//
// The app supplies `send(message)` (enqueue the email with ITS email service, stamped app 'carehub' so the drain
// renders the CareHub brand), so this module depends on neither app's email wiring.
const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })

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
      logger.error('businessWithdrawal.email.failed', { template: message.templateKey, message: err.message })
    }
  }

  return async function applyBusinessWithdrawalResult(result) {
    if (result?.result !== 'completed' && result?.result !== 'refunded') return
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

      const completed = result.result === 'completed'
      const reference = row.paystack_reference || result.reference || row.id
      await safeSend({
        templateKey: completed ? 'withdrawal_completed' : 'withdrawal_failed',
        toEmail,
        app: 'carehub',
        payload: {
          businessName: business?.owner_name || business?.name || '',
          amount: NGN.format((row.amount || 0) / 100),
          reference,
          bankName: row.bank_name || '',
          accountNumber: row.account_number || '',
        },
        subject: completed ? 'CareHub: withdrawal settled' : 'CareHub: withdrawal failed',
        sourceId: row.id,
        idempotencyKey: `business-withdrawal-${completed ? 'completed' : 'failed'}:${reference}`,
      })
    } catch (err) {
      logger.error('businessWithdrawal.email.failed', { id: result.id, message: err.message })
    }
  }
}
