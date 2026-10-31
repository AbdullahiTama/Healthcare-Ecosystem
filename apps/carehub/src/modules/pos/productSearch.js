// ── POS product search ───────────────────────────────────────────────────────
// Pure, so what the counter finds (and how fast) is pinned by a test
// (productSearch.test.js).
//
// Why it is built this way: a pharmacy catalogue runs to thousands of
// products. The old search lower-cased every product's name, generic name and
// barcode, re-sorted the whole list with localeCompare and drew a card for
// every match, on every key press. Deleting the last letters of a name made
// almost the whole catalogue match again, so one key press built ~2,000 cards
// and the next presses queued behind it. Now:
//   * buildProductIndex() prepares each product's searchable text once per
//     catalogue change and keeps the catalogue pre-sorted by name;
//   * searchProducts() only filters that prepared list (no per-key sorting
//     for the default A-Z order);
//   * the screen draws a bounded page of cards (POS.jsx, GRID_PAGE).
//
// Matching: every typed word must appear in the product's name, generic name
// or barcode (so "amox 500" finds "Amoxicillin 500mg"); a single word matches
// exactly what it matched before.

export const isService = (p) => (p.cat || p.category) === 'Services'
export const EXPIRING_SOON_DAYS = 60

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const lower = (v) => String(v ?? '').toLowerCase()

export function buildProductIndex(products) {
  const entries = (products || []).map((p) => ({
    p,
    // One string per product; fields are joined by a newline so a typed word
    // can never match across two fields.
    hay: [lower(p.name), lower(p.generic_name || p.genericName), lower(p.barcode).trim()].join('\n'),
  }))
  const byName = [...entries].sort((a, b) => collator.compare(a.p.name || '', b.p.name || ''))
  // Barcode → product, first one wins (the old `find` behaviour).
  const byBarcode = new Map()
  for (const { p } of entries) {
    const code = String(p.barcode || '').trim()
    if (code && !byBarcode.has(code)) byBarcode.set(code, p)
  }
  const categories = ['All', ...new Set((products || []).map((p) => p.cat))]
  return { entries, byName, byBarcode, categories }
}

export const findByBarcode = (index, code) => index.byBarcode.get(String(code ?? '').trim()) || null

const daysUntil = (date, now) => {
  if (!date) return null
  const ms = new Date(date).getTime() - now
  return Number.isNaN(ms) ? null : Math.floor(ms / 86400000)
}

function matchesStock(p, stockFilter) {
  if (stockFilter === 'All' || !stockFilter) return true
  if (isService(p)) return false
  if (stockFilter === 'out') return p.stock <= 0
  if (stockFilter === 'low') return p.stock > 0 && p.stock <= (p.reorder_level || 5)
  return true
}

function matchesExpiry(p, expiryFilter, now) {
  if (expiryFilter === 'All' || !expiryFilter) return true
  const days = daysUntil(p.expiry_date || p.expiryDate, now)
  if (days === null) return false
  if (expiryFilter === 'expired') return days < 0
  if (expiryFilter === 'expiring') return days >= 0 && days <= EXPIRING_SOON_DAYS
  return true
}

const PRICE_SORT = {
  price_asc: (a, b) => (a.price || 0) - (b.price || 0),
  price_desc: (a, b) => (b.price || 0) - (a.price || 0),
}

// The grid's products for a query and the filters, plus the matching
// out-of-stock products (for the Out-of-stock sheet).
//   sellable    services, and goods with stock; with stockFilter 'out' the
//               out-of-stock goods themselves (the cashier asked for them)
//   outOfStock  matching goods with no stock, whatever the stock filter
export function searchProducts(index, { query = '', category = 'All', stockFilter = 'All', expiryFilter = 'All', sortBy = 'name_asc', now = Date.now() } = {}) {
  const words = lower(query).split(/\s+/).filter(Boolean)
  const ordered = sortBy === 'name_desc' ? [...index.byName].reverse() : index.byName
  const sellable = []
  const outOfStock = []
  for (const e of ordered) {
    const p = e.p
    if (category !== 'All' && p.cat !== category) continue
    if (words.length && !words.every((w) => e.hay.includes(w))) continue
    const service = isService(p)
    if (!service && p.stock <= 0) outOfStock.push(p)
    if (stockFilter !== 'out' && !service && !(p.stock > 0)) continue
    if (!matchesStock(p, stockFilter) || !matchesExpiry(p, expiryFilter, now)) continue
    sellable.push(p)
  }
  if (PRICE_SORT[sortBy]) sellable.sort(PRICE_SORT[sortBy])
  return { sellable, outOfStock }
}
