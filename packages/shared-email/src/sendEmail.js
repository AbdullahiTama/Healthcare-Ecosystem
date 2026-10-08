import { createEmailProvider } from './provider.js'

// Resolved at send time so tests and serverless invocations always see the
// current environment. EMAIL_FROM / EMAIL_REPLY_TO are canonical; the legacy
// RESEND_* names are accepted as fallbacks. No production sender is
// hardcoded — an unset configuration fails closed.
export function resolveFromEmail() {
  return process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || ''
}
export function resolveReplyTo() {
  return process.env.EMAIL_REPLY_TO || process.env.RESEND_REPLY_TO || resolveFromEmail()
}

// The sender is usually "Name <address>", but reply_to must be a bare address.
function bareAddress(value) {
  const m = String(value || '').match(/<([^<>]+)>/)
  return (m ? m[1] : String(value || '')).trim()
}

// How long one provider call may take before it is abandoned and retried. Without a bound a hung connection holds the
// serverless function (and the outbox row's claim) until the platform kills it.
function sendTimeoutMs() {
  const n = Number(process.env.EMAIL_SEND_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 1000 && n <= 60000 ? Math.trunc(n) : 15000
}

// A validation message names the offending value; keep the recipient address out of results and logs.
function safeError(result) {
  if (result.errorCode === 'validation_error') {
    return String(result.errorMessage || 'validation_error').replace(/^(invalid recipient):.*$/s, '$1')
  }
  return result.errorMessage || `Resend ${result.statusCode}`
}

// Sends one email through the hardened provider (input validation, a request timeout, an Idempotency-Key, sanitised
// errors) and returns the result shape the outbox processor's retry policy is built on:
//   { success, data?: { id }, error?, statusCode, retryable, retryAfterMs?, timeout? }
// `idempotencyKey` should be stable per outbox row: Resend then collapses a repeated send of the same row (a crash
// after the provider accepted it, a lost write) into the original instead of mailing the customer twice.
export async function sendEmail({ to, subject, html, text, from, idempotencyKey }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
  if (!RESEND_API_KEY) {
    // Recipient count only, never the address itself.
    console.warn('[shared-email] resend_not_configured', JSON.stringify({ recipients: Array.isArray(to) ? to.length : 1 }))
    return { success: false, error: 'RESEND_API_KEY not configured', retryable: false, statusCode: null }
  }
  const resolvedFrom = from || resolveFromEmail()
  if (!resolvedFrom) {
    return { success: false, error: 'EMAIL_FROM not configured', retryable: false, statusCode: null }
  }

  const provider = createEmailProvider({ apiKey: RESEND_API_KEY, timeoutMs: sendTimeoutMs() })
  const result = await provider.send({
    from: resolvedFrom,
    to,
    subject,
    html,
    text,
    replyTo: bareAddress(resolveReplyTo()) || undefined,
    idempotencyKey,
  })

  if (result.success) {
    return { success: true, data: { id: result.providerMessageId }, statusCode: result.statusCode }
  }

  const error = safeError(result)
  if (result.errorCode === 'validation_error') {
    console.error('[shared-email] send_rejected', JSON.stringify({ code: result.errorCode }))
  } else if (result.statusCode) {
    // Log the status and the provider message only. The response body can echo request content, and the request is a
    // rendered customer email.
    console.error('[shared-email] resend_rejected', JSON.stringify({ status: result.statusCode, message: result.errorMessage || null }))
  } else {
    // Transport failures (DNS, reset, timeout) are always transient.
    console.error('[shared-email] resend_transport_error', JSON.stringify({ code: result.errorCode, message: result.errorMessage || null }))
  }

  return {
    success: false,
    error,
    statusCode: result.statusCode ?? null,
    retryable: result.retryable === true,
    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
    ...(result.errorCode === 'timeout' ? { timeout: true } : {}),
  }
}
