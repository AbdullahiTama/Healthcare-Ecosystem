// ── Master catalogue rules ───────────────────────────────────────────────────
// Pure helpers for the Master Catalog screen: prescription status labels, the
// item form (validation and the payload sent to master_products), and how each
// location carries an item. No React, no network: unit-tested on their own.
// Design: docs/architecture/Product-Catalogue-Design.md.

// The prescription statuses, in order of strictness. The database checks the
// same four values (carehub_20261215).
export const RX_STATUSES = [
  { value: 'otc', label: 'Over the counter', pill: 'green' },
  { value: 'pharmacy_only', label: 'Pharmacy only', pill: 'blue' },
  { value: 'prescription_only', label: 'Prescription only', pill: 'amber' },
  { value: 'controlled', label: 'Controlled', pill: 'red' },
]

export const rxStatus = (value) => RX_STATUSES.find((s) => s.value === value) || null

export const DOSE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Infusion', 'Cream', 'Ointment', 'Gel',
  'Drops', 'Inhaler', 'Suppository', 'Sachet', 'Powder', 'Spray', 'Device', 'Other']

// The main location shows as "Main Location" unless it has a branch name.
export const locationName = (loc) => loc?.branch_name || (!loc?.parent_business_id ? 'Main Location' : loc?.name) || 'Location'

const text = (v) => (v == null ? '' : String(v).trim())
const amount = (v) => (text(v) === '' ? null : Number(v))

// The form's starting values for a new item or an existing one.
export function formFromMaster(master) {
  if (!master) return { name: '', generic_name: '', strength: '', dose_form: '', pack_size: '', barcode: '', category_code: '', rx_status: '', default_price: '', default_cost: '', reorder_level: '5', description: '' }
  return {
    name: master.name || '',
    generic_name: master.generic_name || '',
    strength: master.strength || '',
    dose_form: master.dose_form || '',
    pack_size: master.pack_size || '',
    barcode: master.barcode || '',
    category_code: master.category_code || '',
    rx_status: master.rx_status || '',
    default_price: master.default_price != null ? String(master.default_price) : '',
    default_cost: master.default_cost != null ? String(master.default_cost) : '',
    reorder_level: master.reorder_level != null ? String(master.reorder_level) : '5',
    description: master.description || '',
  }
}

// Checks the form. Returns { errors } (field → message) or { payload } for
// master_products. `categories` is the standard list: the item keeps the
// category's label as its free-text category too, so older screens that still
// read `category` show the same group. An empty prescription status takes the
// category's default. `upgraded` is false before carehub_20261215, when only
// the original columns exist.
export function validateMasterForm(form, { categories = [], upgraded = true } = {}) {
  const errors = {}
  const name = text(form.name).replace(/\s+/g, ' ')
  if (!name) errors.name = 'Enter the product name.'
  else if (name.length > 160) errors.name = 'Keep the name under 160 characters.'

  const price = amount(form.default_price)
  if (price == null || !Number.isFinite(price)) errors.default_price = 'Enter the default selling price.'
  else if (price < 0) errors.default_price = 'The price cannot be negative.'

  const cost = amount(form.default_cost)
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) errors.default_cost = 'The cost cannot be negative.'

  const reorder = amount(form.reorder_level)
  if (reorder != null && (!Number.isInteger(reorder) || reorder < 0)) errors.reorder_level = 'Use a whole number, 0 or more.'

  const barcode = text(form.barcode)
  if (barcode && !/^[0-9A-Za-z-]{4,32}$/.test(barcode)) errors.barcode = 'Barcodes are 4 to 32 letters or digits.'

  const category = categories.find((c) => c.code === form.category_code) || null
  if (form.category_code && categories.length && !category) errors.category_code = 'Choose a category from the list.'
  if (form.rx_status && !rxStatus(form.rx_status)) errors.rx_status = 'Choose a prescription status from the list.'

  if (Object.keys(errors).length) return { errors }

  const payload = { name, default_price: Math.round(price), description: text(form.description) }
  if (category) payload.category = category.label
  if (!upgraded) return { payload }
  return {
    payload: {
      ...payload,
      generic_name: text(form.generic_name) || null,
      strength: text(form.strength) || null,
      dose_form: text(form.dose_form) || null,
      pack_size: text(form.pack_size) || null,
      barcode: barcode || null,
      category_code: category?.code || null,
      rx_status: form.rx_status || category?.rx_default || 'pharmacy_only',
      default_cost: cost == null ? 0 : Math.round(cost * 100) / 100,
      reorder_level: reorder == null ? 5 : reorder,
    },
  }
}

