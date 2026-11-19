// Notification tab categories (issue #4). Pure mapping so the bell's tabs and
// any future digest share one source of truth for which kind lands where.

export const NOTIFICATION_CATEGORIES = ['appointments', 'inventory', 'social', 'general']

const KIND_TO_CATEGORY = {
  // Appointments
  booking_created: 'appointments',
  booking_confirmed: 'appointments',
  booking_paid: 'appointments',
  // Inventory & expiry
  product_expiring_soon: 'inventory',
  product_expired: 'inventory',
  low_stock: 'inventory',
  out_of_stock: 'inventory',
  sales_velocity: 'inventory',
  // CareFind social
  contact_lead: 'social',
  review_created: 'social',
}

/**
 * Maps a staff_notifications.kind to its tab category. Unknown kinds —
 * including anything added server-side later — fall back to 'general' so a
 * new kind can never strand its notifications outside every tab.
 */
export function categoryForKind(kind) {
  return KIND_TO_CATEGORY[kind] || 'general'
}

/**
 * The in-app path a notification opens. Links come in two shapes: a dashboard
 * section ('inventory', 'orders') written by CareHub itself, and a full path
 * ('/dashboard/ecommerce/orders/<id>') written by the database functions and
 * the payment effects. Prefixing the full ones again produced
 * '/dashboard//dashboard/...', which matched no route and dropped the vendor
 * on the dashboard home instead of the order.
 */
export function notificationPath(link) {
  const value = String(link || '').trim()
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value
  return '/dashboard/' + value.replace(/^\/+/, '')
}

// Where each owner stock alert opens: its own breakdown in Stock Management (the products, quantities and dates
// behind the notification), whatever link an older copy of the notification was stored with (sales velocity used to
// open the general Reports page).
export const ALERT_PATHS = {
  sales_velocity: '/dashboard/inventory?tab=velocity',
  product_expiring_soon: '/dashboard/inventory?tab=expiry&expiry=expiring',
  product_expired: '/dashboard/inventory?tab=expiry&expiry=expired',
}

/** The in-app path a notification opens: its kind's breakdown when it has one, else its stored link. */
export function notificationTarget(n) {
  return ALERT_PATHS[n?.kind] || notificationPath(n?.link)
}
