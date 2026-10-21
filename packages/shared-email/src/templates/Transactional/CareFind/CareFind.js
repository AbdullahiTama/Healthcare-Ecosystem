// Every CareFind transactional email. One layout (../../layout.js), every dynamic value escaped by the html tag, every
// link built from the environment.

import { layout, html, paragraph, smallPrint, detailsTable, notice, itemsTable, siteLink } from '../../layout.js'
import { fmtDate, maskAccount } from '../../../utils/formatters.js'

const APP = 'carefind'

const email = (options) => layout({ app: APP, ...options })
const hi = (name) => `Hi ${name || 'there'},`
const IGNORE = 'If you did not ask for this, you can safely ignore this email.'

// ── Accounts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function customerRegistration({ fullName } = {}) {
  return email({
    title: `Welcome to CareFind${fullName ? `, ${fullName}` : ''}`,
    preheader: 'Your CareFind account is ready.',
    body: [
      paragraph('Your account is ready. With CareFind you can find healthcare providers near you, book appointments and consultations, and order health products.'),
    ],
    cta: { href: siteLink(APP, '/dashboard'), label: 'Open CareFind' },
  })
}

export function passwordReset({ fullName, resetLink } = {}) {
  return email({
    title: 'Reset your password',
    preheader: 'Use this link to choose a new CareFind password.',
    body: [
      paragraph(html`${hi(fullName)} we received a request to reset the password for your CareFind account. Use the button below to choose a new one.`),
      smallPrint(`For your security this link can be used once and expires soon. ${IGNORE} Your password will not change.`),
    ],
    cta: { href: resetLink, label: 'Reset password' },
    showLink: true,
  })
}

export function emailVerification({ fullName, verifyLink } = {}) {
  return email({
    title: 'Confirm your email address',
    preheader: 'Confirm your email to activate your CareFind account.',
    body: [
      paragraph(html`${hi(fullName)} please confirm that this is your email address to activate your CareFind account.`),
      smallPrint(IGNORE),
    ],
    cta: { href: verifyLink, label: 'Confirm email address' },
    showLink: true,
  })
}

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// The order page is /orders/<order id>; the order reference (CF-123456) is for people, the page cannot be opened with it.
const orderLink = (orderId) => siteLink(APP, orderId ? `/orders/${encodeURIComponent(orderId)}` : '/orders')

export function orderConfirmation({ fullName, orderId, orderRef, items, totalNaira, businessName, deliveryAddress } = {}) {
  return email({
    title: 'Your order is confirmed',
    preheader: `We have received your payment${businessName ? ` for your order from ${businessName}` : ''}.`,
    body: [
      paragraph(html`${hi(fullName)} we have received your payment. Thank you for shopping${businessName ? html` with <strong>${businessName}</strong>` : ''}.`),
      detailsTable([['Order reference', orderRef], ['Date', fmtDate(new Date().toISOString())], ['Delivery address', deliveryAddress]]),
      itemsTable(items, { totalLabel: 'Total paid', total: totalNaira == null ? null : Number(totalNaira) }),
    ],
    cta: { href: orderLink(orderId), label: 'Track your order' },
  })
}

export function purchaseConfirmed({ fullName, orderRef, items, totalNaira, businessName, deliveryAddress } = {}) {
  return email({
    title: 'Your purchase is confirmed',
    preheader: `Your order${businessName ? ` from ${businessName}` : ''} is confirmed.`,
    body: [
      paragraph(html`${hi(fullName)} your order${businessName ? html` from <strong>${businessName}</strong>` : ''} is confirmed.`),
      detailsTable([['Order reference', orderRef], ['Delivery address', deliveryAddress]]),
      itemsTable(items, { totalLabel: 'Total paid', total: totalNaira == null ? null : Number(totalNaira) }),
    ],
  })
}