// A typed branch price: null when empty (follow the master price), a number
// when valid, or { error } otherwise.
export function parseBranchPrice(value) {
  const t = text(value)
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return { error: 'The price must be greater than zero.' }
  return n
}

// How each location carries an item, from the item's `carried` list (one entry
// per linked product). A location can hold more than one product for the same
// item (a duplicate typed before the catalogue existed): its stock is summed and
// the lowest price shown. Locations that do not carry the item are included
// with `carried: false`, in the order of `locations`.
export function carryingByLocation(item, locations = []) {
  const byBranch = new Map()
  for (const c of item?.carried || []) {
    const cur = byBranch.get(c.branch_id)
    const price = Number(c.price) || 0
    if (!cur) {
      byBranch.set(c.branch_id, { price, stock: Number(c.stock) || 0, ownPrice: c.price_source === 'branch', active: c.active !== false, products: 1 })
    } else {
      cur.price = Math.min(cur.price, price)
      cur.stock += Number(c.stock) || 0
      cur.ownPrice = cur.ownPrice || c.price_source === 'branch'
      cur.active = cur.active && c.active !== false
      cur.products += 1
    }
  }
  return locations.map((loc) => {
    const c = byBranch.get(loc.id)
    return c ? { location: loc, carried: c.active, stopped: !c.active, ...c } : { location: loc, carried: false, stopped: false, price: null, stock: 0, ownPrice: false, products: 0 }
  })
}

// The short summary under an item: "Carried at 2 of 3 locations · 14 in stock".
export function carryingSummary(rows) {
  const carried = rows.filter((r) => r.carried)
  const stock = carried.reduce((s, r) => s + r.stock, 0)
  if (!rows.length) return ''
  if (!carried.length) return 'Not carried at any location'
  return `Carried at ${carried.length} of ${rows.length} location${rows.length === 1 ? '' : 's'} · ${stock.toLocaleString()} in stock`
}

// ── The CareHub library (phase 4) ────────────────────────────────────────────
// The prescription statuses an item may have: a linked item can never be less strict than its library entry.
export const rxRank = (value) => RX_STATUSES.findIndex((s) => s.value === value)

export function rxOptionsFor(libraryRx) {
  const floor = rxRank(libraryRx)
  return floor < 0 ? RX_STATUSES : RX_STATUSES.slice(floor)
}

// The form after picking a library item: its details fill the form; the name, price and anything already typed stay
// as the owner set them, except the prescription status, which cannot be looser than the library's.
export function applyLibraryToForm(form, lib) {
  const pick = (k, v) => (String(form[k] ?? '').trim() ? form[k] : v || '')
  const label = [lib.brand_name, lib.strength && !String(lib.brand_name).toLowerCase().includes(String(lib.strength).toLowerCase()) ? lib.strength : ''].filter(Boolean).join(' ')
  const allowed = rxOptionsFor(lib.rx_status).map((s) => s.value)
  return {
    ...form,
    name: pick('name', label),
    generic_name: pick('generic_name', lib.generic_name),
    strength: pick('strength', lib.strength),
    dose_form: pick('dose_form', lib.dose_form),
    pack_size: pick('pack_size', lib.pack_size),
    barcode: pick('barcode', lib.barcodes?.[0]),
    category_code: pick('category_code', lib.category_code),
    description: pick('description', lib.description),
    rx_status: allowed.includes(form.rx_status) ? form.rx_status : lib.rx_status,
    catalog_item_id: lib.id,
  }
}

