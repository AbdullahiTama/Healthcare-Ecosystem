// Cost price at the POS (docs/architecture/POS-Cost-Visibility.md): what a
// product cost, its margin, and the estimated profit on the sale in progress,
// for users allowed to see costs. Display only: nothing here changes a price,
// a sale or what is saved. Pure, so the rules are tested without the screen.

const toKobo = (n) => Math.round((Number(n) || 0) * 100)

// A product's unit cost, or null when none is recorded (0 or blank is "not set",
// never "free": a margin of 100% on a missing cost would mislead).
export function unitCost(product) {
  const c = Number(product?.cost_price)
  return Number.isFinite(c) && c > 0 ? c : null
}

// Margin on the selling price, in whole percent: (price - cost) / price.
// null when either is unknown or the price is not above zero.
export function marginPct(price, cost) {
  const p = Number(price)
  if (cost == null || !(p > 0)) return null
  return Math.round(((p - cost) / p) * 100)
}

/**
 * The sale in progress, at cost. `costOf(line)` returns the unit cost of a cart
 * line (from the catalogue), or null. `total` is what the customer pays (after
 * discount). Returns { cost, profit, marginPct, missing } where `missing` is the
 * number of lines without a cost: their cost is unknown, so profit is only an
 * estimate over the lines that have one (shown as such).
 */
export function saleCostSummary(cart, costOf, total) {
  let costKobo = 0
  let missing = 0
  let pricedKobo = 0
  for (const line of cart || []) {
    const c = costOf(line)
    if (c == null) { missing++; continue }
    costKobo += toKobo(c) * (Number(line.qty) || 0)
    pricedKobo += toKobo(line.price) * (Number(line.qty) || 0)
  }
  const lines = (cart || []).length
  if (!lines || missing === lines) return { cost: null, profit: null, marginPct: null, missing }
  // The discount is spread over the whole cart, so the lines with a cost carry their share of it.
  const subKobo = (cart || []).reduce((s, l) => s + toKobo(l.price) * (Number(l.qty) || 0), 0)
  const share = subKobo > 0 ? pricedKobo / subKobo : 0
  const revenueKobo = Math.round(toKobo(total) * share)
  const profitKobo = revenueKobo - costKobo
  return {
    cost: costKobo / 100,
    profit: profitKobo / 100,
    marginPct: revenueKobo > 0 ? Math.round((profitKobo / revenueKobo) * 100) : null,
    missing,
  }
}

// Whether costs are shown is remembered on this device, per business and staff
// member, and starts hidden: the counter screen often faces the customer.
const KEY = 'carehub_pos_show_cost'
export function readShowCost(scope) {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}')[scope] === true } catch { return false }
}
export function writeShowCost(scope, on) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
    if (on) all[scope] = true; else delete all[scope]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* storage unavailable: the switch still works for this visit */ }
}
