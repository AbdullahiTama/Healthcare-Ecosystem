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

// Units sold in the window (30 days by default) that put a product in each group. One rule for the owner's daily
// notification and the Sales velocity breakdown (Stock Management), so their counts always agree.
export const VELOCITY_WINDOW_DAYS = 30
export const VELOCITY_BANDS = { fast: 10, steady: 4, slow: 1 }
export const VELOCITY_GROUPS = [
  { key: 'fast', label: 'Fast-moving', rule: VELOCITY_BANDS.fast + '+ units sold' },
  { key: 'steady', label: 'Steady-moving', rule: VELOCITY_BANDS.steady + ' to ' + (VELOCITY_BANDS.fast - 1) + ' units sold' },
  { key: 'slow', label: 'Slow-moving', rule: VELOCITY_BANDS.slow + ' to ' + (VELOCITY_BANDS.steady - 1) + ' units sold' },
  { key: 'none', label: 'Not moving', rule: 'none sold, still in stock' },
]

/**
 * Units sold per product id in the trailing window. Pass completed sales only
 * (held or refunded sales are the caller's to leave out).
 */
export function unitsSoldById(sales, { days = VELOCITY_WINDOW_DAYS, now = Date.now() } = {}) {
  const cutoff = now - days * DAY_MS
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
  return unitsById
}

/**
 * Classifies products by units sold over the trailing window:
 *   fast   — 10+ units
 *   steady — 4–9 units
 *   slow   — 1–3 units
 *   none   — 0 units, still in stock (not moving)
 * Services are never classified. A product that sold is classified even when it
 * is now out of stock (a fast mover that sold out is the one to reorder); one
 * that neither sold nor has stock is not a concern and is left out.
 * Returns { fast, steady, slow, none }: [{ id, name, units, stock }], movers by
 * units sold (most first), not moving by stock (most first).
 */
export function classifySalesVelocity(products, sales, { days = VELOCITY_WINDOW_DAYS, now = Date.now() } = {}) {
  const unitsById = unitsSoldById(sales, { days, now })
  const groups = { fast: [], steady: [], slow: [], none: [] }
  for (const prod of products || []) {
    const cat = prod.cat || prod.category || ''
    if (cat === 'Services') continue
    const units = unitsById[prod.id] || 0
    const stock = Number(prod.stock) || 0
    if (units <= 0 && !(stock > 0)) continue
    const entry = { id: prod.id, name: prod.name, units, stock }
    if (units >= VELOCITY_BANDS.fast) groups.fast.push(entry)
    else if (units >= VELOCITY_BANDS.steady) groups.steady.push(entry)
    else if (units >= VELOCITY_BANDS.slow) groups.slow.push(entry)
    else groups.none.push(entry)
  }
  const byUnits = (a, b) => b.units - a.units || String(a.name).localeCompare(String(b.name))
  groups.fast.sort(byUnits)
  groups.steady.sort(byUnits)
  groups.slow.sort(byUnits)
  groups.none.sort((a, b) => b.stock - a.stock || String(a.name).localeCompare(String(b.name)))
  return groups
}
