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
// price-visibility toggle off (show_price defaults to true) AND a price
// actually exists. Everything else renders "Ask for price".
export function canShowPrice(product) {
  return product && product.show_price !== false && product.price != null
}

// Resolve the best available coordinates for a product listing:
// product own lat/lng first, then its business, then nothing.
export function productCoords(product) {
  if (product && product.latitude != null && product.longitude != null) {
    return { lat: product.latitude, lng: product.longitude }
  }
  const biz = product?.businesses
  if (biz && biz.latitude != null && biz.longitude != null) {
    return { lat: biz.latitude, lng: biz.longitude }
  }
  return null
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

// "820 m away" under 1 km, "2.4 km away" beyond.
export function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return null
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km away`
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
