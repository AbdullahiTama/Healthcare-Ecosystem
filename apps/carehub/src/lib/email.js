// CareHub Email Service using Resend
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = 'CareHub <onboarding@resend.dev>'
const ADMIN_EMAIL = 'admin@carehub.ng'

async function sendEmail({ to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    })
    const data = await res.json()
    return { success: res.ok, data }
  } catch (e) {
    console.error('Email error:', e)
    return { success: false, error: e.message }
  }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────

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

// ── 1. ADMIN NOTIFICATION — New Business Registered ──────────────────────────
export async function emailAdminNewRegistration({ businessName, ownerName, businessType, state, email }) {
  const html = `
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
          <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600;">
            ⏳ This business is pending your approval. Log in to the admin panel to review and approve.
          </p>
        </div>

        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">
          Go to Admin Panel →
        </a>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: ADMIN_EMAIL,
    subject: '🔔 New Registration: ' + businessName + ' — Awaiting Approval',
    html,
  })
}

// ── 2. BUSINESS APPROVED ─────────────────────────────────────────────────────
export async function emailBusinessApproved({ businessName, ownerName, ownerEmail }) {
  const html = `
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
          <p style="margin: 0; color: #555; font-size: 13px; line-height: 1.7;">
            Your account has been approved by the CareHub admin team. 
            You can now log in and start using all features including POS, 
            Inventory, Client Management, and CareFind listing.
          </p>
        </div>

        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 0 0 12px; font-weight: 700; color: #0f172a; font-size: 14px;">Your Login Details:</p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;">
            <strong>Website:</strong> skincarepro.vercel.app
          </p>
          <p style="margin: 0 0 6px; font-size: 13px; color: #555;">
            <strong>Email:</strong> ${ownerEmail}
          </p>
          <p style="margin: 0; font-size: 13px; color: #555;">
            <strong>Password:</strong> The password you set during registration
          </p>
        </div>

        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">
          Log In to Your Dashboard →
        </a>

        <p style="margin-top: 20px; font-size: 12px; color: #aaa; text-align: center;">
          Need help? Reply to this email or contact support@carehub.ng
        </p>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: ownerEmail,
    subject: '🎉 Welcome to CareHub — ' + businessName + ' is Approved!',
    html,
  })
}

