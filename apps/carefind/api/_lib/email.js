// Transactional email for CareFind (receipts and payment confirmations).
//
// CareHub has its own Resend sender (apps/carehub/src/lib/email.js). The two
// apps deploy as separate Vercel projects with separate root directories, so
// this cannot import that one; the transport is small enough that carrying a
// second copy is cheaper than a shared package right now. If a third sender
// appears, extract both into packages/ rather than copying again.
//
// Operating rules:
//   * An email is a courtesy on top of a payment that has ALREADY settled, so
//     nothing here ever throws. Failure is returned as a value and logged.
//   * No RESEND_API_KEY => "not configured": skip quietly, never crash.
//   * The sender must be a domain verified in Resend. Resend's shared test
//     sender (onboarding@resend.dev) only delivers to the Resend account
//     owner's own address — receipts to customers will silently not arrive
//     until EMAIL_FROM is set to an address on a verified domain.
//
// Environment (server only — never VITE_-prefixed):
//   RESEND_API_KEY   required to send
//   EMAIL_FROM       e.g. "CareFind <receipts@yourdomain.com>"
//   SUPPORT_EMAIL    optional; shown in the footer when set
//   CAREFIND_APP_URL optional; absolute base for links (else Vercel's
//                    VERCEL_PROJECT_PRODUCTION_URL; else emails have no button)

const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'CareFind <onboarding@resend.dev>'
const SEND_TIMEOUT_MS = 5000

// Mirrors packages/design-system tokens; emails cannot read CSS variables.
const C = {
  ink: '#182722', muted: '#8B978F', body: '#3C4B44', brand: '#0E6F5A',
  surface: '#FBFAF6', border: '#ECEAE0', page: '#F3F1EA',
}

export const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/
export const isValidEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim())

// Every value interpolated below can be user-typed (profile names, business
// names), so everything goes through escapeHtml — a display name of
// `<a href=…>` must not become a live link in someone's inbox. The CTA URL is
// built from our own base + a route, but is escaped too.
export function renderEmail({ heading, intro, rows = [], cta, footnote }, { appUrl = '', supportEmail = '' } = {}) {
  const base = String(appUrl || '').replace(/\/+$/, '')
  // A relative href is useless in an email, so no base URL means no button.
  const ctaUrl = cta?.path && base ? `${base}${cta.path}` : null

  const rowsHtml = rows.map(([label, value]) => `
        <tr>
          <td style="padding:9px 0;color:${C.muted};font-size:13px;width:40%;vertical-align:top;border-bottom:1px solid ${C.border};">${escapeHtml(label)}</td>
          <td style="padding:9px 0;color:${C.ink};font-size:13px;font-weight:600;vertical-align:top;border-bottom:1px solid ${C.border};word-break:break-word;">${escapeHtml(value)}</td>
        </tr>`).join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;">
    <p style="margin:0 0 16px;font-size:20px;font-weight:800;color:${C.brand};">CareFind</p>
    <div style="background:#ffffff;border:1px solid ${C.border};border-radius:12px;padding:28px 24px;">
      <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:${C.ink};">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${C.body};">${escapeHtml(intro)}</p>
      ${rows.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rowsHtml}
      </table>` : ''}
      ${ctaUrl ? `<p style="margin:0 0 4px;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;background:${C.brand};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">${escapeHtml(cta.label)}</a></p>` : ''}
      ${footnote ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${C.muted};">${escapeHtml(footnote)}</p>` : ''}
    </div>
    <p style="margin:16px 4px 0;font-size:12px;line-height:1.6;color:${C.muted};">
      Keep this email as your record of the payment.${supportEmail ? ` Questions? Contact ${escapeHtml(supportEmail)}.` : ''}
      You are receiving this because this email address was given for a payment on CareFind.
    </p>
  </div>
</body></html>`

  const text = [
    heading, '', intro, '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(ctaUrl ? ['', `${cta.label}: ${ctaUrl}`] : []),
    ...(footnote ? ['', footnote] : []),
    '', 'Keep this email as your record of the payment.',
    ...(supportEmail ? [`Questions? Contact ${supportEmail}.`] : []),
  ].join('\n')

  return { html, text }
}

/**
 * Send one email through Resend. Never throws.
 * @returns {Promise<{sent: boolean, skipped?: 'not_configured'|'invalid_recipient', error?: string, id?: string}>}
 */
export async function sendEmail({ to, subject, html, text }, {
  env = process.env, fetchImpl = globalThis.fetch, logger = console, timeoutMs = SEND_TIMEOUT_MS,
} = {}) {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    logger.warn('[email] RESEND_API_KEY is not set — receipt not sent')
    return { sent: false, skipped: 'not_configured' }
  }
  if (!isValidEmail(to)) return { sent: false, skipped: 'invalid_recipient' }

  // A hard timeout: this runs inside a payment handler, and Vercel will not let
  // the function outlive its response, so a hung provider must not hold the
  // customer's "payment confirmed" screen hostage.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM || DEFAULT_FROM,
        to: [to.trim()],
        subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200),
        html,
        text,
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Resend's message is safe to log (it never echoes the key); the
      // recipient address is not logged.
      logger.error('[email] provider rejected message', { status: res.status, message: data?.message })
      return { sent: false, error: data?.message || `HTTP ${res.status}` }
    }
    return { sent: true, id: data?.id }
  } catch (err) {
    logger.error('[email] send failed', { message: err?.name === 'AbortError' ? 'timed out' : err?.message })
    return { sent: false, error: err?.name === 'AbortError' ? 'timed out' : err?.message }
  } finally {
    clearTimeout(timer)
  }
}