const ORDER_STATUS = {
  shipped: { title: 'Your order is on its way', tone: 'info', text: 'Your order has been shipped.' },
  delivered: { title: 'Your order has been delivered', tone: 'success', text: 'Your order has been delivered.' },
  cancelled: { title: 'Your order has been cancelled', tone: 'danger', text: 'Your order has been cancelled.' },
  processing: { title: 'Your order is being prepared', tone: 'warn', text: 'Your order is being prepared.' },
  packed: { title: 'Your order is packed', tone: 'info', text: 'Your order has been packed and will be on its way soon.' },
  delivery_quoted: { title: 'Your delivery has been quoted', tone: 'info', text: 'The seller has quoted delivery for your order. Pay now to confirm it.' },
}

// The status email is queued two ways: by the app (camelCase: fullName, orderRef, orderId, businessName) and by the database trigger on
// shop_order_status_history through the reliable email catalog, whose payload schema is snake_case (recipient_name, order_reference,
// order_id, business_name). Both must render; the catalog shape used to reach this template as "Hi undefined".
export function orderStatusUpdate(payload = {}) {
  const fullName = payload.fullName ?? payload.recipient_name
  const orderId = payload.orderId ?? payload.order_id
  const orderRef = payload.orderRef ?? payload.order_reference
  const businessName = payload.businessName ?? payload.business_name
  const { status } = payload
  const state = ORDER_STATUS[status] || { title: 'An update on your order', tone: 'info', text: 'There is an update on your order.' }
  return email({
    title: state.title,
    preheader: `${state.text}${orderRef ? ` Order ${orderRef}.` : ''}`,
    body: [
      paragraph(hi(fullName)),
      notice(state.tone, state.text),
      detailsTable([['Order reference', orderRef], ['Seller', businessName]]),
    ],
    cta: { href: orderLink(orderId), label: status === 'delivery_quoted' ? 'Pay for your order' : 'View order' },
  })
}

// ── Subscriptions ────────────────────────────────────────────────────────────────────────────────────────────────────
export function subscriptionCreated({ fullName, plan, businessName, expiryDate } = {}) {
  return email({
    title: 'Your subscription is active',
    preheader: `${plan || 'Your'} subscription is now active.`,
    body: [
      paragraph(html`${hi(fullName)} your subscription is active. Thank you.`),
      detailsTable([['Plan', plan], ['Subscribed to', businessName], ['Renews or expires on', expiryDate]]),
    ],
    cta: { href: siteLink(APP, '/dashboard'), label: 'Open CareFind' },
  })
}

export function subscriptionExpiry({ fullName, plan, businessName, expiryDate, daysLeft } = {}) {
  const days = Number(daysLeft)
  const when = Number.isFinite(days) ? `in ${days} ${days === 1 ? 'day' : 'days'}` : 'soon'
  return email({
    title: 'Your subscription is about to expire',
    preheader: `Your subscription expires ${when}.`,
    body: [
      paragraph(html`${hi(fullName)} your <strong>${plan || 'CareFind'}</strong> subscription${businessName ? html` to <strong>${businessName}</strong>` : ''} expires <strong>${when}</strong>.`),
      detailsTable([['Plan', plan], ['Subscribed to', businessName], ['Expires on', expiryDate]]),
      notice('warn', 'Renew before it expires to keep your access without interruption.'),
    ],
    cta: { href: siteLink(APP, '/billing'), label: 'Renew subscription' },
  })
}

// ── Bookings, appointments and consultations ─────────────────────────────────────────────────────────────────────────
export function appointmentConfirmed({ fullName, businessName, service, date, time, staffName } = {}) {
  return email({
    title: 'Your appointment is confirmed',
    preheader: `${businessName || 'Your appointment'}${date ? ` on ${date}` : ''}${time ? ` at ${time}` : ''}.`,
    body: [
      paragraph(html`${hi(fullName)} your appointment is booked.`),
      detailsTable([['Provider', businessName], ['Service', service || 'Consultation'], ['Date', date], ['Time', time], ['With', staffName || 'To be assigned']]),
    ],
  })
}

export function bookingConfirmed({ fullName, businessName, service, date, time } = {}) {
  return email({
    title: 'Your booking is confirmed',
    preheader: `${businessName || 'Your booking'}${date ? ` on ${date}` : ''}${time ? ` at ${time}` : ''}.`,
    body: [
      paragraph(html`${hi(fullName)} your booking${businessName ? html` with <strong>${businessName}</strong>` : ''} is confirmed.`),
      detailsTable([['Facility', businessName], ['Service', service || 'Consultation'], ['Date', date], ['Time', time]]),
    ],
  })
}

