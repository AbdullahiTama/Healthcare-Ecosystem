import * as HubTemplates from './Transactional/index.js'
import * as FindTemplates from './Transactional/CareFind/index.js'

// Map camelCase function names to snake_case keys used in the database
const HUB_TEMPLATE_MAP = {
  customerRegistration: 'registration_owner',
  adminNewRegistration: 'admin_new_registration',
  businessApproved: 'business_approved',
  businessRejected: 'business_rejected',
  businessSuspended: 'business_suspended',
  businessStatusUpdate: 'business_status_update',
  staffWelcome: 'staff_welcome',
  subscriptionCreated: 'subscription_created',
  subscriptionExpiry: 'subscription_expiry',
  purchaseConfirmed: 'purchase_confirmed',
  orderStatusUpdate: 'order_status_update',
  appointmentConfirmed: 'appointment_confirmed',
  passwordReset: 'password_reset',
  emailVerification: 'email_verification',
  agentApproved: 'agent_approved',
  agentRejected: 'agent_rejected',
  businessReactivated: 'business_reactivated',
  businessRevoked: 'business_revoked',
}

const FIND_TEMPLATE_MAP = {
  customerRegistration: 'customer_registration',
  orderConfirmation: 'order_confirmation',
  subscriptionCreated: 'subscription_created',
  subscriptionExpiry: 'subscription_expiry',
  purchaseConfirmed: 'purchase_confirmed',
  passwordReset: 'password_reset',
  emailVerification: 'email_verification',
  appointmentConfirmed: 'appointment_confirmed',
  orderStatusUpdate: 'order_status_update',
  bookingConfirmed: 'booking_confirmed',
}

// Build per-app key tables so CareHub and CareFind each resolve their OWN
// branded implementation for shared keys (password_reset, email_verification,
// subscription_created, subscription_expiry, purchase_confirmed,
// order_status_update, appointment_confirmed, ...).
const HUB_BY_KEY = Object.fromEntries(Object.entries(HubTemplates).map(([name, fn]) => [HUB_TEMPLATE_MAP[name] || name, fn]))
const FIND_BY_KEY = Object.fromEntries(Object.entries(FindTemplates).map(([name, fn]) => [FIND_TEMPLATE_MAP[name] || name, fn]))

// Merged registry, CareFind preferred for shared keys — kept for preview /
// listing tools where a single non-app-scoped view is needed.
export const TEMPLATE_REGISTRY = { ...HUB_BY_KEY, ...FIND_BY_KEY }

// Per-app key lists, so tooling (the delivery-contract guard, the
// subject-completeness ratchet) can enumerate what actually resolves without
// reaching into the maps.
export const TEMPLATE_KEYS = {
  carehub: Object.keys(HUB_BY_KEY),
  carefind: Object.keys(FIND_BY_KEY),
}

// Also export by original function names for backward compatibility
export const CAREHUB_TEMPLATES = HubTemplates
export const CAREFIND_TEMPLATES = FindTemplates

// Resolve the template for a key and the app that enqueued it.
//
// Fails closed. This deliberately does NOT fall back to the merged registry:
// TEMPLATE_REGISTRY prefers CareFind, so a CareHub event whose CareHub
// template is missing used to resolve to the CareFind renderer and quietly
// mail the wrong brand. A missing template must surface as a failed row, not
// as a mislabelled email. Callers treat null as a hard error.
export function getTemplate(templateKey, app = 'carefind') {
  const byKey = app === 'carehub' ? HUB_BY_KEY : FIND_BY_KEY
  return byKey[templateKey] || null
}

// Canonical subject per key, per app. Subjects are part of the contract: they
// carry the brand and the action, and they used to arrive from the request body
// of whichever endpoint happened to enqueue the row. Producers that omit a
// subject (the referral helpers did) produced rows with subject = '', which went
// out as a subject-less email. The subject now lives beside the renderer, so
// the endpoint cannot inject or drop it.
const HUB_SUBJECTS = {
  registration_owner: 'Welcome to CareHub, {{fullName}}',
  admin_new_registration: 'New {{businessType}} registration from {{businessName}}',
  business_approved: '{{businessName}} has been approved',
  business_rejected: 'Update on your {{businessName}} application',
  business_suspended: '{{businessName}} account suspended',
  business_reactivated: '{{businessName}} is active again',
  business_revoked: 'Access revoked for {{businessName}}',
  business_status_update: 'Update on your {{businessName}} application',
  staff_welcome: "You're invited to join {{businessName}}",
  agent_approved: 'You are approved, {{agentName}}',
  agent_rejected: 'Referral application update',
  subscription_created: 'Your {{plan}} plan for {{businessName}} is active',
  subscription_expiry: 'Your {{plan}} plan for {{businessName}} expires soon',
  purchase_confirmed: 'Purchase confirmed',
  order_status_update: 'Order {{orderRef}} is {{status}}',
  appointment_confirmed: 'Your appointment at {{businessName}} is confirmed',
  password_reset: 'Reset your password',
  email_verification: 'Verify your email',
}

const FIND_SUBJECTS = {
  customer_registration: 'Welcome to CareFind, {{fullName}}',
  order_confirmation: 'Order confirmed - {{orderRef}}',
  subscription_created: 'Your {{plan}} plan is active',
  subscription_expiry: 'Your {{plan}} plan expires soon',
  purchase_confirmed: 'Purchase confirmed',
  password_reset: 'Reset your password',
  email_verification: 'Verify your email',
  appointment_confirmed: 'Your appointment is confirmed',
  order_status_update: 'Order {{orderRef}} is {{status}}',
  booking_confirmed: 'Your booking is confirmed',
}

// Strip anything that could break a single-line subject. Payload values are
// business-supplied, and a newline in a subject is a header-injection risk
// against the provider API, not just a cosmetic bug.
export function sanitizeSubjectPart(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

function renderSubject(template, payload = {}) {
  return String(template)
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => sanitizeSubjectPart(payload?.[key]))
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Returns '' when the key has no canonical subject. Callers treat that as a
// hard failure rather than mailing an empty subject line.
export function getSubject(templateKey, app = 'carefind', payload = {}) {
  const byKey = app === 'carehub' ? HUB_SUBJECTS : FIND_SUBJECTS
  const template = byKey[templateKey]
  if (!template) return ''
  return renderSubject(template, payload)
}
