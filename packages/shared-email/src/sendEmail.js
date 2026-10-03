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

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// Retry-After is either delta-seconds or an HTTP-date. Both are accepted, and
// anything unparseable falls back to the normal backoff schedule.
function parseRetryAfterMs(headers) {
  if (!headers || typeof headers.get !== 'function') return undefined
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return undefined
}

// 429 and 5xx are transient, as is any transport level failure. Everything
// else (4xx) is a permanent rejection that retrying cannot fix.
function classifyStatus(status) {
  if (status === 429) return true
  return status >= 500
}

export async function sendEmail({ to, subject, html, text, from }) {
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
  const REPLY_TO = resolveReplyTo()
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resolvedFrom,
        to: Array.isArray(to) ? to : [to],
        reply_to: REPLY_TO,
        subject,
        html,
        ...(text ? { text } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Log the status and the provider message only. The response body can
      // echo request content, and the request is a rendered customer email.
      console.error('[shared-email] resend_rejected', JSON.stringify({ status: res.status, message: data?.message || null }))
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res.headers) : undefined
      return {
        success: false,
        error: data?.message || `Resend ${res.status}`,
        data,
        statusCode: res.status,
        retryable: classifyStatus(res.status),
        retryAfterMs,
      }
    }
    return { success: true, data, statusCode: res.status }
  } catch (e) {
    // Transport failures (DNS, reset, abort/timeout) are always transient.
    const timeout = e.name === 'AbortError' || e.name === 'TimeoutError'
    console.error('[shared-email] resend_transport_error', JSON.stringify({ name: e.name, message: e.message, timeout }))
    return { success: false, error: e.message, retryable: true, timeout, statusCode: null }
  }
}
