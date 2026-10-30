import { normalize } from '../../lib/productMatches'

// Purchase line items — the pure rules behind Purchases.jsx's bulk stock entry,
// kept out of the component so they can be tested without rendering it.
//
// A line is { id, productId, name, qty, cost, sell, batch, expiry, cat }. All
// inputs are kept as the strings the user typed; numbers are parsed at the
// edges (validation and save). `productId` links the line to an existing
// catalogue product once it has been picked, so the save restocks that exact
// row instead of re-guessing from the name.

let seq = 0
const lineId = () => 'l' + Date.now().toString(36) + (seq++).toString(36)

export const blankItem = () => ({ id: lineId(), productId: null, name: '', qty: '', cost: '', sell: '', batch: '', expiry: '', cat: 'Medicines' })

// A line the user has not touched at all. Ignored at save, never an error —
// the form always keeps a trailing empty line ready for the next product.
export function isBlankItem(item) {
  return !String(item.name || '').trim() && !item.qty && !item.cost && !item.sell && !item.batch && !item.expiry
}

// Resolve what was typed (or scanned) into the product field to an existing
// product: an exact, normalised name match, or an exact barcode match (a USB
// scanner types the code into the focused field). Deliberately NOT a generic
// name match: "Paracetamol" must not silently restock "Panadol".
export function findProductForEntry(products, text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const n = normalize(raw)
  return (products || []).find(p => (n && normalize(p.name) === n) || (p.barcode && String(p.barcode).trim() === raw)) || null
}

// Link a line to a product and bring its details in, so the user only edits
// what changed on this delivery. Quantity, batch and expiry are left as they
// are: they describe this delivery, not the product, and carrying an old
// expiry date forward on a medicine is a safety risk if nobody notices it.
export function applyProduct(item, product) {
  return {
    ...item,
    productId: product.id,
    name: product.name,
    cost: Number(product.cost_price) > 0 ? String(product.cost_price) : '',
    sell: Number(product.price) > 0 ? String(product.price) : '',
    cat: product.category || product.cat || item.cat || 'Medicines',
  }
}

// Field-level problems for one line, empty when the line can be saved.
// Quantities must be whole numbers: every stock column is integral, and a
// decimal used to truncate silently via parseInt.
export function itemProblems(item) {
  if (isBlankItem(item)) return {}
  const problems = {}
  if (!String(item.name || '').trim()) problems.name = 'Enter the product name'
  const qty = Number(item.qty)
  if (item.qty === '' || item.qty == null) problems.qty = 'Enter the quantity'
  else if (!Number.isInteger(qty) || qty <= 0) problems.qty = 'Whole number above 0'
  if (!(Number(item.cost) > 0)) problems.cost = 'Enter the unit cost'
  return problems
}

// Not blocking: an expiry already in the past is almost always a typo (wrong
// year), occasionally a genuinely expired delivery — either way worth a look.
export function isPastExpiry(item, today) {
  return !!item.expiry && item.expiry < today
}

// Group the saveable lines by product. Stock is incremented once per product
// (two lines of one product must not hit the "create" branch twice and make a
// duplicate catalogue entry), but each line keeps its own batch/expiry: two
// batches of the same medicine are two batches, with two expiry dates.
// `resolve(line)` returns the existing product for a line, or null.
export function groupLinesByProduct(lines, resolve) {
  const groups = new Map()
  for (const line of lines) {
    const existing = resolve(line)
    const name = existing ? existing.name : String(line.name).trim()
    const key = existing ? 'id:' + existing.id : 'name:' + normalize(name)
    const qty = Number(line.qty)
    const cost = Number(line.cost)
    const sell = Number(line.sell) > 0 ? Number(line.sell) : null
    if (!groups.has(key)) groups.set(key, { existing, name, qty: 0, cost, sell: null, cat: line.cat || 'Medicines', batches: [] })
    const g = groups.get(key)
    g.qty += qty
    g.cost = cost
    if (sell) g.sell = sell
    if (line.batch || line.expiry) g.batches.push({ batch: line.batch || null, expiry: line.expiry || null, qty })
  }
  return [...groups.values()]
}
