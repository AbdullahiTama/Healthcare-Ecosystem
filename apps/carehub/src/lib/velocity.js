// Sales-velocity classification for the owner's daily digest (issue #4).
// Pure functions — no I/O, no React — unit-tested in velocity.test.js.
//
// `sales.items` is a jsonb column the app writes with JSON.stringify(items),
// so Postgres stores a scalar JSON *string*, not an array (measured 2026-08-04:
// 51 of 54 rows were strings). Line items carry `id` OR `product_id`, never
// both, and `qty` is an integer string. Both shapes are handled here — the
// same rules the sale_stock_movement trigger enforces server-side.

/**
 * Normalises a sales row's items value to an array of line items.
 * Returns [] for anything unparseable rather than throwing.
 */
export function parseSaleItems(items) {
  if (!items) return []
  let arr = items
  if (typeof items === 'string') {
    try { arr = JSON.parse(items) } catch (e) { return [] }
    // Double-encoded: the string parses to a JSON string holding the array.
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr) } catch (e) { return [] }
    }
  }
  if (!Array.isArray(arr)) return []
  return arr.map(function (it) {
    const qty = parseInt(it && it.qty, 10)
    return { ...it, qty: Number.isFinite(qty) ? qty : 0 }
  })
}

const DAY_MS = 86400000

/**
 * Classifies stocked products by units sold over the trailing window:
 *   fast   — 10+ units
 *   medium — 1–9 units
 *   slow   — 0 units (stocked but not selling)
 * Out-of-stock and service rows are never classified. Returns
 * { fast: [{id,name,units}], medium: [...], slow: [...] } sorted by units.
 */
export function classifySalesVelocity(products, sales, { days = 30 } = {}) {
  const cutoff = Date.now() - days * DAY_MS
  const unitsById = {}

  for (const sale of sales || []) {
    const t = new Date(sale.created_at || 0).getTime()
    if (!Number.isFinite(t) || t < cutoff) continue
    for (const item of parseSaleItems(sale.items)) {
      const id = item.id || item.product_id
      if (!id) continue
      unitsById[id] = (unitsById[id] || 0) + item.qty
    }
  }

  const groups = { fast: [], medium: [], slow: [] }
  for (const prod of products || []) {
    const cat = prod.cat || prod.category || ''
    if (cat === 'Services') continue
    if (!(prod.stock > 0)) continue
    const units = unitsById[prod.id] || 0
    const entry = { id: prod.id, name: prod.name, units: units }
    if (units >= 10) groups.fast.push(entry)
    else if (units >= 1) groups.medium.push(entry)
    else groups.slow.push(entry)
  }

  const byUnits = (a, b) => b.units - a.units
  groups.fast.sort(byUnits)
  groups.medium.sort(byUnits)
  return groups
}
