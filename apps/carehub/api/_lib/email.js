// Server-only Resend email helper. Never imported by client code.
// Reads RESEND_API_KEY from process.env (server env), not Vite.

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'CareHub <onboarding@resend.dev>'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@carehub.ng'

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

// ── Templates (shared HTML) ──────────────────────────────────────────────────

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
        <div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #0E6F5A, #0B5A49); display: flex; align-items: center; justify-content: center; font-size: 20px;">🏥</div>
        <span style="font-size: 24px; font-weight: 900; color: #0f172a;">CareHub</span>
      </div>
    </div>
  `
}

function footer() {
  return `
    <div style="text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f0f0f0; color: #aaa; font-size: 12px;">
      <p>CareHub — One Platform for Every Healthcare Business in Nigeria</p>
      <p style="margin-top: 4px;">support@carehub.ng | carehub.ng</p>
    </div>
  `
}

export function buildRegistrationOwnerHtml({ businessName, ownerName }) {
  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 12px;">📋</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Registration Received</h2>
          <p style="color: #888; margin: 0;">Hi ${ownerName}, thanks for registering ${businessName}.</p>
        </div>
        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 0; color: #555; font-size: 13px; line-height: 1.7;">
            Your application is <strong>under review</strong> by the CareHub admin team. You will receive an email within <strong>24 hours</strong> once your account is approved or if any action is required.
          </p>
        </div>
        <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0; color: #888; font-size: 12px; line-height: 1.6;">You can sign in now to see your pending status. Full access unlocks after approval.</p>
        </div>
        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">Go to Sign In →</a>
      </div>
      ${footer()}
    </div>
  `
}

export function buildAdminNewRegistrationHtml({ businessName, ownerName, businessType, state, email }) {
  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">🔔 New Business Registration</h2>
        <p style="color: #888; margin: 0 0 24px;">A new business has registered and is waiting for your approval.</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            ${[
              ['Business Name', businessName],
              ['Owner', ownerName],
              ['Business Type', businessType],
              ['State', state],
              ['Email', email],
            ].map(([l, v]) => `
              <tr>
                <td style="padding: 8px 0; color: #888; font-weight: 600; font-size: 13px; width: 40%;">${l}</td>
                <td style="padding: 8px 0; color: #0f172a; font-size: 13px;">${v || '—'}</td>
              </tr>
            `).join('')}
          </table>
        </div>
        <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
          <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600;">⏳ This business is pending your approval. Log in to the admin panel to review and approve.</p>
        </div>
        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">Go to Admin Panel →</a>
      </div>
      ${footer()}
    </div>
  `
}

export function buildBusinessApprovedHtml({ businessName, ownerName, ownerEmail }) {
  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 56px; margin-bottom: 12px;">🎉</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Your Account is Approved!</h2>
          <p style="color: #888; margin: 0;">Welcome to CareHub, ${ownerName}!</p>
        </div>
        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px; color: #0E6F5A; font-weight: 700; font-size: 14px;">✅ ${businessName} is now live on CareHub!</p>
          <p style="margin: 0; color: #555; font-size: 13px; line-height: 1.7;">Your account has been approved. You can now log in and start using all features including POS, Inventory, Client Management, and CareFind listing.</p>
        </div>
        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 0 0 12px; font-weight: 700; color: #0f172a; font-size: 14px;">Your Login Details:</p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;"><strong>Website:</strong> skincarepro.vercel.app</p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;"><strong>Email:</strong> ${ownerEmail}</p>
          <p style="margin: 0; font-size: 13px; color: #555;"><strong>Password:</strong> The password you set during registration</p>
        </div>
        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">Log In to Your Dashboard →</a>
        <p style="margin-top: 20px; font-size: 12px; color: #aaa; text-align: center;">Need help? Reply to this email or contact support@carehub.ng</p>
      </div>
      ${footer()}
    </div>
  `
}

export function buildBusinessRejectedHtml({ businessName, ownerName, ownerEmail, reason }) {
  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Application Update</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${ownerName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">Thank you for registering <strong>${businessName}</strong> on CareHub. After reviewing your application, we were unable to approve your account at this time.</p>
        ${reason ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; margin-bottom: 20px;"><p style="margin: 0; color: #dc2626; font-size: 13px;"><strong>Reason:</strong> ${reason}</p></div>` : ''}
        <p style="color: #555; font-size: 13px; line-height: 1.7;">If you believe this is an error or would like to reapply with updated information, please contact our support team at <strong>support@carehub.ng</strong></p>
        <a href="mailto:support@carehub.ng" style="${btnStyle}">Contact Support</a>
      </div>
      ${footer()}
    </div>
  `
}

export function buildBusinessStatusHtml({ businessName, ownerName, ownerEmail, status, reason }) {
  if (status === 'active') return buildBusinessApprovedHtml({ businessName, ownerName, ownerEmail })
  if (status === 'rejected') return buildBusinessRejectedHtml({ businessName, ownerName, ownerEmail, reason })
  if (status === 'suspended') {
    return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Account Suspended</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${ownerName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">Your business <strong>${businessName}</strong> has been suspended. ${reason ? `<br/><strong>Reason:</strong> ${reason}` : ''}</p>
        <p style="color: #555; font-size: 13px; line-height: 1.7;">Please contact support@carehub.ng if you have questions.</p>
      </div>
      ${footer()}
    </div>`
  }
  // pending review / requires action generic
  return `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Application Update — Action Required</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${ownerName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">Your application for <strong>${businessName}</strong> requires attention. ${reason ? `<br/><strong>Details:</strong> ${reason}` : ''}</p>
        <p style="color: #555; font-size: 13px; line-height: 1.7;">Please log in or contact support@carehub.ng for next steps.</p>
        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">Go to CareHub →</a>
      </div>
      ${footer()}
    </div>`
}

export { ADMIN_EMAIL, FROM_EMAIL }
