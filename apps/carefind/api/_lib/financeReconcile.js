import { runReconciliation } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'
import { processWebhookEvent } from './webhookProcessor.js'
import { runSettlementEffects } from './settlementEffects.js'

// One reconciliation pass for the whole financial database (CareFind AND CareHub money live in the same Supabase project, and
// the one Paystack webhook is CareFind's): replay stored webhook events that failed, settle payments the provider says were paid
// but nobody settled, compare Paystack's own list of charges with our payment intents, run every database check.
// Called by the daily cron and by the admin "run now" action. Never throws: the report says which steps failed.
export async function runFinanceReconciliation(supabase) {
  return runReconciliation(supabase, getPaystackProvider(), {
    logger: paymentLogger,
    processEvent: (event) => processWebhookEvent(supabase, event),
    onSettled: (result) => runSettlementEffects(supabase, result),
  })
}
