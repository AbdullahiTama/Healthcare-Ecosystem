// The contract every payment provider adapter implements. Application code depends on THIS shape,
// never on Paystack (or Flutterwave/Kora later). Adapters live behind it and normalise the
// provider's vocabulary into the one below.
//
// Money is always an integer number of minor units (kobo): `amountKobo`. No floats cross this
// boundary in either direction.
//
// Every method returns a Promise and throws ProviderError (see errors.js) on failure.
//
// @typedef {'success'|'failed'|'pending'|'abandoned'|'reversed'} PaymentStatus
// @typedef {object} VerifiedTransaction
//   provider: string, reference: string, providerTransactionId: string, status: PaymentStatus,
//   amountKobo: number, currency: string, paidAt: string|null, payerEmail: string|null,
//   channel: string|null, metadata: object, raw: object
// @typedef {'pending'|'success'|'failed'|'reversed'|'unknown'} TransferStatus
// @typedef {'requested'|'processing'|'completed'|'failed'} RefundStatus

export const PROVIDER_METHODS = Object.freeze([
  'initializePayment', // ({ reference, amountKobo, email, currency?, callbackUrl?, metadata? }) -> { reference, authorizationUrl, accessCode }
  'verifyPayment',     // ({ reference }) -> VerifiedTransaction              (safe to retry)
  'refundPayment',     // ({ reference, amountKobo?, reason? }) -> { providerRefundId, status: RefundStatus, amountKobo, raw }
  'verifyRefund',      // ({ reference }) -> { providerRefundId, status: RefundStatus, amountKobo, raw }   (safe to retry; reference = the refunded payment's reference)
  'resolveAccount',    // ({ accountNumber, bankCode }) -> { accountName, accountNumber }   (safe to retry)
  'createRecipient',   // ({ name, accountNumber, bankCode, currency?, metadata? }) -> { recipientCode }
  'initiateTransfer',  // ({ reference, amountKobo, recipientCode, reason?, currency? }) -> { transferCode, reference, status: TransferStatus, amountKobo }
  'verifyTransfer',    // ({ reference }) -> { reference, transferCode, status: TransferStatus, amountKobo, raw }   (safe to retry)
  'getBalance',        // ({ currency? }) -> { currency, availableKobo, raw }       (safe to retry)
  'listTransactions',  // ({ from, to, status?, page?, perPage? }) -> { transactions: VerifiedTransaction[], page, hasMore }   (safe to retry; reconciliation)
])

/** Throws if `provider` does not implement the full contract. */
export function assertPaymentProvider(provider) {
  const missing = PROVIDER_METHODS.filter((m) => typeof provider?.[m] !== 'function')
  if (typeof provider?.name !== 'string' || !provider.name) missing.unshift('name')
  if (missing.length) throw new TypeError(`Not a PaymentProvider; missing: ${missing.join(', ')}`)
  return provider
}
