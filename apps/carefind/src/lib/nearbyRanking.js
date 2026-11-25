// How CareFind orders product results when someone searches (CODE_AUDIT A51, feedback 2026-11-25: "prioritise
// pharmacies closest to the user; retain relevance and availability").
//
// One rule, applied in this order:
//   1. Match strength, in two groups: the name or generic name matches the search, before a match on category only.
//      (Searching "paracetamol" shows Paracetamol from every pharmacy before products merely filed under a category.)
//   2. Availability: in stock before out of stock (stock unknown counts as available, as the shop's own rule does).
//   3. Distance from the user, nearest first; a seller with no known location comes after every located one.
//   4. Finer match strength (name / generic name starting with the search before containing it).
//   5. Newest first.
// Without the user's location step 3 is skipped and the order is otherwise the same.
//
// The database applies the same rule to medicine search (search_carefind_products, carefind_20270207); this module is
// used where the whole list is already in the browser (MED Market) and as the fallback when that function is missing.

import { haversineMeters } from '../modules/utils/marketplace.js'

// 0: name / generic name starts with the query; 1: contains it; 2: category only; 3: no match (or no query: 0).
export function matchTier(query, { name, genericName, category } = {}) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return 0
  const n = String(name || '').toLowerCase()
  const g = String(genericName || '').toLowerCase()
  if (n.startsWith(q) || g.startsWith(q)) return 0
  if (n.includes(q) || g.includes(q)) return 1
  if (String(category || '').toLowerCase().includes(q)) return 2
  return 3
}

const validCoords = (c) => !!c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))
  && Math.abs(Number(c.lat)) <= 90 && Math.abs(Number(c.lng)) <= 180

// Distance in metres, or null when either side has no usable location.
export function distanceBetween(userCoords, coords) {
  if (!validCoords(userCoords) || !validCoords(coords)) return null
  const d = haversineMeters(Number(userCoords.lat), Number(userCoords.lng), Number(coords.lat), Number(coords.lng))
  return Number.isFinite(d) ? d : null
}

// Returns a new array ordered by the rule above. `pick(row)` gives
//   { name, genericName, category, stock, coords, createdAt }
// for a row; rows are not modified. Each result carries its distance in `distance_m` when known.
export function rankProducts(rows, { query = '', userCoords = null, pick }) {
  const keyed = (rows || []).map((row, index) => {
    const f = pick(row) || {}
    const tier = matchTier(query, f)
    const stock = f.stock
    const distance = distanceBetween(userCoords, f.coords)
    return {
      row: distance == null ? row : { ...row, distance_m: distance },
      group: tier <= 1 ? 0 : tier === 2 ? 1 : 2,
      unavailable: stock != null && Number(stock) <= 0 ? 1 : 0,
      distance: distance == null ? Infinity : distance,
      tier,
      created: f.createdAt ? new Date(f.createdAt).getTime() || 0 : 0,
      index,
    }
  })
  keyed.sort((a, b) => (a.group - b.group)
    || (a.unavailable - b.unavailable)
    || (a.distance === b.distance ? 0 : a.distance < b.distance ? -1 : 1)
    || (a.tier - b.tier)
    || (b.created - a.created)
    || (a.index - b.index))
  return keyed.map((k) => k.row)
}

// "Where to buy" on a medicine's page: every row is the same medicine, so there is no relevance to weigh. In stock
// first, then the nearest seller, then the lowest price (a price not shown comes last). Without the user's location:
// in stock, then cheapest, as before. `pick(row)` gives { stock, coords, price }.
export function rankSellers(rows, { userCoords = null, pick }) {
  const keyed = (rows || []).map((row, index) => {
    const f = pick(row) || {}
    const distance = distanceBetween(userCoords, f.coords)
    const price = f.price == null || !Number.isFinite(Number(f.price)) ? Infinity : Number(f.price)
    return { row, unavailable: f.stock != null && Number(f.stock) <= 0 ? 1 : 0, distance: distance == null ? Infinity : distance, price, index }
  })
  const cmp = (a, b) => (a === b ? 0 : a < b ? -1 : 1)
  keyed.sort((a, b) => (a.unavailable - b.unavailable) || cmp(a.distance, b.distance) || cmp(a.price, b.price) || (a.index - b.index))
  return keyed.map((k) => k.row)
}
