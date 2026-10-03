import { ProviderError, ERROR_CODES as E } from '../errors.js'
import { createHttpClient } from '../http.js'
import { redactSecrets } from '../redact.js'

const BASE_URL = 'https://api.paystack.co'
const PAYMENT_REF = /^[A-Za-z0-9_-]{8,100}$/
const TRANSFER_REF = /^[a-z0-9_-]{16,50}$/ // Paystack: lowercase, digits, - and _, 16-50 chars
const NUBAN = /^\d{10}$/
const CURRENCY = 'NGN'

// Paystack vocabulary -> the provider-neutral one in PaymentProvider.js.
const PAYMENT_STATUS = {
  success: 'success',
  failed: 'failed',
  abandoned: 'abandoned',
  reversed: 'reversed',
  pending: 'pending',
  ongoing: 'pending',
  processing: 'pending',
  queued: 'pending',
}
const TRANSFER_STATUS = {
  success: 'success',
  failed: 'failed',
  rejected: 'failed',
  blocked: 'failed',
  abandoned: 'failed',
  reversed: 'reversed',
  pending: 'pending',
  otp: 'pending',
  received: 'pending',
  processing: 'pending',
  queued: 'pending',
}
const REFUND_STATUS = {
  pending: 'processing',
  processing: 'processing',
  'needs-attention': 'processing',
  processed: 'completed',
  failed: 'failed',
}

const invalid = (operation, message) =>
  new ProviderError({ code: E.INVALID_REQUEST, message, operation, retryable: false, ambiguous: false })

function assertKobo(operation, value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalid(operation, `${name} must be a positive integer number of kobo`)
}
function assertCurrency(operation, currency) {
  if (currency !== CURRENCY) throw invalid(operation, `currency must be ${CURRENCY}`)
}
function assertPattern(operation, value, re, name) {
  if (typeof value !== 'string' || !re.test(value)) throw invalid(operation, `${name} is missing or malformed`)
}

// Paystack returns `metadata` as an object, a JSON string, or null.
function parseMetadata(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* fall through */ }
  }
  return {}
}

function badResponse(operation, correlationId, message, ambiguous = false) {
  return new ProviderError({ code: E.INVALID_RESPONSE, message, operation, correlationId, ambiguous })
}

export class PaystackProvider {
  name = 'paystack'
  #getSecret // never exposed: not enumerable, not serialised, not logged
  #http

