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

// Also export by original function names for backward compatibility
export const CAREHUB_TEMPLATES = HubTemplates
export const CAREFIND_TEMPLATES = FindTemplates

// Resolve the template for a key and the app that enqueued it. An app-specific
// implementation always wins; unknown keys fall back to the merged registry so
// keys only one app defines still resolve.
export function getTemplate(templateKey, app = 'carefind') {
  const byKey = app === 'carehub' ? HUB_BY_KEY : FIND_BY_KEY
  return byKey[templateKey] || TEMPLATE_REGISTRY[templateKey] || null
}
