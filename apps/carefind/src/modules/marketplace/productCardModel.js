// Presentation rules for a marketplace product card, kept out of the component so they can be tested on their own.

const isMissing = (v) => v === null || v === undefined

// 'out' | 'low' | 'in', or null when stock is unknown. "Low" uses the seller's own reorder level (products.reorder_level),
// not a number we invent: with no reorder level set, a product that has any stock is simply "in".
export function stockStatus(product) {
  const stock = product?.stock
  if (isMissing(stock)) return null
  if (stock <= 0) return 'out'
  const reorder = product.reorder_level
  if (!isMissing(reorder) && stock <= reorder) return 'low'
  return 'in'
}

// 'medical_supplier' -> 'Medical supplier'
export function businessTypeLabel(type) {
  const t = String(type ?? '').trim().replace(/_/g, ' ').toLowerCase()
  if (!t) return null
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Second line under the seller name: "Pharmacy • 1.2km away", with whichever parts exist.
export function sellerLine(type, distance) {
  const parts = [businessTypeLabel(type), distance].filter(Boolean)
  return parts.length ? parts.join(' • ') : null
}
