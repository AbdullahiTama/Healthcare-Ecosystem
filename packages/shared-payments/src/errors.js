// Structured provider errors. Every failure that leaves this package is a ProviderError, so callers
// branch on `code` / `retryable` / `ambiguous` instead of parsing message strings.

export const ERROR_CODES = Object.freeze({
  CONFIG: 'config',                       // missing/invalid credentials or setup (never sent to the provider)
  INVALID_REQUEST: 'invalid_request',     // rejected locally or by the provider as malformed
  AUTH: 'auth',                           // provider refused our credentials
  NOT_FOUND: 'not_found',                 // provider has no such transaction/transfer/etc.
  DUPLICATE_REFERENCE: 'duplicate_reference',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  UNAVAILABLE: 'provider_unavailable',    // provider 5xx
  REJECTED: 'provider_rejected',          // provider answered and said no (business-level)
  INVALID_RESPONSE: 'invalid_response',   // provider answered with something we cannot trust
})

export class ProviderError extends Error {
  /**
   * @param {object} p
   * @param {string} p.code            one of ERROR_CODES
   * @param {string} p.message         safe, human-readable; secrets are redacted by the HTTP layer
   * @param {string} [p.operation]     e.g. 'verifyPayment'
   * @param {string} [p.correlationId]
   * @param {number|null} [p.httpStatus]
   * @param {boolean} [p.retryable]    the SAME operation may be retried by the caller without risk
   * @param {boolean} [p.ambiguous]    a write MAY have taken effect at the provider (timeout, dropped
   *                                   connection, unreadable reply). Never assume it did not happen:
   *                                   look it up by reference before refunding/re-sending.
   * @param {number} [p.attempts]
   * @param {Error} [p.cause]
   */
  constructor({ code, message, operation = null, correlationId = null, httpStatus = null, retryable = false, ambiguous = false, attempts = 1, cause }) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.operation = operation
    this.correlationId = correlationId
    this.httpStatus = httpStatus
    this.retryable = retryable
    this.ambiguous = ambiguous
    this.attempts = attempts
    // Non-enumerable so it is not dumped by logging/serialisation helpers.
    if (cause) Object.defineProperty(this, 'cause', { value: cause, enumerable: false })
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      operation: this.operation,
      correlationId: this.correlationId,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      ambiguous: this.ambiguous,
      attempts: this.attempts,
    }
  }
}

export const isProviderError = (e) => e instanceof ProviderError
