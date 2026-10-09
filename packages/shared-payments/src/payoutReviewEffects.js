// The owner's email AFTER an admin reviewed their saved payout account (approve/reject). One effect serves the
// admin action only: the row is re-read (the update has already committed), the outcome decides the wording, and
// the brand follows the owner - a CareFind user gets CareFind, a CareHub business gets CareHub. The account
// number is masked to its last four, keyed per account AND decision so a re-review of a different decision
// notifies again while a replay of the same one does not. Nothing here may fail the review that already committed.
const mask = (accountNumber) => (accountNumber ? `******${String(accountNumber).slice(-4)}` : '')

/**
 * @param {object} deps
 * @param {object} deps.supabase                       service-role client
 * @param {(message: object) => Promise<void>} deps.send  enqueue the email; may throw
 * @param {{error: Function}} [deps.logger]
 * @returns {(accountId: string) => Promise<void>}     applies to a payout_accounts id after the review committed
 */
export function createPayoutAccountReviewEffects({ supabase, send, logger = { error() {} } }) {
  async function safeSend(message) {
    try {
      await send(message)
    } catch (err) {
      logger.error('payoutReview.email.failed', { template: message.templateKey, message: err.message })
    }
  }

  return async function notifyPayoutAccountReview(accountId) {
    if (!accountId) return

    try {
      const { data: row } = await supabase
        .from('payout_accounts')
        .select('id, owner_user_id, owner_business_id, bank_name, account_number, status')
        .eq('id', accountId)
        .maybeSingle()
      if (!row) return
      const outcome = row.status
      if (outcome !== 'verified' && outcome !== 'failed') return

      let app = 'carefind'
      let toEmail = null
      let fullName = null
      if (row.owner_business_id) {
        app = 'carehub'
        const { data: business } = await supabase
          .from('businesses')
          .select('name, owner_name, owner_email, email')
          .eq('id', row.owner_business_id)
          .maybeSingle()
        toEmail = business?.owner_email || business?.email || null
        fullName = business?.owner_name || business?.name || null
      } else {
        try {
          const { data } = await supabase.auth.admin.getUserById(row.owner_user_id)
          toEmail = data?.user?.email || null
          fullName = data?.user?.user_metadata?.full_name || null
        } catch (err) {
          logger.error('payoutReview.email.auth_lookup_failed', { id: row.id, message: err.message })
        }
      }
      if (!toEmail) {
        logger.error('payoutReview.email.no_recipient', { id: row.id })
        return
      }

      const brand = app === 'carehub' ? 'CareHub' : 'CareFind'
      await safeSend({
        templateKey: 'payout_account_review',
        toEmail,
        app,
        payload: {
          fullName: fullName || 'there',
          outcome,
          bankName: row.bank_name || '',
          accountNumber: mask(row.account_number),
        },
        subject: `${brand}: payout account ${outcome}`,
        sourceId: row.id,
        idempotencyKey: `payout-review:${row.id}:${outcome}`,
      })
    } catch (err) {
      logger.error('payoutReview.email.failed', { id: accountId, message: err.message })
    }
  }
}