// ── Catalogue health (carehub_20270127) ──────────────────────────────────────
// The missing-data flags, in the order the health panel shows them. `filter` is
// false where the flag has no list filter (duplicates open their own review).
// The database defines each flag once (catalogue_issue); these are its words.
export const HEALTH_ISSUES = [
  { key: 'no_price', label: 'No price', hint: 'No default selling price.', filter: true },
  { key: 'hidden', label: 'Hidden on CareFind', hint: 'Listed on CareFind with no price at a location, so customers cannot see it.', filter: true },
  { key: 'duplicates', label: 'Possible duplicates', hint: 'Pairs that may be the same product.', filter: false },
  { key: 'other_category', label: 'In "Other medicines"', hint: 'No specific category yet.', filter: true },
  { key: 'no_generic', label: 'No generic name', hint: 'Medicines without their generic name.', filter: true },
  { key: 'no_barcode', label: 'No barcode', hint: 'Cannot be found by scanning.', filter: true },
  { key: 'unlinked', label: 'Not linked to the library', hint: 'Not matched to the CareHub product library.', filter: true },
]

export const healthIssue = (key) => HEALTH_ISSUES.find((i) => i.key === key) || null

// How the score reads: good from 80, fair from 50.
export function scoreTone(score) {
  if (score == null) return { label: 'No items yet', tone: 'neutral' }
  if (score >= 80) return { label: 'Good', tone: 'good' }
  if (score >= 50) return { label: 'Fair', tone: 'fair' }
  return { label: 'Needs attention', tone: 'poor' }
}

// Why two items were paired, in words.
export function duplicateReason(reason) {
  if (reason === 'barcode') return 'Same barcode'
  if (reason === 'name') return 'Same name, apart from spaces or punctuation'
  return 'Very similar names'
}

// A sentence for the result of merge_master_items.
export function mergeSummary(result, keptName) {
  const r = result || {}
  const parts = [`Merged into ${keptName}.`]
  const units = Number(r.units_moved) || 0
  const places = Number(r.merged_locations) || 0
  const relinked = Number(r.relinked) || 0
  if (units) parts.push(`${units.toLocaleString()} unit${units === 1 ? '' : 's'} moved at ${places} location${places === 1 ? '' : 's'}.`)
  if (relinked) parts.push(`${relinked} product${relinked === 1 ? '' : 's'} now sold as ${keptName}.`)
  if (Number(r.negative_left)) parts.push(`${r.negative_left} product${r.negative_left === 1 ? ' had' : 's had'} stock below zero, left on the stopped product: count it.`)
  return parts.join(' ')
}

// ── Suggested fixes (carehub_20270205) ───────────────────────────────────────
// Why a category or price was suggested, in words.
export function suggestionReason(kind, reason, detail) {
  const n = Number(detail) || 0
  if (kind === 'price') {
    if (reason === 'locations') return `Price at ${n === 1 ? '1 of your locations' : `${n} of your locations`}`
    return `Typical price at ${n} other pharmacies`
  }
  if (reason === 'library') return `CareHub library: ${detail}`
  if (reason === 'text') return `You filed it under "${detail}"`
  if (reason === 'elsewhere') return n === 1 ? '1 other pharmacy uses this category' : `${n} other pharmacies use this category`
  return `Name contains "${detail}"`
}

// A sentence for the result of apply_catalogue_fixes.
export function fixesSummary(result) {
  const r = result || {}
  const parts = []
  const c = Number(r.categories) || 0
  const p = Number(r.prices) || 0
  const l = Number(r.location_prices) || 0
  if (c) parts.push(`${c} item${c === 1 ? '' : 's'} given a category.`)
  if (p) parts.push(`${p} item${p === 1 ? '' : 's'} given a price${l ? `, and ${l} location product${l === 1 ? '' : 's'} back on CareFind` : ''}.`)
  return parts.join(' ') || 'Nothing needed changing: these items were already fixed.'
}
