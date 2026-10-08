import { PaymentIntentError } from './intents.js'

// Provider events (webhooks) are persisted BEFORE they are processed, and the unique
// (provider, event_id) index makes a replay detectable. A replay of an event that was already
// handled is acknowledged without reprocessing; one whose earlier processing failed or crashed is
// handed back for another attempt, so retries stay safe.

/** Paystack has no single event id field; `<event>:<transaction/transfer id>` is stable per occurrence. */
export function paystackEventId(event) {
  const id = event?.data?.id ?? event?.data?.reference ?? event?.data?.transfer_code
  if (!event?.event || id == null) return null
  return `${event.event}:${id}`
}

/**
 * @returns {Promise<{ event: object, isNew: boolean, alreadyHandled: boolean }>}
 */
export async function recordProviderEvent(supabase, { provider, eventId, eventType, reference = null, payload, signatureOk }) {
  const row = { provider, event_id: eventId, event_type: eventType, reference, payload, signature_ok: signatureOk }
  const { data, error } = await supabase.from('payment_provider_events').insert(row).select().single()
  if (!error) return { event: data, isNew: true, alreadyHandled: false }

  if (error.code !== '23505') throw new PaymentIntentError('event_insert_failed', error.message)

  const { data: existing, error: readErr } = await supabase
    .from('payment_provider_events').select('*').eq('provider', provider).eq('event_id', eventId).maybeSingle()
  if (readErr || !existing) throw new PaymentIntentError('event_lookup_failed', readErr?.message || 'event vanished')
  const handled = existing.processed_at != null && ['processed', 'ignored', 'duplicate'].includes(existing.outcome)
  return { event: existing, isNew: false, alreadyHandled: handled }
}

/**
 * A failed attempt is recorded (outcome, attempts, error) but NOT stamped processed: processed_at is
 * write-once in the database, and the retry that eventually succeeds must still be able to set it.
 * @param {'processed'|'ignored'|'failed'|'duplicate'} outcome
 */
export async function finishProviderEvent(supabase, event, { outcome, error = null }) {
  const patch = {
    outcome,
    attempts: (event.attempts || 0) + 1,
    last_error: error ? String(error).slice(0, 500) : null,
    ...(outcome === 'failed' ? {} : { processed_at: new Date().toISOString() }),
  }
  const { error: err } = await supabase.from('payment_provider_events').update(patch).eq('id', event.id)
  if (err) throw new PaymentIntentError('event_update_failed', err.message)
}
