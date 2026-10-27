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
