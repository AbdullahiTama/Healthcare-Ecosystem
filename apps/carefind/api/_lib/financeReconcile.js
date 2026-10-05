import crypto from 'node:crypto'
import { runReconciliation } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'
import { processWebhookEvent } from './webhookProcessor.js'
import { runSettlementEffects } from './settlementEffects.js'

// One reconciliation pass for the whole financial database (CareFind AND CareHub money live in the same Supabase project, and
// the one Paystack webhook is CareFind's): replay stored webhook events that failed, settle payments the provider says were paid
// but nobody settled, compare Paystack's own list of charges with our payment intents, run every database check, and email the
// platform administrators about anything critical.
//
// Called every minute by the cron endpoint (each step decides for itself whether it is due: see RECONCILIATION_SCHEDULE) and by the
// admin "run now" action (`force`). Never throws: the report says which steps failed.

const MAX_LINES = 12
const MAX_LINE = 300

/** The flat-string payload the `finance_alert` catalog event requires. Findings carry ids and amounts only, never secrets. */
export function buildAlertPayload(findings) {
  const shown = findings.slice(0, MAX_LINES)
  const lines = shown
    .map((f) => `${String(f.kind).replace(/_/g, ' ')} (${f.subject_id}): ${String(f.detail).replace(/\s+/g, ' ')}`.slice(0, MAX_LINE))
    .join('\n')
  return { critical_count: String(findings.length), lines, more_count: String(Math.max(0, findings.length - shown.length)) }
}

/** Active platform admins, plus FINANCE_ALERT_EMAILS (comma separated) for people who are not admins. De-duplicated, lower-cased. */
export async function alertRecipients(supabase, env = process.env) {
  const { data, error } = await supabase.from('admin_users').select('email').eq('is_active', true)
  if (error) throw new Error(`could not read the administrators: ${error.message}`)
  const extra = String(env.FINANCE_ALERT_EMAILS || '').split(',')
  return [...new Set([...(data || []).map((a) => a.email), ...extra].map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@')))]
}

/** -> a function that queues the alert for every recipient through the email catalog. Throws when nobody could be reached. */
export function createFinanceAlertSender(supabase, { env = process.env, logger = paymentLogger } = {}) {
  return async (findings) => {
    const recipients = await alertRecipients(supabase, env)
    if (!recipients.length) throw new Error('no administrator email to alert')
    const payload = buildAlertPayload(findings)
    let queued = 0
    for (const to of recipients) {
      // One source id per recipient: the catalog's uniqueness is (app, event, source), so a shared id would send only the first.
      const { data, error } = await supabase.rpc('enqueue_business_email_event', {
        p_app: 'carefind', p_event_key: 'finance_alert', p_to_email: to, p_payload: payload, p_source_id: crypto.randomUUID(),
      })
      if (error) logger.error('reconciliation.alert_enqueue_failed', { message: error.message })
      else if (data) queued++
    }
    // The catalog can suppress the event (disabled / paused) and return null: that is not "alerted".
    if (!queued) throw new Error('the finance alert email was not queued (event disabled or the outbox refused it)')
  }
}

export async function runFinanceReconciliation(supabase, { force = false } = {}) {
  return runReconciliation(supabase, getPaystackProvider(), {
    logger: paymentLogger,
    force,
    processEvent: (event) => processWebhookEvent(supabase, event),
    onSettled: (result) => runSettlementEffects(supabase, result),
    sendAlert: createFinanceAlertSender(supabase),
  })
}
