// Server-only Resend email helper for CareFind. Never imported by client code.
// Reads RESEND_API_KEY from process.env (server env), not Vite.

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'CareFind <onboarding@resend.dev>'

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY missing — skipping send to', Array.isArray(to) ? to.join(',') : to)
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
        from: FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[email] Resend error', res.status, data)
      return { success: false, error: data?.message || `Resend ${res.status}`, data }
    }
    return { success: true, data }
  } catch (e) {
    console.error('[email] send error', e)
    return { success: false, error: e.message }
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const baseStyle = `
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  background: #f9fafb;
  padding: 20px;
`

const cardStyle = `
  background: white;
  border-radius: 16px;
  padding: 32px;
  border: 1px solid #f0f0f0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
`

const btnStyle = `
  display: inline-block;
  padding: 14px 28px;
  background: linear-gradient(135deg, #0E6F5A, #0B5A49);
  color: white;
  text-decoration: none;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  margin-top: 20px;
`

function logoHeader() {
  return `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-flex; align-items: center; gap: 10px;">
        <div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #0E6F5A, #0B5A49); display: flex; align-items: center; justify-content: center; font-size: 20px;">💊</div>
        <span style="font-size: 24px; font-weight: 900; color: #0f172a;">CareFind</span>
      </div>
    </div>
  `
}

function footer() {
  return `
    <div style="text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f0f0f0; color: #aaa; font-size: 12px;">
      <p>CareFind — Healthcare Marketplace</p>
      <p style="margin-top: 4px;">support@carefind.ng | carefind.ng</p>
    </div>
  `
}

function fmtKobo(kobo) {
  return '\u20A6' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 })
}

export function buildOrderConfirmationHtml({ order, items, siteUrl }) {
  const base = (siteUrl || '').replace(/\/$/, '')
  const orderUrl = base ? `${base}/orders/${order.id}` : ''

  const itemRows = (items || []).map(item => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0; color: #334155; font-size: 13px;">${esc(item.product_name)}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0; color: #334155; font-size: 13px; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0; color: #334155; font-size: 13px; text-align: right;">${fmtKobo(item.unit_price_kobo)}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #f0f0f0; color: #334155; font-size: 13px; text-align: right;">${fmtKobo(item.quantity * item.unit_price_kobo)}</td>
    </tr>
  `).join('')

  const subtotal = order.subtotal_kobo || (order.total_kobo - order.fulfilment_kobo - order.delivery_kobo)

  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Order Confirmed!</h2>
          <p style="color: #888; margin: 0;">Payment received — thank you for shopping with CareFind.</p>
        </div>

        <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; color: #888; font-size: 13px; font-weight: 600; width: 40%;">Order Reference</td>
              <td style="padding: 4px 0; color: #0f172a; font-size: 13px;">${esc(order.order_ref)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888; font-size: 13px; font-weight: 600;">Date</td>
              <td style="padding: 4px 0; color: #0f172a; font-size: 13px;">${new Date(order.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888; font-size: 13px; font-weight: 600;">Payment Reference</td>
              <td style="padding: 4px 0; color: #0f172a; font-size: 13px;">${esc(order.payment_reference || '—')}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h3 style="color: #0f172a; font-size: 14px; margin: 0 0 12px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 10px 12px; text-align: left; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Product</th>
                <th style="padding: 10px 12px; text-align: center; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Qty</th>
                <th style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Price</th>
                <th style="padding: 10px 12px; text-align: right; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
        </div>

        <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Subtotal</td>
              <td style="padding: 6px 0; color: #334155; font-size: 13px; text-align: right;">${fmtKobo(subtotal)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Fulfilment Fee</td>
              <td style="padding: 6px 0; color: #334155; font-size: 13px; text-align: right;">${fmtKobo(order.fulfilment_kobo || 0)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Delivery Fee</td>
              <td style="padding: 6px 0; color: #334155; font-size: 13px; text-align: right;">${order.delivery_kobo > 0 ? fmtKobo(order.delivery_kobo) : 'Pending'}</td>
            </tr>
            <tr style="border-top: 2px solid #e2e8f0;">
              <td style="padding: 10px 0 4px; color: #0f172a; font-size: 15px; font-weight: 700;">Total Paid</td>
              <td style="padding: 10px 0 4px; color: #0E6F5A; font-size: 15px; font-weight: 700; text-align: right;">${fmtKobo(order.total_kobo)}</td>
            </tr>
          </table>
        </div>

        ${order.delivery_address ? `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <p style="margin: 0 0 4px; color: #166534; font-size: 13px; font-weight: 600;">Delivery Address</p>
            <p style="margin: 0; color: #15803d; font-size: 13px;">${esc(order.delivery_address)}${order.delivery_city ? ', ' + esc(order.delivery_city) : ''}${order.delivery_state ? ', ' + esc(order.delivery_state) : ''}</p>
          </div>
        ` : ''}

        ${orderUrl ? `
          <div style="text-align: center;">
            <a href="${orderUrl}" style="${btnStyle}">View Order →</a>
          </div>
        ` : ''}
      </div>
      ${footer()}
    </div>
  `
}
