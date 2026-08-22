// Pure geospatial helpers for the field-activity location capture flow.
// No dependencies, no I/O — every function here is unit-tested in geo.test.js.

const EARTH_RADIUS_M = 6371000
const toRad = (d) => (d * Math.PI) / 180

// Verification tolerance for a GPS fix versus the detected/selected facility.
// 150 m absorbs consumer-GPS drift (~20–100 m urban) without waving through a
// rep logging from across town. Tunable per call; this is the project default.
export const FACILITY_VERIFY_THRESHOLD_M = 150

// The five app-level facility categories. OSM amenities are collapsed onto
// these (see categoryFromAmenity). Kept here so the service, the picker UI and
// the tests all share one source of truth.
export const FACILITY_CATEGORY = {
  HOSPITAL: 'Hospital',
  PHARMACY: 'Pharmacy',
  CLINIC: 'Clinic/Diagnostic',
  OTHER: 'Other health facility',
}

// Filter keys used by the picker UI, mapped to the canonical category label.
export const FACILITY_FILTER_KEYS = {
  hospital: FACILITY_CATEGORY.HOSPITAL,
  pharmacy: FACILITY_CATEGORY.PHARMACY,
  clinic: FACILITY_CATEGORY.CLINIC,
  other: FACILITY_CATEGORY.OTHER,
}

/**
 * Great-circle distance between two { lat, lng } points, in metres.
 * Returns null when either point is missing or non-numeric — callers must
 * treat "cannot compute" as NOT verified rather than crashing the log flow.
 */
export function haversineMeters(a, b) {
  if (!a || !b) return null
  const lat1 = Number(a.lat)
  const lon1 = Number(a.lng)
  const lat2 = Number(b.lat)
  const lon2 = Number(b.lng)
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s))
}

/**
 * Does the GPS fix sit within `radiusM` of the resolved place? The default
 * tolerance absorbs consumer-GPS drift (~20–100 m urban) without waving
 * through a rep logging from across town.
 */
export function verifyPlaceMatch(placeCoords, gpsCoords, radiusM = 500) {
  const d = haversineMeters(placeCoords, gpsCoords)
  return d != null && d <= radiusM
}

/**
 * Human-readable distance for the facility picker. Under a kilometre we show
 * whole metres; at or past a kilometre we show one decimal of km.
 *   formatDistance(0)     -> "0 m"
 *   formatDistance(120)   -> "120 m"
 *   formatDistance(1400)  -> "1.4 km"
 *   formatDistance(12300) -> "12.3 km"
 */
export function formatDistance(m) {
  if (m == null || !Number.isFinite(m)) return ''
  if (m < 1000) return Math.round(m) + ' m'
  return (m / 1000).toFixed(1) + ' km'
}

/**
 * Map an OpenStreetMap amenity (or healthcare) tag onto the app's category
 * vocabulary. The Overpass query only asks for health amenities, so the
 * default "Other health facility" bucket is the right fallthrough for anything
 * we do not name explicitly.
 */
export function categoryFromAmenity(amenity) {
  switch ((amenity || '').toLowerCase()) {
    case 'hospital':
      return FACILITY_CATEGORY.HOSPITAL
    case 'pharmacy':
      return FACILITY_CATEGORY.PHARMACY
    case 'clinic':
    case 'doctors':
    case 'health_post':
    case 'dispensary':
    case 'birthing_center':
      return FACILITY_CATEGORY.CLINIC
    case 'dentist':
      return FACILITY_CATEGORY.OTHER
    default:
      return FACILITY_CATEGORY.OTHER
  }
}

/**
 * Does the GPS fix sit within `thresholdM` of the selected/captured facility?
 * Verification is distance-only — we never text-match facility names. A missing
 * GPS or facility coordinate means "unverified", which must not block a submit.
 */
export function verifyFacilityMatch(gpsCoords, facilityCoords, thresholdM = FACILITY_VERIFY_THRESHOLD_M) {
  const d = haversineMeters(facilityCoords, gpsCoords)
  return d != null && d <= thresholdM
}

// Compose a one-line address from OSM tags. Overpass returns raw `addr:*`
// sub-keys; we read those and fall back to the bare `road`/`city` shapes used by
// other geocoders so the function stays useful regardless of source.
function buildAddress(tags) {
  if (!tags) return ''
  const get = function (a, b) { return tags[a] || (b ? tags[b] : undefined) }
  const parts = []
  const road = get('addr:street', 'road')
  if (road) parts.push(road)
  const hn = get('addr:housenumber', 'house_number')
  if (hn) parts.push(hn)
  const suburb = get('addr:suburb', 'suburb') || get('addr:neighbourhood', 'neighbourhood')
  if (suburb) parts.push(suburb)
  const city = get('addr:city', 'city') || get('addr:town', 'town') || get('addr:state', 'state')
  if (city) parts.push(city)
  return parts.join(', ')
}

/**
 * Parse a raw Overpass JSON response into facility rows. Pure: no network, no
 * globals — feed it an Overpass `elements` blob and get back
 * `{ name, lat, lng, category, address }` rows. `node` results carry `lat/lon`
 * directly; `way` results carry them under `center`. Rows without coordinates
 * are dropped; rows without a name fall back to a readable label so the picker
 * never shows an empty row.
 */
export function parseOverpass(data) {
  if (!data || !Array.isArray(data.elements)) return []
  return data.elements
    .map(function (el) {
      const lat = el.lat != null ? Number(el.lat) : (el.center ? Number(el.center.lat) : null)
      const lng = el.lon != null ? Number(el.lon) : (el.center ? Number(el.center.lon) : null)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const tags = el.tags || {}
      const amenity = tags.amenity || tags.healthcare || ''
      const name = tags.name || (amenity ? (amenity.charAt(0).toUpperCase() + amenity.slice(1).replace(/_/g, ' ')) : 'Unnamed facility')
      return {
        name: name,
        lat: lat,
        lng: lng,
        category: categoryFromAmenity(amenity),
        address: buildAddress(tags),
      }
    })
    .filter(Boolean)
}

/**
 * Attach each facility's distance from the GPS fix, sort nearest-first, and cap
 * the result. `cap` defaults to 150 (the picker's hard ceiling). Distance is
 * rounded to whole metres; facilities whose distance cannot be computed sort to
 * the end rather than throwing.
 */
export function rankFacilities(facilities, gps, { cap = 150 } = {}) {
  if (!Array.isArray(facilities)) return []
  return facilities
    .map(function (f) {
      const d = haversineMeters({ lat: f.lat, lng: f.lng }, gps)
      return { ...f, distanceM: d == null ? Number.POSITIVE_INFINITY : Math.round(d) }
    })
    .sort(function (a, b) { return a.distanceM - b.distanceM })
    .slice(0, cap)
}

/**
 * Does a facility belong to a picker filter bucket? `filterKey` is one of the
 * FACILITY_FILTER_KEYS keys, or 'all'. Category comparison is exact against the
 * canonical label, so the UI and the data never drift.
 */
export function matchesCategory(facility, filterKey) {
  if (!filterKey || filterKey === 'all') return true
  const target = FACILITY_FILTER_KEYS[filterKey]
  if (!target) return true
  return (facility.category || '') === target
}
