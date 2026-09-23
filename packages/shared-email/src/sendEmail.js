const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'CareHub <support@mail.carefindhub.com>'
const REPLY_TO = process.env.RESEND_REPLY_TO || FROM_EMAIL

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

export async function sendEmail({ to, subject, html, from }) {
  if (!RESEND_API_KEY) {
    console.warn('[shared-email] RESEND_API_KEY missing — skipping send to', Array.isArray(to) ? to.join(',') : to)
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        reply_to: REPLY_TO,
        subject,
        html,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[shared-email] Resend error', res.status, data)
      return { success: false, error: data?.message || `Resend ${res.status}`, data }
    }
    return { success: true, data }
  } catch (e) {
    console.error('[shared-email] send error', e)
    return { success: false, error: e.message }
  }
}
