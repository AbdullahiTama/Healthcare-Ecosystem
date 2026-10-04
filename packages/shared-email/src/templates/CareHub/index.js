// Every CareHub transactional email. One layout (../layout.js), every dynamic value escaped by the html tag, every
// link built from the environment. Subjects live in SUBJECTS so call sites stay consistent.

import { layout, html, paragraph, smallPrint, detailsTable, notice, itemsTable, siteLink, brandFor } from '../layout.js'

const APP = 'carehub'

export const CAREHUB_APP_URL = brandFor(APP).siteUrl

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

const email = (options) => layout({ app: APP, ...options })
const hi = (name) => `Hi ${name || 'there'},`
const IGNORE = 'If you did not ask for this, you can safely ignore this email.'

// ── Registration and review ──────────────────────────────────────────────────────────────────────────────────────────
export function registrationOwner({ businessName, ownerName, fullName, email: address } = {}) {
  return email({
    title: 'We have received your registration',
    preheader: 'Your CareHub application is under review.',
    body: [
      paragraph(html`${hi(ownerName || fullName)} thank you for registering <strong>${businessName || 'your business'}</strong> on CareHub.`),
      notice('info', html`Your application is <strong>under review</strong>. We will email you as soon as a decision is made, usually within 24 hours.`),
      detailsTable([['Business', businessName], ['Account email', address]]),
      smallPrint('You can sign in at any time to check the status of your application.'),
    ],
    cta: { href: siteLink(APP, '/login'), label: 'Sign in to CareHub' },
  })
}

export function adminNewRegistration({ businessName, ownerName, businessType, state, email: address } = {}) {
  return email({
    title: 'New business registration',
    preheader: `${businessName || 'A new business'} is waiting for review.`,
    body: [
      paragraph('A new business has registered and is waiting for your review.'),
      detailsTable([['Business name', businessName], ['Owner', ownerName], ['Business type', businessType], ['State', state], ['Email', address]]),
      notice('warn', 'This business cannot use CareHub until it is approved.'),
    ],
    cta: { href: siteLink(APP, '/login'), label: 'Open the admin panel' },
    reason: 'You are receiving this email because you are a CareHub administrator.',
  })
}

export function businessApproved({ businessName, ownerName, ownerEmail } = {}) {
  return email({
    title: 'Your business is approved',
    preheader: `${businessName || 'Your business'} is now live on CareHub.`,
    body: [
      paragraph(html`${hi(ownerName)} welcome to CareHub.`),
      notice('success', html`<strong>${businessName || 'Your business'}</strong> is now live on CareHub.`),
      paragraph('You can now sign in and use point of sale, inventory, client management and your CareFind listing.'),
      detailsTable([['Sign in at', CAREHUB_APP_URL], ['Email', ownerEmail], ['Password', 'The password you chose when you registered']]),
    ],
    cta: { href: siteLink(APP, '/login'), label: 'Go to your dashboard' },
  })
}

export function businessRejected({ businessName, ownerName, reason } = {}) {
  return email({
    title: 'An update on your application',
    preheader: 'An update on your CareHub application.',
    body: [
      paragraph(html`${hi(ownerName)} thank you for registering <strong>${businessName || 'your business'}</strong> on CareHub. After reviewing your application, we are unable to approve it at this time.`),
      reason ? notice('danger', html`<strong>Reason:</strong> ${reason}`) : '',
      paragraph('If you believe this is a mistake, or you would like to apply again, reply to this email and our team will help.'),
    ],
  })
}

export function businessSuspended({ businessName, ownerName, reason } = {}) {
  return email({
    title: 'Your account has been suspended',
    preheader: 'Your CareHub business account has been suspended.',
    body: [
      paragraph(html`${hi(ownerName)} your business <strong>${businessName || 'account'}</strong> has been suspended on CareHub.`),
      reason ? notice('danger', html`<strong>Reason:</strong> ${reason}`) : '',
      paragraph('If you have questions, or believe this is a mistake, reply to this email and our team will help.'),
    ],
  })
}

export function businessStatusUpdate({ businessName, ownerName, ownerEmail, status, reason } = {}) {
  if (status === 'active') return businessApproved({ businessName, ownerName, ownerEmail })
  if (status === 'rejected') return businessRejected({ businessName, ownerName, reason })
  if (status === 'suspended') return businessSuspended({ businessName, ownerName, reason })
  return email({
    title: 'Your application needs attention',
    preheader: 'Action is needed on your CareHub application.',
    body: [
      paragraph(html`${hi(ownerName)} your application for <strong>${businessName || 'your business'}</strong> needs your attention before we can continue.`),
      reason ? notice('warn', html`<strong>Details:</strong> ${reason}`) : '',
      paragraph('Sign in to see what is needed, or reply to this email for help.'),
    ],
    cta: { href: siteLink(APP, '/login'), label: 'Sign in to CareHub' },
  })
}

