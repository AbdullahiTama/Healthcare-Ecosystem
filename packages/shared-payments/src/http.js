import { ProviderError, ERROR_CODES as E } from './errors.js'
import { redactSecrets } from './redact.js'

// Provider-neutral JSON-over-HTTP client with the resilience rules every provider call needs.
//
// Retry policy (deliberately conservative - this moves money):
//   * 429 Too Many Requests: the provider did NOT process the request, so it is retried for every
//     method, honouring Retry-After (capped).
//   * GET: also retried on timeout, dropped connection and 500/502/503/504, with jittered
//     exponential backoff. Reads cannot change state.
//   * Anything else that writes (POST/PUT/DELETE) is NEVER retried after a timeout, a network
//     error or a 5xx. The request may have been processed; the outcome is reported as
//     `ambiguous: true` and the caller must look it up by reference before acting.
// A total time budget bounds all retries together (serverless functions have hard limits).

const DEFAULTS = Object.freeze({
  timeoutMs: 8000,        // per attempt
  maxAttempts: 3,         // GET only; writes get 1 (+ 429 retries)
  baseDelayMs: 200,
  maxDelayMs: 2000,
  maxRetryAfterMs: 5000,  // longest Retry-After we will sleep on
  totalBudgetMs: 15000,   // attempts + sleeps together
})

const noopLogger = { info() {}, warn() {}, error() {} }
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function newCorrelationId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function parseRetryAfter(header, nowMs) {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs)
}

function statusToCode(status, message) {
  if (status === 401 || status === 403) return E.AUTH
  if (status === 404) return E.NOT_FOUND
  if (status === 429) return E.RATE_LIMITED
  if (status >= 500) return E.UNAVAILABLE
  if (/duplicate/i.test(message || '')) return E.DUPLICATE_REFERENCE
  if (status === 400 || status === 422) return E.INVALID_REQUEST
  return E.REJECTED
}

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl
 * @param {() => Record<string,string>} cfg.getAuthHeaders  called per request, so the secret is read lazily
 * @param {string[]} [cfg.secrets]   exact secrets to scrub from anything we surface
 * @param {typeof fetch} [cfg.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [cfg.sleep]
 * @param {() => number} [cfg.random]
 * @param {() => number} [cfg.now]
 * @param {{info:Function,warn:Function,error:Function}} [cfg.logger]
 * @param {Partial<typeof DEFAULTS>} [cfg.defaults]
 */
export function createHttpClient({
  baseUrl,
  getAuthHeaders,
  secrets = [],
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  logger = noopLogger,
  defaults = {},
}) {
  const cfg = { ...DEFAULTS, ...defaults }
  const clean = (text) => redactSecrets(text, secrets)

  /**
   * @param {object} req
   * @param {string} req.operation          provider operation name, for logs/errors
   * @param {string} req.path               already URL-encoded, no query string
   * @param {'GET'|'POST'|'PUT'|'DELETE'} [req.method]
   * @param {Record<string,string|number>} [req.query]
   * @param {object} [req.body]
   * @param {string} [req.correlationId]
   * @param {number} [req.timeoutMs]
   * @param {boolean} [req.noRetry]        disable even the safe GET/429 retries
   * @returns {Promise<{ data: any, status: number, correlationId: string, attempts: number }>}
   */
  async function request({ operation, path, method = 'GET', query, body, correlationId = newCorrelationId(), timeoutMs = cfg.timeoutMs, noRetry = false }) {
    const isRead = method === 'GET'
    const isWrite = !isRead
    const maxAttempts = noRetry ? 1 : isRead ? cfg.maxAttempts : 1 + 2 // writes: only 429 retries, bounded
    const startedAt = now()
    // Credentials are resolved once per call; a config problem must fail before anything is sent.
    let authHeaders
    try {
      authHeaders = getAuthHeaders()
    } catch (err) {
      if (err instanceof ProviderError) throw new ProviderError({ ...err, code: err.code, message: err.message, operation, correlationId })
      throw new ProviderError({ code: E.CONFIG, message: clean(err.message), operation, correlationId, cause: err })
    }

    const qs = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}` : ''
    const url = `${baseUrl}${path}${qs}`
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let lastError = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let failure = null
      let result = null
      let retryAfterMs = null

      try {
        const res = await fetchImpl(url, {
          method,
          headers: {
            Accept: 'application/json',
            ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
            'X-Correlation-Id': correlationId,
            ...authHeaders,
          },
          body: payload,
          signal: controller.signal,
        })
        const text = await res.text()
        let json = null
        let parseFailed = false
        if (text) {
          try { json = JSON.parse(text) } catch { parseFailed = true }
        }
        if (res.ok) {
          if (json === null || typeof json !== 'object') {
            failure = {
              code: E.INVALID_RESPONSE,
              message: parseFailed ? 'Provider returned a body that is not valid JSON' : 'Provider returned an empty response',
              httpStatus: res.status,
              ambiguous: isWrite,
              retryable: false,
            }
          } else {
            result = { data: json, status: res.status }
          }
        } else {
          const providerMessage = clean(json?.message || (parseFailed ? text.slice(0, 120) : '') || `HTTP ${res.status}`)
          const code = statusToCode(res.status, providerMessage)
          retryAfterMs = res.status === 429 ? parseRetryAfter(res.headers?.get?.('retry-after'), now()) : null
          failure = {
            code,
            message: code === E.AUTH ? 'Provider rejected our credentials' : providerMessage,
            httpStatus: res.status,
            // 5xx on a write: the provider may have processed it before failing.
            ambiguous: isWrite && res.status >= 500,
            retryable: code === E.RATE_LIMITED || (isRead && res.status >= 500 && res.status !== 501),
          }
        }
      } catch (err) {
        const timedOut = controller.signal.aborted
        failure = {
          code: timedOut ? E.TIMEOUT : E.NETWORK,
          message: timedOut ? `Provider did not answer within ${timeoutMs}ms` : `Could not reach the provider: ${clean(err?.message || 'network error')}`,
          httpStatus: null,
          // The request may have left our machine before we gave up.
          ambiguous: isWrite,
          retryable: isRead,
          cause: err,
        }
      } finally {
        clearTimeout(timer)
      }

      const durationMs = now() - attemptStart
      // Query string is never logged: it can carry account numbers.
      const logBase = { provider: 'http', operation, method, path, attempt, durationMs, correlationId }

      if (result) {
        logger.info('provider.request', { ...logBase, status: result.status, outcome: 'ok' })
        return { ...result, correlationId, attempts: attempt }
      }

      lastError = new ProviderError({ ...failure, operation, correlationId, attempts: attempt })
      logger.warn('provider.request', { ...logBase, status: failure.httpStatus, outcome: failure.code, ambiguous: failure.ambiguous })

      // May we try again?
      const retriable = failure.code === E.RATE_LIMITED || (isRead && failure.retryable)
      if (!retriable || attempt >= maxAttempts) break

      const backoff = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** (attempt - 1)) * (0.5 + random() / 2)
      const delay = retryAfterMs != null ? Math.min(retryAfterMs, cfg.maxRetryAfterMs) : backoff
      if (now() - startedAt + delay >= cfg.totalBudgetMs) break
      await sleep(delay)
    }

    logger.error('provider.request.failed', { operation, method, path, correlationId, code: lastError.code, attempts: lastError.attempts })
    throw lastError
  }

  return { request, newCorrelationId }
}
