// Shared marketplace helpers: price visibility, sale-type tagging and
// distance calculation. Single definitions so every buyer view (Search,
// product detail, featured rails, seller dashboards) renders the same way.

// Sale types, their labels and the allowed unit-per-sale-type matrix come
// from the shared package so CareHub and CareFind are always in agreement.
export {
  SALE_TYPES,
  SALE_TYPE_LABELS,
  UNITS_BY_SALE_TYPE,
  ALL_UNITS,
  UNIT_LABELS,
  unitsForSaleType,
  isUnitValidForSaleType,
  unitLabel,
  saleUnitError,
} from '@care-ecosystem/shared-marketplace'

// A product shows its price only when the seller has not turned the
// per-product price-visibility toggle off (show_price defaults to true),
// the owning business has not hidden all its prices on CareFind
// (show_prices defaults to true), and a price actually exists. Everything
// else renders "Ask for price".
export function canShowPrice(product) {
  return product
    && product.show_price !== false
    && product.businesses?.show_prices !== false
    && product.price != null
}

// Resolve coordinates from either naming convention. The CareHub registration
// and settings flows write `lat`/`lng`; CareFind reads `latitude`/`longitude`
// elsewhere. Live DB has lat/lng populated (22 rows) and latitude/longitude
// always null, so coalesce both to keep distance working regardless of writer.
export function coordsFrom(row) {
  if (!row) return null
  if (row.latitude != null && row.longitude != null) {
    return { lat: row.latitude, lng: row.longitude }
  }
  if (row.lat != null && row.lng != null) {
    return { lat: row.lat, lng: row.lng }
  }
  return null
}

// Resolve the best available coordinates for a business (or any geocoded row).
export function businessCoords(biz) {
  return coordsFrom(biz)
}

// Resolve the best available coordinates for a product listing:
// product own coordinates first, then its business, then nothing.
export function productCoords(product) {
  const own = coordsFrom(product)
  if (own) return own
  return coordsFrom(product?.businesses)
}

// Haversine distance in metres between two coordinates.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// "850m away" under 1 km, "2.3km away" beyond.
export function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return null
  if (meters < 1000) return `${Math.round(meters)}m away`
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km away`
}

export function distanceLabel(product, userCoords) {
  const coords = productCoords(product)
  if (!coords || !userCoords || userCoords.lat == null) return null
  return formatDistance(haversineMeters(userCoords.lat, userCoords.lng, coords.lat, coords.lng))
}

export function saleTypeColor(type) {
  if (type === 'wholesale' || type === 'distributor') return '#7c3aed'
  return '#0E6F5A'
}

// Build a wa.me deep link from any phone/WhatsApp contact, handling Nigerian
// 080… numbers. Returns null when there is no contact. The single place the
// ecosystem builds WhatsApp links (Search, DrugProfile, BusinessProfile
// previously each hand-rolled a copy).
export function whatsappLink(contact, message) {
  if (!contact) return null
  let num = String(contact).replace(/\D/g, '')
  if (!num) return null
  if (num.startsWith('0')) num = '234' + num.slice(1)
  else if (!num.startsWith('234')) num = '234' + num
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`
}

// Normalise any phone/WhatsApp contact into a `tel:` deep link, handling
// Nigerian 080… numbers the same way whatsappLink does. Returns null when
// there is no contact so a Call button can be hidden.
export function telLink(contact) {
  if (!contact) return null
  let num = String(contact).replace(/\D/g, '')
  if (!num) return null
  if (num.startsWith('0')) num = '234' + num.slice(1)
  else if (!num.startsWith('234')) num = '234' + num
  return `tel:+${num}`
}
