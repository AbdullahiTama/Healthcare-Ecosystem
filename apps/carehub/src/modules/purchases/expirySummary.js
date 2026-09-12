// Pure helper so the earliest-expiry/batch aggregation is unit-testable
// outside the React component's save() handler. Items with an empty expiry or
// batch are ignored; a purchase with none of either stores nulls, matching the
// purchases table's nullable expiry/batch columns.
export const EXPIRY_NOTIFICATION_DAYS = 30

export function purchaseExpirySummary(items = []) {
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
  const rows = items.filter(Boolean)
  const expiries = rows.map((i) => i.expiry).filter(nonEmpty)
  const batches = [...new Set(rows.map((i) => (typeof i.batch === 'string' ? i.batch.trim() : '')).filter(nonEmpty))]
  return {
    expiry: expiries.length > 0 ? expiries.reduce((a, b) => (a < b ? a : b)) : null,
    batch: batches.length > 0 ? batches.join(', ') : null,
  }
}

/**
 * Calculates days until expiry for each item and flags items approaching expiry.
 * Returns an array of { item, daysUntilExpiry, isExpiringSoon, alreadyExpired }.
 * A product is "expiring soon" if daysUntilExpiry <= EXPIRY_NOTIFICATION_DAYS
 * and daysUntilExpiry > 0 (i.e. not already expired).
 */
export function getExpiryReminders(items = []) {
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== ''
  const today = new Date()
  const rows = items.filter(Boolean)
  const reminders = rows
    .map((i) => {
      const expiryStr = i.expiry
      if (!expiryStr || !nonEmpty(expiryStr)) return null
      const expiryDate = new Date(expiryStr)
      if (isNaN(expiryDate.getTime())) return null
      const diffTime = expiryDate.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (diffDays < 0) return { item: i, daysUntilExpiry: 0, isExpiringSoon: false, alreadyExpired: true }
      return {
        item: i,
        daysUntilExpiry: diffDays,
        isExpiringSoon: diffDays <= EXPIRY_NOTIFICATION_DAYS,
        alreadyExpired: false,
      }
    })
    .filter(Boolean)
  return reminders
}