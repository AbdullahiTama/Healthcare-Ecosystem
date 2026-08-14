// Shared market rules for CareHub / CareFind products.
//
// Both apps write the same `products` table, so the allowed sales type / unit
// combinations, the human labels and the validation error are defined here as
// a single source of truth. The two front-ends (CareFind ProductUpload,
// Care Hub inventory ProductModal) render and validate against this same data.

export const SALE_TYPES = ['retail', 'wholesale', 'distributor']

export const SALE_TYPE_LABELS = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  distributor: 'Distributor',
}

// Unit labels are stored lowercase in the DB; display uses this capitalised form.
export const UNIT_LABELS = {
  piece: 'Piece',
  card: 'Card',
  sachet: 'Sachet',
  bottle: 'Bottle',
  pack: 'Pack',
  box: 'Box',
  roll: 'Roll',
  carton: 'Carton',
}

// Which units are meaningful for each sales tier. Everything else is rejected.
export const UNITS_BY_SALE_TYPE = {
  retail: ['piece', 'card', 'sachet', 'bottle'],
  wholesale: ['pack', 'box', 'roll', 'bottle'],
  distributor: ['carton', 'roll'],
}

export const ALL_UNITS = [...new Set(Object.values(UNITS_BY_SALE_TYPE).flat())]

export function unitsForSaleType(saleType) {
  return UNITS_BY_SALE_TYPE[saleType] || []
}

export function isUnitValidForSaleType(unit, saleType) {
  const allowed = UNITS_BY_SALE_TYPE[saleType]
  return !!allowed && allowed.includes(unit)
}

export function unitLabel(unit) {
  return UNIT_LABELS[unit] || unit
}

// Exact message the forms must surface when a Listing is submitted with a unit
// that does not belong to the chosen sales type. Format: "[Unit] is not valid
// for [Sale Type]."
export function saleUnitError(unit, saleType) {
  const u = unitLabel(unit)
  const s = SALE_TYPE_LABELS[saleType] || saleType || 'that sale type'
  return `${u} is not valid for ${s}.`
}

// Normalise a contact number into the international format used by every deep
// link in the ecosystem. Nigerian 080… numbers become 234…; +234 and bare 234
// are kept. Returns null for empty input so callers can hide the button.
function normalizeContact(contact) {
  if (!contact) return null
  let num = String(contact).replace(/\D/g, '')
  if (!num) return null
  if (num.startsWith('0')) num = '234' + num.slice(1)
  else if (!num.startsWith('234')) num = '234' + num
  return num
}

// Build a wa.me deep link from any phone/WhatsApp contact. The single place
// the ecosystem builds WhatsApp links (CareFind Search/DrugProfile/BusinessProfile,
// CareHub CareFind module preview). Returns null when there is no contact.
export function whatsappLink(contact, message) {
  const num = normalizeContact(contact)
  if (!num) return null
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}

// Normalise any phone/WhatsApp contact into a `tel:` deep link, handling
// Nigerian 080… numbers the same way whatsappLink does. Returns null when
// there is no contact so a Call button can be hidden.
export function telLink(contact) {
  const num = normalizeContact(contact)
  if (!num) return null
  return `tel:+${num}`
}