// ── Accounts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function staffWelcome({ fullName, role, businessName, setupLink } = {}) {
  return email({
    title: `You have been invited to join ${businessName || 'a business on CareHub'}`,
    preheader: 'Set up your CareHub account.',
    body: [
      paragraph(html`${hi(fullName)} you have been added as <strong>${role || 'a team member'}</strong>${businessName ? html` at <strong>${businessName}</strong>` : ''} on CareHub.`),
      paragraph('Use the button below to choose your password and finish setting up your account.'),
      smallPrint('For your security this link can be used once and expires soon. If you were not expecting this invitation, you can safely ignore this email.'),
    ],
    cta: { href: setupLink || siteLink(APP, '/login'), label: 'Set up your account' },
    showLink: Boolean(setupLink),
  })
}

export function passwordReset({ fullName, resetLink } = {}) {
  return email({
    title: 'Reset your password',
    preheader: 'Use this link to choose a new CareHub password.',
    body: [
      paragraph(html`${hi(fullName)} we received a request to reset the password for your CareHub account. Use the button below to choose a new one.`),
      smallPrint(`For your security this link can be used once and expires soon. ${IGNORE} Your password will not change.`),
    ],
    cta: { href: resetLink, label: 'Reset password' },
    showLink: true,
  })
}

export function emailVerification({ fullName, verifyLink } = {}) {
  return email({
    title: 'Confirm your email address',
    preheader: 'Confirm your email to finish setting up CareHub.',
    body: [
      paragraph(html`${hi(fullName)} please confirm that this is your email address so we can finish setting up your CareHub account.`),
      smallPrint(IGNORE),
    ],
    cta: { href: verifyLink, label: 'Confirm email address' },
    showLink: true,
  })
}

// ── Subscriptions ────────────────────────────────────────────────────────────────────────────────────────────────────
export function subscriptionCreated({ fullName, plan, businessName, expiryDate } = {}) {
  return email({
    title: 'Your subscription is active',
    preheader: `${plan || 'Your'} plan is now active.`,
    body: [
      paragraph(html`${hi(fullName)} your CareHub subscription is active. Thank you.`),
      detailsTable([['Plan', plan], ['Business', businessName], ['Renews or expires on', expiryDate]]),
    ],
    cta: { href: siteLink(APP, '/dashboard'), label: 'Go to your dashboard' },
  })
}

export function subscriptionExpiry({ fullName, plan, businessName, expiryDate, daysLeft } = {}) {
  const days = Number(daysLeft)
  const when = Number.isFinite(days) ? `in ${days} ${days === 1 ? 'day' : 'days'}` : 'soon'
  return email({
    title: 'Your subscription is about to expire',
    preheader: `Your CareHub plan expires ${when}.`,
    body: [
      paragraph(html`${hi(fullName)} the <strong>${plan || 'CareHub'}</strong> plan${businessName ? html` for <strong>${businessName}</strong>` : ''} expires <strong>${when}</strong>.`),
      detailsTable([['Plan', plan], ['Business', businessName], ['Expires on', expiryDate]]),
      notice('warn', 'Renew before it expires to keep using CareHub without interruption.'),
    ],
    cta: { href: siteLink(APP, '/billing'), label: 'Renew subscription' },
  })
}

// ── Orders, appointments and reminders ───────────────────────────────────────────────────────────────────────────────
export function purchaseConfirmed({ fullName, orderRef, items, totalNaira, businessName, deliveryAddress } = {}) {
  return email({
    title: 'Your purchase is confirmed',
    preheader: `Your order${businessName ? ` from ${businessName}` : ''} is confirmed.`,
    body: [
      paragraph(html`${hi(fullName)} thank you for shopping${businessName ? html` with <strong>${businessName}</strong>` : ''}. Here is your receipt.`),
      detailsTable([['Order reference', orderRef], ['Delivery address', deliveryAddress]]),
      itemsTable(items, { total: totalNaira == null ? null : Number(totalNaira) }),
    ],
    reason: 'You are receiving this email because you made a purchase from a business that uses CareHub.',
  })
}

const ORDER_STATUS = {
  shipped: { title: 'Your order is on its way', tone: 'info', text: 'Your order has been shipped.' },
  delivered: { title: 'Your order has been delivered', tone: 'success', text: 'Your order has been delivered.' },
  cancelled: { title: 'Your order has been cancelled', tone: 'danger', text: 'Your order has been cancelled.' },
  processing: { title: 'Your order is being prepared', tone: 'warn', text: 'Your order is being prepared.' },
}