export function bookingCancelled({ fullName, businessName, service, date, time } = {}) {
  return email({
    title: 'Your booking has been cancelled',
    preheader: `Your booking${businessName ? ` with ${businessName}` : ''} has been cancelled.`,
    body: [
      paragraph(html`${hi(fullName)} your booking has been cancelled.`),
      detailsTable([['Facility', businessName], ['Service', service || 'Consultation'], ['Date', date], ['Time', time]]),
      smallPrint('If you did not cancel this booking, reply to this email and our team will help.'),
    ],
  })
}

const consultationRows = ({ professionalName, service, scheduledAt }) => [['Professional', professionalName], ['Service', service], ['When', scheduledAt]]

export function consultationBooked({ fullName, professionalName, scheduledAt, service } = {}) {
  return email({
    title: 'Your consultation is booked',
    preheader: `Your consultation${professionalName ? ` with ${professionalName}` : ''} is booked.`,
    body: [
      paragraph(html`${hi(fullName)} your consultation is booked.`),
      detailsTable(consultationRows({ professionalName, service: service || 'Consultation', scheduledAt })),
    ],
  })
}

export function consultationConfirmed({ fullName, professionalName, scheduledAt, service } = {}) {
  return email({
    title: 'Your consultation is confirmed',
    preheader: `Payment received. Your consultation${professionalName ? ` with ${professionalName}` : ''} is confirmed.`,
    body: [
      paragraph(html`${hi(fullName)} we have received your payment and your session is confirmed.`),
      detailsTable(consultationRows({ professionalName, service: service || 'Consultation', scheduledAt })),
    ],
  })
}

export function consultationCancelled({ fullName, professionalName, scheduledAt } = {}) {
  return email({
    title: 'Your consultation has been cancelled',
    preheader: `Your consultation${professionalName ? ` with ${professionalName}` : ''} has been cancelled.`,
    body: [
      paragraph(html`${hi(fullName)} your consultation has been cancelled.`),
      detailsTable(consultationRows({ professionalName, scheduledAt })),
      smallPrint('If you did not cancel this consultation, reply to this email and our team will help.'),
    ],
  })
}

// ── Safety reports ────────────────────────────────────────────────────────────
// Sent by the database when a public safety report is submitted (trg_adr_reporter_receipt). The payload is
// snake_case because it comes through the email catalog. It carries the reference and the reporter's own name and
// nothing else: no product, patient, reaction or company detail ever goes into this email.
export function adrReportReceived(payload = {}) {
  const fullName = payload.fullName ?? payload.recipient_name
  const reportNumber = payload.reportNumber ?? payload.report_number
  return email({
    title: 'We received your safety report',
    preheader: `Your report reference is ${reportNumber || 'in this email'}. Keep it to check progress.`,
    body: [
      paragraph(html`${hi(fullName)} thank you for reporting a suspected side effect. Your report has been received.`),
      detailsTable([['Report number', reportNumber]]),
      paragraph('Keep this number. You can use it at any time to check where your report is.'),
      smallPrint('This email does not include the details of your report. A report does not prove that a product caused the reaction; it helps safety reviewers look for patterns. If you did not submit a report, you can safely ignore this email.'),
    ],
    cta: { href: siteLink(APP, `/track-report?ref=${encodeURIComponent(reportNumber || '')}`), label: 'Track your report' },
  })
}

// ── Payments and withdrawals ─────────────────────────────────────────────────────────────────────────────────────────
export function paymentSuccess({ fullName, amount, reference, purpose } = {}) {
  return email({
    title: 'Payment received',
    preheader: `We have received your payment${amount ? ` of ${amount}` : ''}.`,
    body: [
      paragraph(html`${hi(fullName)} we have received your payment. Thank you.`),
      detailsTable([['Amount', amount], ['For', purpose || 'Wallet top-up'], ['Reference', reference]]),
      smallPrint('Keep this email as your receipt.'),
    ],
  })
}

