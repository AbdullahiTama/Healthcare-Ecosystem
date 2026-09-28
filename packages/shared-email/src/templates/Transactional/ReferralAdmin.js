import { logoHeader, footer, baseStyle, cardStyle, btnStyle, esc } from './BaseTemplate.js'

const APP_URL = typeof process !== 'undefined' && process.env?.APP_URL ? process.env.APP_URL : 'https://carefindhub.com'
const SUPPORT_EMAIL = 'support@mail.carefindhub.com'
const FALLBACK = 'Not provided'

const infoRows = (rows) => `<table style="width:100%;border-collapse:collapse">${rows
  .map(([label, value]) => `<tr><td style="padding:8px 0;color:#888;font-weight:600;font-size:13px;width:40%">${esc(label)}</td><td style="padding:8px 0;color:#0f172a;font-size:13px">${esc(value || FALLBACK)}</td></tr>`)
  .join('')}</table>`

const reasonBox = (reason) => (reason
  ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:20px"><p style="margin:0;color:#dc2626;font-size:13px"><strong>Reason:</strong> ${esc(reason)}</p></div>`
  : '')

const supportLink = `<a href="mailto:${SUPPORT_EMAIL}" style="${btnStyle()}">Contact Support</a>`

// Referral agent decisions. These two keys were emitted by the CareHub
// referral panel but had no renderer, so the outbox worker failed them closed
// with no_template:carehub:<key>.
export function agentApproved({ agentName, city, area, referralCode }) {
  return `<div style="${baseStyle()}">${logoHeader('CareHub')}<div style="${cardStyle()}"><div style="text-align:center;margin-bottom:24px"><div style="font-size:48px;margin-bottom:12px">&#10003;</div><h2 style="color:#0f172a;margin:0 0 8px">You are approved, ${esc(agentName)}!</h2><p style="color:#888;margin:0">Your referral agent application has been approved.</p></div><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:20px"><p style="margin:0;color:#166534;font-size:13px;line-height:1.7">You can now refer businesses to CareHub. Share your personal referral code below and earn rewards for every business that signs up through it.</p>${referralCode ? `<p style="margin:16px 0 0;color:#0f172a;font-size:22px;font-weight:700;letter-spacing:1px;text-align:center">${esc(referralCode)}</p>` : ''}</div><div style="background:#FDFBF7;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px">${infoRows([['City', city], ['Area', area], ['Referral code', referralCode]])}</div><a href="${APP_URL}/referrals" style="${btnStyle()}">Go to Referrals</a><p style="margin-top:16px;font-size:12px;color:#aaa;text-align:center">Questions? Email us at ${SUPPORT_EMAIL}.</p></div>${footer('CareHub', 'carefindhub.com')}</div>`
}

export function agentRejected({ agentName, city, area, reason }) {
  return `<div style="${baseStyle()}">${logoHeader('CareHub')}<div style="${cardStyle()}"><h2 style="color:#0f172a;margin:0 0 8px">Referral Application Update</h2><p style="color:#888;margin:0 0 24px">Dear ${esc(agentName)},</p><p style="color:#555;font-size:14px;line-height:1.7;margin-bottom:20px">Thank you for applying to join the CareHub referral programme. After reviewing your application, we were unable to approve it at this time.</p>${reasonBox(reason)}<div style="background:#FDFBF7;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px">${infoRows([['City', city], ['Area', area]])}</div><p style="color:#555;font-size:13px;line-height:1.7;margin-bottom:20px">If you believe this is an error or would like to reapply, please contact our support team at <strong>${SUPPORT_EMAIL}</strong>.</p>${supportLink}</div>${footer('CareHub', 'carefindhub.com')}</div>`
}

// Business lifecycle keys that existed in the event catalog with no renderer.
// Without these, enabling the events would produce no_template failures.
export function businessReactivated({ businessName, ownerName }) {
  return `<div style="${baseStyle()}">${logoHeader('CareHub')}<div style="${cardStyle()}"><div style="text-align:center;margin-bottom:24px"><div style="font-size:48px;margin-bottom:12px">&#8635;</div><h2 style="color:#0f172a;margin:0 0 8px">Your Account Is Active Again</h2><p style="color:#888;margin:0">Welcome back, ${esc(ownerName)}.</p></div><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:20px"><p style="margin:0;color:#166534;font-size:13px;line-height:1.7">The suspension on <strong>${esc(businessName)}</strong> has been lifted. All of your features are available again.</p></div><a href="${APP_URL}/dashboard" style="${btnStyle()}">Go to Dashboard</a></div>${footer('CareHub', 'carefindhub.com')}</div>`
}

export function businessRevoked({ businessName, ownerName, reason }) {
  return `<div style="${baseStyle()}">${logoHeader('CareHub')}<div style="${cardStyle()}"><h2 style="color:#0f172a;margin:0 0 8px">Account Access Revoked</h2><p style="color:#888;margin:0 0 24px">Dear ${esc(ownerName)},</p><p style="color:#555;font-size:14px;line-height:1.7;margin-bottom:20px">Access to <strong>${esc(businessName)}</strong> on CareHub has been revoked.${reason ? ` <strong>Reason:</strong> ${esc(reason)}` : ''}</p>${reasonBox(reason)}<p style="color:#555;font-size:13px;line-height:1.7;margin-bottom:20px">Please contact support@mail.carefindhub.com if you believe this is a mistake.</p>${supportLink}</div>${footer('CareHub', 'carefindhub.com')}</div>`
}
