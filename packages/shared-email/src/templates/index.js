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
  creditReminder: 'credit_reminder',
  agentApproved: 'agent_approved',
  agentRejected: 'agent_rejected',
  withdrawalRequested: 'withdrawal_requested',
  withdrawalCompleted: 'withdrawal_completed',
  withdrawalFailed: 'withdrawal_failed',
  withdrawalPinOtp: 'withdrawal_pin_otp',
  businessWalletTopup: 'business_wallet_topup',
  refundCompleted: 'refund_completed',
  payoutAccountReview: 'payout_account_review',
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
  bookingCancelled: 'booking_cancelled',
  consultationBooked: 'consultation_booked',
  consultationConfirmed: 'consultation_confirmed',
  consultationCancelled: 'consultation_cancelled',
  paymentSuccess: 'payment_success',
  paymentFailed: 'payment_failed',
  withdrawalRequested: 'withdrawal_requested',
  withdrawalCompleted: 'withdrawal_completed',
  withdrawalFailed: 'withdrawal_failed',
  withdrawalPinOtp: 'withdrawal_pin_otp',
  walletNeedsAttention: 'wallet_needs_attention',
  refundCompleted: 'refund_completed',
  payoutAccountReview: 'payout_account_review',
  referralAgentApproved: 'referral_agent_approved',
  referralAgentRejected: 'referral_agent_rejected',
  financeAlert: 'finance_alert',
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

// Resolve the template for a key and the app that enqueued it.
//
// Fails closed. This deliberately does NOT fall back to the merged registry:
// TEMPLATE_REGISTRY prefers CareFind, so a CareHub event whose CareHub
// template is missing used to resolve to the CareFind renderer and quietly
// mail the wrong brand. A missing template must surface as a failed row, not
// as a mislabelled email. Callers treat null as a hard error.
export function getTemplate(templateKey, app = 'carefind') {
  const byKey = app === 'carehub' ? HUB_BY_KEY : FIND_BY_KEY
  // Own keys only: byKey is a plain object, so 'constructor' or 'toString' would otherwise resolve to something on
  // Object.prototype and be 'rendered' instead of failing the row.
  if (typeof templateKey !== 'string' || !Object.hasOwn(byKey, templateKey)) return null
  return byKey[templateKey] || null
}
