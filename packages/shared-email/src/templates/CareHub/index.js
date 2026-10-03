// Centralized CareHub transactional templates.
// One layout, one brand, every dynamic value escaped, every URL from the
// environment. Subjects live in SUBJECTS so call sites stay consistent.

import { esc, baseStyle, cardStyle, btnStyle, logoHeader, footer } from '../Transactional/BaseTemplate.js'

export const CAREHUB_APP_URL =
  (typeof process !== 'undefined' && process.env?.CAREHUB_APP_URL) ||
  (typeof process !== 'undefined' && process.env?.APP_URL) ||
  'https://carefindhub.com'

export const SUBJECTS = {
  registration_owner: 'CareHub: registration received',
  admin_new_registration: 'CareHub: new business registration pending review',
  business_approved: 'CareHub: your business has been approved',
  business_rejected: 'CareHub: application update',
  appointment_confirmed: 'CareHub: your appointment is confirmed',
  credit_reminder: 'CareHub: payment reminder',
  staff_welcome: 'CareHub: you have been invited',
  agent_approved: 'CareHub: referral agent application approved',
  agent_rejected: 'CareHub: referral agent application update',
}

function layout({ preheader, title, bodyHtml, cta }) {
  return `<!doctype html><html><body style="${baseStyle()}"><span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(preheader)}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td>${logoHeader('CareHub')}</td></tr><tr><td style="${cardStyle()}">${bodyHtml}</td></tr>${cta ? `<tr><td align="center" style="padding:24px 0 0"><a href="${esc(cta.href)}" style="${btnStyle()}">${esc(cta.label)}</a></td></tr>` : ''}<tr><td>${footer('CareHub', 'carefindhub.com')}</td></tr></table></td></tr></table></body></html>`
}

function detailsTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows.map(([l, v]) => `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;font-weight:600;width:40%">${esc(l)}</td><td style="padding:6px 0;color:#0f172a;font-size:13px">${v}</td></tr>`).join('')}</table>`
}

function notice({ tone, text }) {
  const palette = { info: ['#eff6ff', '#bfdbfe', '#1d4ed8'], warn: ['#fffbeb', '#fcd34d', '#92400e'], danger: ['#fef2f2', '#fecaca', '#dc2626'], success: ['#ecfdf5', '#a7f3d0', '#065f46'] }[tone || 'info']
  return `<div style="background:${palette[0]};border:1px solid ${palette[1]};border-radius:12px;padding:14px 16px;margin:0 0 16px"><p style="margin:0;color:${palette[2]};font-size:13px;line-height:1.6">${text}</p></div>`
}

const appUrl = (path = '') => `${CAREHUB_APP_URL}${path}`

export function registrationOwner({ businessName, ownerName } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Registration Received</h2>
<p style="color:#52525b;font-size:14px;line-height:1.7">Hi ${esc(ownerName || 'there')}, thanks for registering <strong>${esc(businessName || 'your business')}</strong>.</p>
${notice({ tone: 'info', text: 'Your application is under review. You will hear from us within 24 hours.' })}
<p style="color:#71717a;font-size:13px">You can sign in now to check your status.</p>`
  return layout({ preheader: 'We received your CareHub registration.', bodyHtml: body, cta: { href: appUrl('/login'), label: 'Go to Sign In' } })
}

export function adminNewRegistration({ businessName, ownerName, businessType, state, email } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">New Business Registration</h2>
<p style="color:#52525b;font-size:14px;line-height:1.7">A new business is waiting for review.</p>
${detailsTable([['Business Name', esc(businessName)], ['Owner', esc(ownerName)], ['Business Type', esc(businessType)], ['State', esc(state)], ['Email', esc(email)]])}
${notice({ tone: 'warn', text: 'Pending approval. Open the admin panel to review.' })}`
  return layout({ preheader: 'A new business needs your review.', bodyHtml: body, cta: { href: appUrl('/login'), label: 'Open Admin Panel' } })
}

export function businessApproved({ businessName, ownerName, ownerEmail } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Your Account is Approved!</h2>
${notice({ tone: 'success', text: `${esc(businessName || 'Your business')} is now live on CareHub.` })}
${detailsTable([['Website', esc(CAREHUB_APP_URL)], ['Email', esc(ownerEmail)], ['Password', 'The password you set during registration']])}`
  return layout({ preheader: 'Welcome to CareHub.', bodyHtml: body, cta: { href: appUrl('/login'), label: 'Log In to Dashboard' } })
}

