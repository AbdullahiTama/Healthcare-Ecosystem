// Bulk edit for Inventory: what a set of changes does to the products the user marked, and how to send it in as few
// requests as possible. Pure (the request function is passed in), so the rules are pinned by bulkEdit.test.js.
//
// Stock and tracking mode are deliberately not here: stock moves only through the stock ledger (Add stock, sales,
// stock counts) and tracking mode only through set_product_tracking_mode(), both with their own records.

export const PRICE_MODES = [['set', 'Set to (₦)'], ['increase', 'Increase by %'], ['decrease', 'Decrease by %']]
export const CAREFIND_CHOICES = [['yes', 'List on CareFind'], ['no', 'Hide from CareFind']]

export const EMPTY_BULK_EDIT = Object.freeze({
  category: '',
  price: Object.freeze({ mode: '', value: '' }),
  cost_price: Object.freeze({ mode: '', value: '' }),
  reorder_level: '',
  shelf_label: '',
  list_on_carefind: '',
})

const isService = (p) => (p?.cat || p?.category) === 'Services'
const round2 = (n) => Math.round(n * 100) / 100
const number = (raw) => {
  const s = String(raw ?? '').replace(/[,\s₦%]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

// Field errors ({ field: message }) and whether anything would change at all. Prices need canEditPrice, as in the
// single-product form.
export function validateBulkEdit(changes, { canEditPrice = false } = {}) {
  const c = { ...EMPTY_BULK_EDIT, ...changes }
  const errors = {}
  for (const key of ['price', 'cost_price']) {
    const { mode, value } = c[key] || {}
    if (!mode) continue
    if (!canEditPrice) { errors[key] = 'Only roles allowed to edit prices can change them.'; continue }
    const n = number(value)
    if (n === null) errors[key] = mode === 'set' ? 'Enter the new price.' : 'Enter the percentage.'
    else if (Number.isNaN(n) || n < 0) errors[key] = 'Enter a number of 0 or more.'
    else if (mode === 'set' && n > 1e9) errors[key] = 'That price is too large.'
    else if (mode === 'increase' && (n <= 0 || n > 1000)) errors[key] = 'Increase by more than 0% and at most 1000%.'
    else if (mode === 'decrease' && (n <= 0 || n >= 100)) errors[key] = 'Decrease by more than 0% and less than 100%.'
  }
  if (String(c.reorder_level).trim() !== '') {
    const n = number(c.reorder_level)
    if (!Number.isInteger(n) || n < 0 || n > 1e6) errors.reorder_level = 'Enter a whole number of 0 or more.'
  }
  if (c.category.trim().length > 60) errors.category = 'Keep the category under 60 characters.'
  if (c.shelf_label.trim().length > 50) errors.shelf_label = 'Keep the shelf under 50 characters.'
  const hasChanges = !!(c.category.trim() || c.price?.mode || c.cost_price?.mode || String(c.reorder_level).trim() !== '' ||
    c.shelf_label.trim() || c.list_on_carefind)
  return { errors, ok: Object.keys(errors).length === 0, hasChanges }
}

function newPrice(old, { mode, value }) {
  const n = number(value)
  const base = Number(old) || 0
  if (mode === 'set') return round2(n)
  if (mode === 'increase') return round2(base * (1 + n / 100))
  if (mode === 'decrease') return round2(base * (1 - n / 100))
  return base
}

// One entry per product that would actually change: { id, name, updates, before }. A product whose values already
// match is left out, so the count shown is what will really change. Reorder level is not applied to services.
export function planBulkEdit(products, changes, opts = {}) {
  const c = { ...EMPTY_BULK_EDIT, ...changes }
  if (!validateBulkEdit(c, opts).ok) return []
  const plan = []
  for (const p of products || []) {
    const updates = {}
    const before = {}
    const set = (key, value, current) => {
      if (value === current || (typeof value === 'number' && Number(current) === value)) return
      updates[key] = value
      before[key] = current ?? null
    }
    if (c.category.trim()) set('category', c.category.trim(), p.category ?? p.cat)
    if (c.price?.mode) set('price', newPrice(p.price, c.price), p.price)
    if (c.cost_price?.mode) set('cost_price', newPrice(p.cost_price, c.cost_price), p.cost_price)
    if (String(c.reorder_level).trim() !== '' && !isService(p)) set('reorder_level', number(c.reorder_level), p.reorder_level)
    if (c.shelf_label.trim()) set('shelf_label', c.shelf_label.trim(), p.shelf_label)
    if (c.list_on_carefind) set('list_on_carefind', c.list_on_carefind === 'yes', p.list_on_carefind !== false)
    if (Object.keys(updates).length) plan.push({ id: p.id, name: p.name, updates, before })
  }
  return plan
}

// Products that get exactly the same updates go in one request (category, shelf, reorder level and a fixed price are
// usually the same for all; a percentage gives each product its own price).
export function groupBulkUpdates(plan) {
  const groups = new Map()
  for (const item of plan || []) {
    const key = JSON.stringify(Object.keys(item.updates).sort().map((k) => [k, item.updates[k]]))
    if (!groups.has(key)) groups.set(key, { updates: item.updates, ids: [] })
    groups.get(key).ids.push(item.id)
  }
  return [...groups.values()]
}

// Sends the groups through `updateMany(ids, updates)` (which resolves to the saved rows), a few at a time. Never
// throws: returns the saved rows and the failures ({ ids, message }) so the page can apply what worked and offer to
// retry the rest. `onProgress(done, total)` counts products.
export async function runBulkUpdates(groups, updateMany, { concurrency = 4, onProgress } = {}) {
  const queue = [...(groups || [])]
  const total = queue.reduce((n, g) => n + g.ids.length, 0)
  const saved = []
  const failed = []
  let done = 0
  async function worker() {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        const rows = await updateMany(g.ids, g.updates)
        saved.push(...(Array.isArray(rows) ? rows : []))
      } catch (e) {
        failed.push({ ids: g.ids, updates: g.updates, message: e?.message || 'Could not save' })
      }
      done += g.ids.length
      onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker))
  return { saved, failed, total }
}

// What each "kept" reason from delete_products means, for the result screen.
export const KEPT_REASONS = {
  shop_orders: 'in online shop orders',
  orders: 'in internal orders',
  batches: 'has stock batches',
  reviews: 'has customer reviews',
  shop_listing: 'listed in your online shop',
  stock_counts: 'in past stock counts',
}
export const keptReasonText = (reasons) => (reasons || []).map((r) => KEPT_REASONS[r] || r).join(', ')
