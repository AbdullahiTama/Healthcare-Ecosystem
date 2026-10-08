import crypto from 'node:crypto'

// Server-side helpers around the payment_intents table (Phase 02). The table is service-role only,
// so these take an already-authenticated service-role supabase client; this package does not
// depend on supabase-js itself.

export class PaymentIntentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PaymentIntentError'
    this.code = code
  }
}

const PURPOSES = ['wallet_topup', 'creator_subscription', 'consultation', 'booking', 'appointment', 'plan_renewal', 'shop_order', 'business_wallet_topup', 'booking_wallet', 'subscription_wallet', 'consultation_wallet', 'shop_order_wallet', 'plan_renewal_wallet', 'appointment_fee_wallet']
const APPLICATIONS = ['carefind', 'carehub']

/** A fresh, unguessable payment reference: `<prefix>_<owner8>_<12 hex>`; satisfies the table's format check. */
export function newReference(prefix, ownerId = '') {
  const owner = String(ownerId).replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
  return [prefix, owner, crypto.randomBytes(6).toString('hex')].filter(Boolean).join('_')
}

/**
 * Record what we EXPECT to be paid, before the customer is sent to the provider. The amount, payer
 * and payee are decided by the caller (the server); nothing here reads client input.
 */
export async function createPaymentIntent(supabase, {
  reference, application, purpose, customerId = null, businessId = null, entityType = null, entityId = null,
  expectedAmountKobo, metadata = {}, expiresInMinutes, provider = 'paystack',
}) {
  if (!APPLICATIONS.includes(application)) throw new PaymentIntentError('invalid_intent', 'unknown application')
  if (!PURPOSES.includes(purpose)) throw new PaymentIntentError('invalid_intent', 'unknown purpose')
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(provider)) throw new PaymentIntentError('invalid_intent', 'unknown provider')
  if (!Number.isSafeInteger(expectedAmountKobo) || expectedAmountKobo <= 0) {
    throw new PaymentIntentError('invalid_intent', 'expectedAmountKobo must be a positive integer number of kobo')
  }
  if ((entityType == null) !== (entityId == null)) throw new PaymentIntentError('invalid_intent', 'entityType and entityId go together')

  const row = {
    reference,
    provider,
    application,
    purpose,
    customer_id: customerId,
    business_id: businessId,
    entity_type: entityType,
    entity_id: entityId,
    expected_amount: expectedAmountKobo,
    currency: 'NGN',
    metadata,
    ...(expiresInMinutes ? { expires_at: new Date(Date.now() + expiresInMinutes * 60_000).toISOString() } : {}),
  }
  const { data, error } = await supabase.from('payment_intents').insert(row).select().single()
  if (error) throw new PaymentIntentError(error.code === '23505' ? 'duplicate_reference' : 'intent_insert_failed', error.message)
  return data
}

export async function findIntent(supabase, reference) {
  const { data, error } = await supabase.from('payment_intents').select('*').eq('reference', reference).maybeSingle()
  if (error) throw new PaymentIntentError('intent_lookup_failed', error.message)
  return data || null
}

/** created -> pending once the provider has accepted the initialisation. Guarded: never moves a later state back. */
export async function markIntentPending(supabase, id) {
  const { error } = await supabase.from('payment_intents').update({ status: 'pending' }).eq('id', id).eq('status', 'created')
  if (error) throw new PaymentIntentError('intent_update_failed', error.message)
}

/** The provider could not start the payment: close the intent so it cannot linger as "open". */
export async function markIntentFailed(supabase, id) {
  const { error } = await supabase.from('payment_intents').update({ status: 'failed' }).eq('id', id).in('status', ['created', 'pending'])
  if (error) throw new PaymentIntentError('intent_update_failed', error.message)
}
