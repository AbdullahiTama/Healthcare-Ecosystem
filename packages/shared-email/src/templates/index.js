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

// Build registry with snake_case keys, CareHub first then CareFind (Find overrides shared keys)
export const TEMPLATE_REGISTRY = {
  ...Object.fromEntries(Object.entries(HubTemplates).map(([name, fn]) => [HUB_TEMPLATE_MAP[name] || name, fn])),
  ...Object.fromEntries(Object.entries(FindTemplates).map(([name, fn]) => [FIND_TEMPLATE_MAP[name] || name, fn])),
}

// Also export by original function names for backward compatibility
export const CAREHUB_TEMPLATES = HubTemplates
export const CAREFIND_TEMPLATES = FindTemplates

export function getTemplate(templateKey) {
  return TEMPLATE_REGISTRY[templateKey] || null
}
