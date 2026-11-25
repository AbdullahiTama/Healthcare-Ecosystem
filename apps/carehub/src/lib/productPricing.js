// Retail and wholesale prices of a product: the one set of rules Inventory, Purchases, the upload templates and the
// POS share (docs/architecture/Wholesale-and-Retail-Prices.md).
//
// A product has two optional selling prices:
//   price            the retail price (the column every product has always had; CareFind shows it)
//   wholesale_price  the wholesale price (carehub_20270205_wholesale_retail_prices); null when not entered
// A price is "set" when it is a number above 0. 0, blank and null all mean "not entered", which is how every product
// without a price has been stored so far (price defaults to 0).
//
// When neither price is set the product behaves exactly as before: one retail price of 0.

import { fmt } from './utils'

export const PRICE_TIERS = ['retail', 'wholesale']
export const TIER_LABELS = { retail: 'Retail', wholesale: 'Wholesale' }

const positive = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export const retailPrice = (p) => positive(p?.price)
export const wholesalePrice = (p) => positive(p?.wholesale_price)
export const hasBothPrices = (p) => retailPrice(p) != null && wholesalePrice(p) != null
export const hasAnyPrice = (p) => retailPrice(p) != null || wholesalePrice(p) != null

// The prices this product can be sold at, retail first: [{ tier, label, price }]. Only the prices that are set; a
// product with neither gets one retail price of 0 (as before), so a POS line always has a price.
export function priceOptions(p) {
  const out = []
  const r = retailPrice(p)
  const w = wholesalePrice(p)
  if (r != null) out.push({ tier: 'retail', label: TIER_LABELS.retail, price: r })
  if (w != null) out.push({ tier: 'wholesale', label: TIER_LABELS.wholesale, price: w })
  if (!out.length) out.push({ tier: 'retail', label: TIER_LABELS.retail, price: 0 })
  return out
}

// The price for `tier` when the product has it, else the product's first available price. { tier, price }.
export function priceFor(p, tier = 'retail') {
  const options = priceOptions(p)
  const hit = options.find(o => o.tier === tier) || options[0]
  return { tier: hit.tier, price: hit.price }
}

// The one figure used where a single value is needed (stock value, margin, sorting): retail, else wholesale, else 0.
export const referencePrice = (p) => retailPrice(p) ?? wholesalePrice(p) ?? 0

// "₦500" / "Wholesale ₦400" / "Retail ₦500 · Wholesale ₦400": what a product costs to buy, in words. Only the prices
// that are set are named; with neither, "₦0" as before.
export function priceSummary(p) {
  const options = priceOptions(p)
  if (options.length === 1 && options[0].tier === 'retail') return fmt(options[0].price)
  return options.map(o => o.label + ' ' + fmt(o.price)).join(' · ')
}

// A price typed into a form or read from a spreadsheet: a number >= 0, or null when left blank. `NaN` when the text is
// not a price (callers report it).
export function parseOptionalPrice(value) {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/[₦,\s]/g, '').replace(/^ngn/i, '')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