export function businessRejected({ businessName, ownerName, reason } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Application Update</h2>
<p style="color:#52525b;font-size:14px;line-height:1.7">Dear ${esc(ownerName || 'there')}, thank you for registering <strong>${esc(businessName || 'your business')}</strong>. We were unable to approve this application at this time.</p>
${reason ? notice({ tone: 'danger', text: `Reason: ${esc(reason)}` }) : ''}`
  return layout({ preheader: 'An update on your CareHub application.', bodyHtml: body, cta: { href: appUrl('/login'), label: 'Contact Support' } })
}

export function appointmentConfirmed({ fullName, businessName, service, date, time, staffName } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Appointment Confirmed</h2>
<p style="color:#52525b;font-size:14px">Hi ${esc(fullName || 'there')}, your appointment is booked.</p>
${detailsTable([['Business', esc(businessName)], ['Service', esc(service || 'Consultation')], ['Date', esc(date)], ['Time', esc(time)], ['Staff', esc(staffName || 'To be assigned')]])}`
  return layout({ preheader: 'Your appointment is confirmed.', bodyHtml: body, cta: { href: appUrl('/dashboard'), label: 'View Appointment' } })
}

export function creditReminder({ clientName, businessName, amount, dueDate } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Payment Reminder</h2>
<p style="color:#52525b;font-size:14px;line-height:1.7">Hi ${esc(clientName || 'there')}, you have an outstanding balance of <strong>${esc(amount || '')}</strong>${businessName ? ` at <strong>${esc(businessName)}</strong>` : ''}${dueDate ? `, due ${esc(dueDate)}` : ''}.</p>
${notice({ tone: 'warn', text: 'Please contact the business to settle your account.' })}`
  return layout({ preheader: 'You have an outstanding balance.', bodyHtml: body })
}

export function staffWelcome({ fullName, role, businessName, setupLink } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">You're Invited to Join ${esc(businessName || 'CareHub')}</h2>
<p style="color:#52525b;font-size:14px">Hi ${esc(fullName || 'there')}, you've been added as <strong>${esc(role || 'a team member')}</strong>.</p>
${notice({ tone: 'info', text: 'Use the button below to set up your account. This link expires in 48 hours.' })}`
  return layout({ preheader: 'Set up your CareHub account.', bodyHtml: body, cta: { href: setupLink || appUrl('/login'), label: 'Set Up Your Account' } })
}

export function agentApproved({ agentName, agentEmail, referralCode, city, area } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Application Approved</h2>
<p style="color:#52525b;font-size:14px">Hi ${esc(agentName || 'there')}, your referral agent application has been approved.</p>
${detailsTable([['Email', esc(agentEmail)], ['Referral Code', esc(referralCode)], ['Coverage', esc([city, area].filter(Boolean).join(', '))]])}`
  return layout({ preheader: 'Welcome to the CareHub referral program.', bodyHtml: body, cta: { href: appUrl('/login'), label: 'Get Started' } })
}

export function agentRejected({ agentName, reason } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Application Update</h2>
<p style="color:#52525b;font-size:14px">Hi ${esc(agentName || 'there')}, thank you for your interest. We are unable to approve your application at this time.</p>
${reason ? notice({ tone: 'danger', text: `Reason: ${esc(reason)}` }) : ''}`
  return layout({ preheader: 'An update on your CareHub application.', bodyHtml: body })
}


export function withdrawalRequested({ businessName, amount, reference, bankName, accountNumber } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Withdrawal Requested</h2>
<p style="color:#52525b;font-size:14px">A withdrawal was requested from your CareHub business wallet.</p>
${detailsTable([['Business', esc(businessName)], ['Amount', esc(amount)], ['Reference', esc(reference)], ['Bank', esc(bankName)], ['Account', esc(accountNumber)]])}`
  return layout({ preheader: 'Your CareHub withdrawal request.', bodyHtml: body })
}

export function withdrawalCompleted({ businessName, amount, reference, bankName, accountNumber } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Withdrawal Settled</h2>
<p style="color:#52525b;font-size:14px">Your business withdrawal has been sent.</p>
${detailsTable([['Business', esc(businessName)], ['Amount', esc(amount)], ['Reference', esc(reference)], ['Bank', esc(bankName)], ['Account', esc(accountNumber)]])}`
  return layout({ preheader: 'Your CareHub withdrawal was settled.', bodyHtml: body })
}

export function withdrawalFailed({ businessName, amount, reference } = {}) {
  const body = `<h2 style="color:#0f172a;margin:0 0 8px">Withdrawal Failed</h2>
<p style="color:#52525b;font-size:14px">Your CareHub business withdrawal could not be completed.</p>
${detailsTable([['Business', esc(businessName)], ['Amount', esc(amount)], ['Reference', esc(reference)]])}`
  return layout({ preheader: 'Your CareHub withdrawal failed.', bodyHtml: body })
}