export function paymentFailed({ fullName, amount, reference, purpose } = {}) {
  return email({
    title: 'Your payment did not go through',
    preheader: 'We could not confirm your payment.',
    body: [
      paragraph(html`${hi(fullName)} we could not confirm your payment.`),
      detailsTable([['Amount', amount], ['For', purpose || 'Wallet top-up'], ['Reference', reference]]),
      notice('warn', 'If money left your account, it is normally returned by your bank. Reply to this email with the reference above if it is not.'),
    ],
  })
}

export function refundRequested({ fullName, amount, reference, reason } = {}) {
  return email({
    title: 'We are refunding your payment',
    preheader: 'Your refund has been requested.',
    body: [
      paragraph(html`${hi(fullName)} a refund of your payment has been requested and is being processed. We will email you again when it is complete.`),
      detailsTable([['Amount', amount], ['Reference', reference], ['Reason', reason]]),
      paragraph('You do not need to do anything. If you have questions, reply to this email and our team will help.'),
    ],
  })
}

export function refundFailed({ fullName, amount, reference } = {}) {
  return email({
    title: 'Your refund needs attention',
    preheader: 'We could not complete your refund yet.',
    body: [
      paragraph(html`${hi(fullName)} we could not complete the refund of your payment yet. Your money is safe and our team has been alerted.`),
      detailsTable([['Amount', amount], ['Reference', reference]]),
      paragraph('Reply to this email with the reference above if you do not hear from us within two working days.'),
    ],
  })
}

export function refundCompleted({ fullName, amount, reference } = {}) {
  return email({
    title: 'Your refund is complete',
    preheader: 'Your refund is on its way back to your payment method.',
    body: [
      paragraph(html`${hi(fullName)} your refund has been completed and is on its way back to your original payment method. Depending on your bank, it may take a few days to appear.`),
      detailsTable([['Amount', amount], ['Reference', reference]]),
      paragraph('If you have any questions about this refund, reply to this email and our team will help.'),
    ],
  })
}

export function withdrawalRequested({ fullName, amount, coins, reference, bankName, accountNumber } = {}) {
  return email({
    title: 'Withdrawal requested',
    preheader: 'We are processing your withdrawal.',
    body: [
      paragraph(html`${hi(fullName)} your withdrawal request has been received and is being processed.`),
      detailsTable([['You will receive', amount], ['CareCoins withdrawn', coins], ['Reference', reference], ['Bank', bankName], ['Account', maskAccount(accountNumber)]]),
      notice('warn', 'If you did not request this withdrawal, change your password and reply to this email immediately.'),
    ],
  })
}

// Sent once, only when a transfer is STILL in flight well after it was sent. Nothing for the customer to do.
export function withdrawalProcessing({ fullName, amount, reference, bankName, accountNumber } = {}) {
  return email({
    title: 'Your withdrawal is taking longer than usual',
    preheader: 'Your withdrawal is still being processed. No action is needed.',
    body: [
      paragraph(html`${hi(fullName)} your withdrawal has been sent for payment and is still being processed by the bank network. This sometimes takes longer than usual. You do not need to do anything.`),
      detailsTable([['Amount', amount], ['Reference', reference], ['Bank', bankName], ['Account', maskAccount(accountNumber)]]),
      paragraph('We will email you again when it is completed, or if it could not be completed and your CareCoins are returned.'),
    ],
  })
}

export function withdrawalCompleted({ fullName, amount, coins, reference, bankName, accountNumber } = {}) {
  return email({
    title: 'Your withdrawal has been sent',
    preheader: 'Your withdrawal has been sent to your bank.',
    body: [
      paragraph(html`${hi(fullName)} your withdrawal has been sent to your bank account. Depending on your bank, it may take a short while to appear.`),
      detailsTable([['Amount sent', amount], ['CareCoins withdrawn', coins], ['Reference', reference], ['Bank', bankName], ['Account', maskAccount(accountNumber)]]),
    ],
  })
}