// ── 3. BUSINESS REJECTED ─────────────────────────────────────────────────────
export async function emailBusinessRejected({ businessName, ownerName, ownerEmail, reason }) {
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Application Update</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${ownerName},</p>

        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Thank you for registering <strong>${businessName}</strong> on CareHub. 
          After reviewing your application, we were unable to approve your account at this time.
        </p>

        ${reason ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
          <p style="margin: 0; color: #dc2626; font-size: 13px;"><strong>Reason:</strong> ${reason}</p>
        </div>
        ` : ''}

        <p style="color: #555; font-size: 13px; line-height: 1.7;">
          If you believe this is an error or would like to reapply with updated information, 
          please contact our support team at <strong>support@carehub.ng</strong>
        </p>

        <a href="mailto:support@carehub.ng" style="${btnStyle}">
          Contact Support
        </a>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: ownerEmail,
    subject: 'CareHub — Application Status for ' + businessName,
    html,
  })
}

// ── 4. APPOINTMENT CONFIRMATION ───────────────────────────────────────────────
export async function emailAppointmentConfirmed({ clientName, clientEmail, businessName, service, date, time, staffName }) {
  if (!clientEmail) return { success: false, error: 'No client email' }
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 12px;">📅</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Appointment Confirmed!</h2>
          <p style="color: #888; margin: 0;">Hi ${clientName}, your appointment has been booked.</p>
        </div>

        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            ${[
              ['Business', businessName],
              ['Service', service || 'Consultation'],
              ['Date', date],
              ['Time', time],
              ['Staff', staffName || 'To be assigned'],
            ].map(([l, v]) => `
              <tr>
                <td style="padding: 8px 0; color: #888; font-weight: 600; font-size: 13px; width: 40%;">${l}</td>
                <td style="padding: 8px 0; color: #0f172a; font-size: 13px; font-weight: 600;">${v || '—'}</td>
              </tr>
            `).join('')}
          </table>
        </div>

        <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px;">
          <p style="margin: 0; color: #92400e; font-size: 13px;">
            📍 Please arrive 10 minutes before your appointment time. 
            If you need to reschedule, please contact the business directly.
          </p>
        </div>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: clientEmail,
    subject: '📅 Appointment Confirmed — ' + businessName + ' on ' + date,
    html,
  })
}

// ── 5. CREDIT SALE REMINDER ───────────────────────────────────────────────────
export async function emailCreditReminder({ clientName, clientEmail, businessName, amount, txnNo, businessPhone }) {
  if (!clientEmail) return { success: false, error: 'No client email' }
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Payment Reminder</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${clientName},</p>

        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          This is a friendly reminder that you have an outstanding balance with <strong>${businessName}</strong>.
        </p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
          <p style="margin: 0 0 4px; color: #888; font-size: 13px;">Outstanding Balance</p>
          <p style="margin: 0; color: #dc2626; font-size: 32px; font-weight: 900;">₦${Number(amount).toLocaleString()}</p>
          <p style="margin: 8px 0 0; color: #aaa; font-size: 12px;">Transaction: ${txnNo}</p>
        </div>

        <p style="color: #555; font-size: 13px; text-align: center;">
          Please contact <strong>${businessName}</strong> to make your payment.
          ${businessPhone ? '<br/>Phone: <strong>' + businessPhone + '</strong>' : ''}
        </p>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: clientEmail,
    subject: '💳 Payment Reminder — ' + businessName,
    html,
  })
}

// ── 6. STAFF WELCOME EMAIL ────────────────────────────────────────────────────
export async function emailStaffWelcome({ staffName, staffEmail, businessName, role, password }) {
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 12px;">👋</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">You've Been Added to CareHub!</h2>
          <p style="color: #888; margin: 0;">Welcome to the team, ${staffName}!</p>
        </div>

        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          You have been added as a <strong>${role}</strong> at <strong>${businessName}</strong> on CareHub.
          Here are your login details:
        </p>

        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            ${[
              ['Website', 'skincarepro.vercel.app'],
              ['Email', staffEmail],
              ['Password', password],
              ['Role', role],
              ['Business', businessName],
            ].map(([l, v]) => `
              <tr>
                <td style="padding: 8px 0; color: #888; font-weight: 600; font-size: 13px; width: 40%;">${l}</td>
                <td style="padding: 8px 0; color: #0f172a; font-size: 13px; font-weight: 600;">${v}</td>
              </tr>
            `).join('')}
          </table>
        </div>

        <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
          <p style="margin: 0; color: #92400e; font-size: 13px;">
            🔒 Please change your password after your first login for security.
          </p>
        </div>

        <a href="https://skincarepro.vercel.app/login" style="${btnStyle}">
          Log In Now →
        </a>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: staffEmail,
    subject: '👋 Welcome to ' + businessName + ' on CareHub!',
    html,
  })
}

// ── 7. REFERRAL AGENT APPROVED ────────────────────────────────────────────────
export async function emailAgentApproved({ agentName, agentEmail, city, area, referralCode }) {
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 56px; margin-bottom: 12px;">🤝</div>
          <h2 style="color: #0f172a; margin: 0 0 8px;">Welcome to the CareHub Referral Agent Program!</h2>
          <p style="color: #888; margin: 0;">${agentName}, you're now covering <strong>${area}, ${city}</strong>.</p>
        </div>

        <div style="background: #FDFBF7; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px; color: #0E6F5A; font-weight: 700; font-size: 14px;">✅ Your application has been approved!</p>
          <p style="margin: 0 0 12px; color: #555; font-size: 13px; line-height: 1.7;">
            You'll finish onboarding/training with the CareHub team before your area goes live.
            Once active, you'll earn <strong>40% of every first payment</strong> and <strong>5% of every
            renewal</strong> from the businesses you bring onto CareHub.
          </p>
          <p style="margin: 0; color: #555; font-size: 13px; line-height: 1.7;">
            <strong>Your referral code:</strong>
          </p>
          <div style="margin: 8px 0 0; display: inline-block; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 18px; font-weight: 800; color: #0E6F5A; background: #f9fafb; border: 1px dashed #0E6F5A; border-radius: 8px; padding: 8px 14px;">
            ${referralCode || '—'}
          </div>
        </div>

        <a href="https://skincarepro.vercel.app/agent/login" style="${btnStyle}">
          Sign in to your Agent Dashboard →
        </a>

        <p style="margin-top: 20px; font-size: 12px; color: #aaa; text-align: center;">
          Need help? Reply to this email or contact support@carehub.ng
        </p>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: agentEmail,
    subject: '🤝 Welcome to CareHub — Agent Application Approved',
    html,
  })
}

// ── 8. REFERRAL AGENT REJECTED ────────────────────────────────────────────────
export async function emailAgentRejected({ agentName, agentEmail, city, area, reason }) {
  const html = `
    <div style="${baseStyle}">
      ${logoHeader()}
      <div style="${cardStyle}">
        <h2 style="color: #0f172a; margin: 0 0 8px;">Application Update</h2>
        <p style="color: #888; margin: 0 0 24px;">Dear ${agentName},</p>

        <p style="color: #555; font-size: 14px; line-height: 1.7; margin-bottom: 20px;">
          Thank you for applying to cover <strong>${area}, ${city}</strong> as a CareHub Referral Agent.
          After review, we weren't able to approve this application at this time.
        </p>

        ${reason ? `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; margin-bottom: 20px;">
          <p style="margin: 0; color: #dc2626; font-size: 13px;"><strong>Reason:</strong> ${reason}</p>
        </div>
        ` : ''}

        <p style="color: #555; font-size: 13px; line-height: 1.7;">
          You're welcome to reapply with updated details, or contact our team at
          <a href="mailto:support@carehub.ng" style="color: #0E6F5A;">support@carehub.ng</a>.
        </p>
      </div>
      ${footer()}
    </div>
  `

  return sendEmail({
    to: agentEmail,
    subject: 'CareHub — Referral Agent Application Status',
    html,
  })
}
