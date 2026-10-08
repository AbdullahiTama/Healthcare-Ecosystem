// Server-side Resend provider. Application code must depend on this
// abstraction (createEmailProvider) and never call fetch('https://api.resend.com/...')
// directly, and never read RESEND_API_KEY outside this module.

import { validateMessage } from './validation.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_TIMEOUT_MS = 15000

// Redact anything that could be a credential from error strings before they
// reach logs or results. Provider errors echo back request details.
function sanitize(value) {
  return String(value ?? '')
    .replace(/re_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 500)
}

function classifyStatus(status) {
  if (status >= 200 && status < 300) return { errorCode: null, retryable: false }
  switch (status) {
    case 400: return { errorCode: 'invalid_request', retryable: false }
    case 401: return { errorCode: 'unauthorized', retryable: false }
    case 403: return { errorCode: 'forbidden', retryable: false }
    case 404: return { errorCode: 'not_found', retryable: false }
    case 409: return { errorCode: 'conflict', retryable: false }
    case 422: return { errorCode: 'unprocessable', retryable: false }
    case 429: return { errorCode: 'rate_limited', retryable: true }
    default:
      if (status >= 500) return { errorCode: 'provider_error', retryable: true }
      return { errorCode: 'provider_rejected', retryable: false }
  }
}

function parseRetryAfterMs(headers) {
  try {
    const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null
    if (!raw) return undefined
    const seconds = Number(raw)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const date = Date.parse(raw)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  } catch { /* ignore */ }
  return undefined
}

export function createEmailProvider({
  apiKey,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  endpoint = RESEND_ENDPOINT,
} = {}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('createEmailProvider: apiKey is required')
  }
  const doFetch = fetchImpl || globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('createEmailProvider: fetch implementation required')

  return {
    name: 'resend',

    // send() never throws for provider/transport outcomes — it returns a
    // normalized result so callers can branch on retryable/errorCode. It
    // throws only for programmer error (invalid message shape).
    async send({ from, to, subject, html, text, replyTo, idempotencyKey } = {}) {
      const validationError = validateMessage({ from, to, subject, html, replyTo })
      if (validationError) {
        return {
          success: false,
          provider: 'resend',
          providerMessageId: null,
          retryable: false,
          statusCode: null,
          errorCode: 'validation_error',
          errorMessage: validationError,
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers = {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }
        if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 255)

        let res
        try {
          res = await doFetch(endpoint, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              from,
              to: Array.isArray(to) ? to : [to],
              subject,
              html,
              ...(text ? { text } : {}),
              ...(replyTo ? { reply_to: replyTo } : {}),
            }),
          })
        } catch (err) {
          if (err && err.name === 'AbortError') {
            return { success: false, provider: 'resend', providerMessageId: null, retryable: true, statusCode: null, errorCode: 'timeout', errorMessage: `timed out after ${timeoutMs}ms` }
          }
          return { success: false, provider: 'resend', providerMessageId: null, retryable: true, statusCode: null, errorCode: 'network_error', errorMessage: sanitize(err?.message || 'network failure') }
        }

        let data = null
        try {
          data = await res.json()
        } catch {
          // fall through to malformed handling
        }

        if (res.ok) {
          if (!data || typeof data.id !== 'string' || !data.id) {
            return { success: false, provider: 'resend', providerMessageId: null, retryable: false, statusCode: res.status, errorCode: 'malformed_provider_response', errorMessage: 'provider returned no message id' }
          }
          return { success: true, provider: 'resend', providerMessageId: data.id, retryable: false, statusCode: res.status, errorCode: null, errorMessage: null }
        }

        const { errorCode, retryable } = classifyStatus(res.status)
        return {
          success: false,
          provider: 'resend',
          providerMessageId: null,
          retryable,
          statusCode: res.status,
          errorCode,
          errorMessage: sanitize(data?.message || `Resend ${res.status}`),
          ...(res.status === 429 ? { retryAfterMs: parseRetryAfterMs(res.headers) } : {}),
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
