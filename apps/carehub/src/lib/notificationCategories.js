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