export function withdrawalFailed({ fullName, amount, coins, reference } = {}) {
  return email({
    title: 'Your withdrawal could not be completed',
    preheader: 'Your withdrawal did not go through.',
    body: [
      paragraph(html`${hi(fullName)} your withdrawal could not be completed. If the amount was taken from your wallet, it has been returned.`),
      detailsTable([['Amount', amount], ['CareCoins returned to your wallet', coins], ['Reference', reference]]),
      paragraph('Please check your bank details and try again. If the problem continues, reply to this email and our team will help.'),
    ],
  })
}

// Plan D1: a credit on the user's ledger does not trace to a confirmed payment, so the
// withdrawal reservation refuses the untraceable portion. Flat numbers only - no reason codes.
export function walletNeedsAttention({ fullName, heldCoins, withdrawableCoins } = {}) {
  return email({
    title: 'Your CareCoin wallet needs attention',
    preheader: 'Part of your balance is on hold while we review it.',
    body: [
      paragraph(html`${hi(fullName)} part of your CareCoin balance cannot be traced to a confirmed payment, so it is on hold and cannot be withdrawn right now.`),
      detailsTable([['On hold', heldCoins], ['Available to withdraw', withdrawableCoins]]),
      paragraph('No money has left your wallet. If you believe this is wrong, reply to this email and our finance team will review it.'),
    ],
  })
}

// An admin reviewed the owner's saved payout account (approve or reject).
export function payoutAccountReview({ fullName, outcome, bankName, accountNumber } = {}) {
  const verified = outcome === 'verified'
  return email({
    title: verified ? 'Your payout account is verified' : 'Your payout account was not verified',
    preheader: verified ? 'Your payout account passed review.' : 'Your payout account did not pass review.',
    body: [
      paragraph(verified
        ? html`${hi(fullName)} your payout account has been reviewed and verified. Future withdrawals can be sent to it.`
        : html`${hi(fullName)} your payout account could not be verified. You can update your payout details and submit them for review again.`),
      detailsTable([['Bank', bankName], ['Account', maskAccount(accountNumber)]]),
      paragraph('If you believe this is wrong, reply to this email and our team will help.'),
    ],
  })
}

// ── Operations ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Sent to the platform administrators when the money checks find something critical (catalog event `finance_alert`; the
// payload is flat strings because the catalog schema is). `lines` is one finding per line.
export function financeAlert({ critical_count, lines, more_count } = {}) {
  const rows = String(lines || '').split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf(': ')
    return i > 0 ? [line.slice(0, i), line.slice(i + 2)] : [line, '']
  })
  const more = Number(more_count) > 0 ? Number(more_count) : 0
  return email({
    title: `${critical_count || 'Some'} critical finance finding${Number(critical_count) === 1 ? '' : 's'} need attention`,
    preheader: 'The money checks found something that needs a decision.',
    body: [
      paragraph('The automatic money checks found a difference between our books, the payment engines and Paystack. Nothing has been changed automatically: a person needs to look.'),
      detailsTable(rows),
      ...(more ? [paragraph(`…and ${more} more in the admin panel.`)] : []),
      notice('warn', 'You will be reminded once a day while a finding stays open. Acknowledge it in the admin panel to stop the reminders, or dismiss it with a note if it is explained.'),
    ],
    cta: { href: siteLink(APP, '/admin-panel'), label: 'Open Money Checks' },
    reason: 'You are receiving this email because you are a CareFind administrator.',
  })
}

// ── Referral agents ──────────────────────────────────────────────────────────────────────────────────────────────────
export function referralAgentApproved({ agentName, agentEmail, referralCode } = {}) {
  return email({
    title: 'Your application is approved',
    preheader: 'Welcome to the CareFind referral programme.',
    body: [
      paragraph(html`${hi(agentName)} your referral agent application has been approved. Welcome to the programme.`),
      detailsTable([['Referral code', referralCode], ['Email', agentEmail]]),
    ],
  })
}

export function referralAgentRejected({ agentName, reason } = {}) {
  return email({
    title: 'An update on your application',
    preheader: 'An update on your CareFind referral application.',
    body: [
      paragraph(html`${hi(agentName)} thank you for your interest in the CareFind referral programme. After review, we are unable to approve your application at this time.`),
      reason ? notice('danger', html`<strong>Reason:</strong> ${reason}`) : '',
    ],
  })
}