export function orderStatusUpdate({ fullName, orderRef, status, businessName } = {}) {
  const state = ORDER_STATUS[status] || { title: 'An update on your order', tone: 'info', text: 'There is an update on your order.' }
  return email({
    title: state.title,
    preheader: `${state.text}${orderRef ? ` Order ${orderRef}.` : ''}`,
    body: [
      paragraph(hi(fullName)),
      notice(state.tone, state.text),
      detailsTable([['Order reference', orderRef], ['Business', businessName]]),
    ],
    cta: orderRef ? { href: siteLink(APP, `/orders/${encodeURIComponent(orderRef)}`), label: 'View order' } : undefined,
    reason: 'You are receiving this email because you made a purchase from a business that uses CareHub.',
  })
}

export function appointmentConfirmed({ fullName, businessName, service, date, time, staffName } = {}) {
  return email({
    title: 'Your appointment is confirmed',
    preheader: `${businessName || 'Your appointment'}${date ? ` on ${date}` : ''}${time ? ` at ${time}` : ''}.`,
    body: [
      paragraph(html`${hi(fullName)} your appointment has been booked.`),
      detailsTable([['Business', businessName], ['Service', service || 'Consultation'], ['Date', date], ['Time', time], ['With', staffName || 'To be assigned']]),
      smallPrint('If you need to change or cancel, please contact the business directly.'),
    ],
    reason: 'You are receiving this email because an appointment was booked for you with a business that uses CareHub.',
  })
}

export function creditReminder({ clientName, businessName, amount, dueDate } = {}) {
  return email({
    title: 'Payment reminder',
    preheader: 'You have an outstanding balance.',
    body: [
      paragraph(html`${hi(clientName)} this is a friendly reminder that you have an outstanding balance${businessName ? html` with <strong>${businessName}</strong>` : ''}.`),
      detailsTable([['Amount due', amount], ['Due date', dueDate], ['Business', businessName]]),
      paragraph('Please contact the business to settle your account. If you have already paid, you can ignore this email.'),
    ],
    reason: 'You are receiving this email because a business that uses CareHub has an account in your name.',
  })
}

// ── Referral agents ──────────────────────────────────────────────────────────────────────────────────────────────────
export function agentApproved({ agentName, agentEmail, referralCode, city, area } = {}) {
  return email({
    title: 'Your application is approved',
    preheader: 'Welcome to the CareHub referral programme.',
    body: [
      paragraph(html`${hi(agentName)} your referral agent application has been approved. Welcome to the programme.`),
      detailsTable([['Referral code', referralCode], ['Email', agentEmail], ['Coverage', [city, area].filter(Boolean).join(', ')]]),
      smallPrint('Questions? Reply to this email and we will help.'),
    ],
    cta: { href: siteLink(APP, '/login'), label: 'Get started' },
  })
}

export function agentRejected({ agentName, reason } = {}) {
  return email({
    title: 'An update on your application',
    preheader: 'An update on your CareHub referral application.',
    body: [
      paragraph(html`${hi(agentName)} thank you for your interest in the CareHub referral programme. After review, we are unable to approve your application at this time.`),
      reason ? notice('danger', html`<strong>Reason:</strong> ${reason}`) : '',
    ],
  })
}

// ── Withdrawals ──────────────────────────────────────────────────────────────────────────────────────────────────────
const withdrawalRows = ({ businessName, amount, reference, bankName, accountNumber }) =>
  [['Business', businessName], ['Amount', amount], ['Reference', reference], ['Bank', bankName], ['Account', accountNumber]]

export function withdrawalRequested(payload = {}) {
  return email({
    title: 'Withdrawal requested',
    preheader: 'We are processing your withdrawal.',
    body: [
      paragraph('A withdrawal was requested from your CareHub business wallet and is being processed.'),
      detailsTable(withdrawalRows(payload)),
      notice('warn', 'If you did not request this withdrawal, reply to this email immediately.'),
    ],
  })
}

export function withdrawalCompleted(payload = {}) {
  return email({
    title: 'Your withdrawal has been sent',
    preheader: 'Your CareHub withdrawal has been sent to your bank.',
    body: [
      paragraph('Your withdrawal has been sent to your bank account. Depending on your bank, it may take a short while to appear.'),
      detailsTable(withdrawalRows(payload)),
    ],
  })
}

export function withdrawalFailed(payload = {}) {
  return email({
    title: 'Your withdrawal could not be completed',
    preheader: 'Your CareHub withdrawal did not go through.',
    body: [
      notice('danger', 'Your withdrawal could not be completed.'),
      detailsTable(withdrawalRows(payload)),
      paragraph('Please check your bank details and try again. If the problem continues, reply to this email and our team will help.'),
    ],
  })
}