  /**
   * @param {object} opts
   * @param {string} [opts.secretKey]            sk_live_.../sk_test_...
   * @param {() => string} [opts.getSecretKey]   alternative: read lazily (e.g. from process.env)
   * @param {string} [opts.baseUrl]
   * @param {object} [opts.http]                 http overrides: fetchImpl, sleep, random, now, logger, defaults
   */
  constructor({ secretKey, getSecretKey, baseUrl = BASE_URL, http = {} } = {}) {
    const read = getSecretKey || (() => secretKey)
    this.#getSecret = () => {
      const key = read()
      if (!key) {
        throw new ProviderError({ code: E.CONFIG, message: 'Paystack is not configured: the secret key is missing' })
      }
      if (!/^sk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
        // Never echo any part of the value. A publishable key is the known live misconfiguration.
        const hint = String(key).startsWith('pk_') ? ' (it looks like a publishable key)' : ''
        throw new ProviderError({
          code: E.CONFIG,
          message: `Invalid Paystack key: expected a secret key starting with sk_live_ or sk_test_${hint}`,
        })
      }
      return key
    }
    this.#http = createHttpClient({
      baseUrl,
      getAuthHeaders: () => ({ Authorization: `Bearer ${this.#getSecret()}` }),
      // Scrub the live secret from anything surfaced, even if a provider echoes it back.
      secrets: this.#knownSecrets(),
      ...http,
    })
  }

  // ---- payments -------------------------------------------------------------------------

  async initializePayment({ reference, amountKobo, email, currency = CURRENCY, callbackUrl, metadata = {} }) {
    const op = 'initializePayment'
    assertPattern(op, reference, PAYMENT_REF, 'reference')
    assertKobo(op, amountKobo, 'amountKobo')
    assertCurrency(op, currency)
    if (typeof email !== 'string' || !email.includes('@')) throw invalid(op, 'email is required')
    const { data, correlationId } = await this.#http.request({
      operation: op,
      method: 'POST',
      path: '/transaction/initialize',
      body: { reference, amount: amountKobo, email, currency, ...(callbackUrl ? { callback_url: callbackUrl } : {}), metadata },
    })
    this.#assertOk(op, data, correlationId)
    const d = data.data
    if (!d?.authorization_url) throw badResponse(op, correlationId, 'Provider did not return a checkout URL', true)
    return { reference: d.reference || reference, authorizationUrl: d.authorization_url, accessCode: d.access_code || null }
  }

  async verifyPayment({ reference }) {
    const op = 'verifyPayment'
    assertPattern(op, reference, PAYMENT_REF, 'reference')
    const { data, correlationId } = await this.#http.request({
      operation: op,
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
    })
    this.#assertOk(op, data, correlationId)
    const d = data.data
    if (!d || typeof d !== 'object') throw badResponse(op, correlationId, 'Provider returned no transaction data')
    // The provider must be describing the transaction we asked about.
    if (d.reference !== reference) throw badResponse(op, correlationId, 'Provider returned a different transaction reference')
    if (!Number.isSafeInteger(d.amount) || d.amount < 0) throw badResponse(op, correlationId, 'Provider returned an invalid amount')
    const status = PAYMENT_STATUS[String(d.status || '').toLowerCase()]
    if (!status) throw badResponse(op, correlationId, `Provider returned an unknown payment status "${d.status}"`)
    return {
      provider: this.name,
      reference: d.reference,
      providerTransactionId: String(d.id ?? ''),
      status,
      amountKobo: d.amount,
      currency: String(d.currency || '').toUpperCase(),
      paidAt: d.paid_at || null,
      payerEmail: d.customer?.email || null,
      channel: d.channel || null,
      metadata: parseMetadata(d.metadata),
      raw: d,
    }
  }

  async refundPayment({ reference, amountKobo, reason }) {
    const op = 'refundPayment'
    assertPattern(op, reference, PAYMENT_REF, 'reference')
    if (amountKobo !== undefined) assertKobo(op, amountKobo, 'amountKobo')
    // A refund is a money-moving write: never retried here. The Refund Engine owns retry decisions.
    const { data, correlationId } = await this.#http.request({
      operation: op,
      method: 'POST',
      path: '/refund',
      body: { transaction: reference, ...(amountKobo !== undefined ? { amount: amountKobo } : {}), ...(reason ? { customer_note: reason, merchant_note: reason } : {}) },
    })
    this.#assertOk(op, data, correlationId)
    const d = data.data
    const status = REFUND_STATUS[String(d?.status || '').toLowerCase()]
    if (!status) throw badResponse(op, correlationId, `Provider returned an unknown refund status "${d?.status}"`, true)
    return { providerRefundId: String(d.id ?? ''), status, amountKobo: Number.isSafeInteger(d.amount) ? d.amount : amountKobo ?? null, raw: d }
  }

  // ---- transfers / payouts --------------------------------------------------------------

  async resolveAccount({ accountNumber, bankCode }) {
    const op = 'resolveAccount'
    assertPattern(op, accountNumber, NUBAN, 'accountNumber')
    assertPattern(op, bankCode, /^\d{3,6}$/, 'bankCode')
    const { data, correlationId } = await this.#http.request({
      operation: op,
      path: '/bank/resolve',
      query: { account_number: accountNumber, bank_code: bankCode },
    })
    this.#assertOk(op, data, correlationId)
    if (!data.data?.account_name) throw badResponse(op, correlationId, 'Provider returned no account name')
    return { accountName: data.data.account_name, accountNumber: data.data.account_number || accountNumber }
  }

  async createRecipient({ name, accountNumber, bankCode, currency = CURRENCY, metadata = {} }) {
    const op = 'createRecipient'
    if (typeof name !== 'string' || !name.trim()) throw invalid(op, 'name is required')
    assertPattern(op, accountNumber, NUBAN, 'accountNumber')
    assertPattern(op, bankCode, /^\d{3,6}$/, 'bankCode')
    assertCurrency(op, currency)
    const { data, correlationId } = await this.#http.request({
      operation: op,
      method: 'POST',
      path: '/transferrecipient',
      body: { type: 'nuban', name, account_number: accountNumber, bank_code: bankCode, currency, metadata },
    })
    this.#assertOk(op, data, correlationId)
    if (!data.data?.recipient_code) throw badResponse(op, correlationId, 'Provider returned no recipient code', true)
    return { recipientCode: data.data.recipient_code }
  }

  async initiateTransfer({ reference, amountKobo, recipientCode, reason, currency = CURRENCY }) {
    const op = 'initiateTransfer'
    assertPattern(op, reference, TRANSFER_REF, 'reference')
    assertKobo(op, amountKobo, 'amountKobo')
    assertCurrency(op, currency)
    if (typeof recipientCode !== 'string' || !recipientCode) throw invalid(op, 'recipientCode is required')
    // NEVER auto-retried. Paystack dedupes by reference, but "duplicate" does not say whether the
    // first attempt paid; the Withdrawal Engine resolves ambiguity with verifyTransfer(reference).
    const { data, correlationId } = await this.#http.request({
      operation: op,
      method: 'POST',
      path: '/transfer',
      body: { source: 'balance', amount: amountKobo, recipient: recipientCode, reference, currency, ...(reason ? { reason } : {}) },
    })
    this.#assertOk(op, data, correlationId)
    const d = data.data
    if (!d?.transfer_code) throw badResponse(op, correlationId, 'Provider returned no transfer code', true)
    return {
      transferCode: d.transfer_code,
      reference: d.reference || reference,
      status: TRANSFER_STATUS[String(d.status || '').toLowerCase()] || 'unknown',
      amountKobo: Number.isSafeInteger(d.amount) ? d.amount : amountKobo,
    }
  }

  async verifyTransfer({ reference }) {
    const op = 'verifyTransfer'
    assertPattern(op, reference, TRANSFER_REF, 'reference')
    const { data, correlationId } = await this.#http.request({
      operation: op,
      path: `/transfer/verify/${encodeURIComponent(reference)}`,
    })
    this.#assertOk(op, data, correlationId)
    const d = data.data
    if (!d || typeof d !== 'object') throw badResponse(op, correlationId, 'Provider returned no transfer data')
    return {
      reference: d.reference || reference,
      transferCode: d.transfer_code || null,
      // An unrecognised status is reported as 'unknown' (callers must wait), never guessed.
      status: TRANSFER_STATUS[String(d.status || '').toLowerCase()] || 'unknown',
      amountKobo: Number.isSafeInteger(d.amount) ? d.amount : null,
      raw: d,
    }
  }

  async getBalance({ currency = CURRENCY } = {}) {
    const op = 'getBalance'
    assertCurrency(op, currency)
    const { data, correlationId } = await this.#http.request({ operation: op, path: '/balance' })
    this.#assertOk(op, data, correlationId)
    if (!Array.isArray(data.data)) throw badResponse(op, correlationId, 'Provider returned no balances')
    // Only the requested currency counts: summing across currencies overstates what can be paid out.
    const row = data.data.find((b) => String(b.currency).toUpperCase() === currency)
    const available = row ? (row.balance ?? row.available_balance) : 0
    if (!Number.isSafeInteger(available) || available < 0) throw badResponse(op, correlationId, 'Provider returned an invalid balance')
    return { currency, availableKobo: available, raw: data.data }
  }

  // Paystack answers some failures with HTTP 200 and `status:false`.
  #assertOk(operation, body, correlationId) {
    if (body?.status === true) return
    const message = redactSecrets(typeof body?.message === 'string' ? body.message : 'Provider reported failure', this.#knownSecrets())
    throw new ProviderError({
      code: /duplicate/i.test(message) ? E.DUPLICATE_REFERENCE : E.REJECTED,
      message,
      operation,
      correlationId,
      // An explicit "no" from the provider means it did not act; not ambiguous.
      ambiguous: false,
    })
  }

  #knownSecrets() {
    try { return [this.#getSecret()] } catch { return [] }
  }

  // Never expose the closure: printing/serialising the provider reveals nothing.
  toJSON() { return { name: this.name } }
  [Symbol.for('nodejs.util.inspect.custom')]() { return `PaystackProvider { name: '${this.name}' }` }
}
