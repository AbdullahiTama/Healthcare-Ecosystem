// Product expiry, as the owner's expiry notifications and the Expiry breakdown (Stock Management) both count it,
// so the number in a notification is the number of products its breakdown lists. Pure: no I/O, no React.

export const EXPIRY_SOON_DAYS = 60
const DAY_MS = 86400000

/**
 * Whole days from `now` to the product's expiry date: 0 or more is still in date, negative has expired; null when
 * the product has no (valid) expiry date. The same rule the dashboard and Inventory's expiry filter use.
 */
export function daysToExpiry(product, now = Date.now()) {
  if (!product?.expiry_date) return null
  const d = new Date(product.expiry_date)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - now) / DAY_MS)
}

/**
 * { expiring: [...], expired: [...] }, each [{ id, name, stock, expiry_date, days }]:
 * expiring within `soonDays` (soonest first) and already expired (most recently expired first).
 */
export function expiryGroups(products, { soonDays = EXPIRY_SOON_DAYS, now = Date.now() } = {}) {
  const expiring = []
  const expired = []
  for (const p of products || []) {
    const days = daysToExpiry(p, now)
    if (days === null) continue
    const row = { id: p.id, name: p.name, stock: Number(p.stock) || 0, expiry_date: String(p.expiry_date).slice(0, 10), days }
    if (days < 0) expired.push(row)
    else if (days <= soonDays) expiring.push(row)
  }
  expiring.sort((a, b) => a.days - b.days || String(a.name).localeCompare(String(b.name)))
  expired.sort((a, b) => b.days - a.days || String(a.name).localeCompare(String(b.name)))
  return { expiring, expired }
}
