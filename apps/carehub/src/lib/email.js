// CareHub Email templates — client-side pure HTML builders only.
// Actual sending is server-side via api/_lib/email.js (Resend, server env).
// This file must never contain the Resend key or call the Resend API directly.

const ADMIN_EMAIL = 'admin@carehub.ng'

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

// ── Pure HTML builders (no IO) ─────────────────────────────────────────────

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
      </div>
      ${footer()}
    </div>
  `
}

export function buildBusinessRejectedHtml({ businessName, ownerName, reason }) {
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

// Legacy wrappers kept for backward imports — they now delegate to server endpoints
// instead of calling Resend directly. New code should call the /api routes directly.

export async function emailAdminNewRegistration(args) {
  try {
    const res = await fetch('/api/notify-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const data = await res.json().catch(() => ({}))
    return { success: res.ok, data }
  } catch (e) {
    console.error('[email] client notify-registration failed', e)
    return { success: false, error: e.message }
  }
}

export async function emailBusinessApproved(args) {
  console.warn('[email] emailBusinessApproved should be called server-side via /api/notify-business-status; client stub doing nothing')
  return { success: false, error: 'Use server endpoint' }
}

export async function emailBusinessRejected(args) {
  console.warn('[email] emailBusinessRejected should be called server-side; client stub')
  return { success: false, error: 'Use server endpoint' }
}

export async function emailAppointmentConfirmed(args) {
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 12px;">📅</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Appointment Confirmed!</h2>
          <p style="color: #888; margin: 0;">Hi ${args.clientName}, your appointment has been booked.</p>
        </div>
        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            ${[
              ['Business', args.businessName],
              ['Service', args.service || 'Consultation'],
              ['Date', args.date],
              ['Time', args.time],
              ['Staff', args.staffName || 'To be assigned'],
            ].map(([l, v]) => `
              <tr>
                <td style="padding: 8px 0; color: #888; font-weight: 600; font-size: 13px; width: 40%;">${l}</td>
                <td style="padding: 8px 0; color: #0f172a; font-size: 13px; font-weight: 600;">${v || '—'}</td>
              </tr>
            `).join('')}
          </table>
        </div>
      </div>
      ${footer()}
    </div>
  `
  return { html, subject: `Appointment Confirmed — ${args.businessName} on ${args.date}` }
}

export async function emailCreditReminder(args) {
  if (!args.clientEmail) return { success: false, error: 'No client email' }
  return { success: false, error: 'Use server endpoint' }
}
export async function emailStaffWelcome(args) { return { success: false, error: 'Use server endpoint' } }
export async function emailAgentApproved(args) { return { success: false, error: 'Use server endpoint' } }
export async function emailAgentRejected(args) { return { success: false, error: 'Use server endpoint' } }

export { ADMIN_EMAIL }
