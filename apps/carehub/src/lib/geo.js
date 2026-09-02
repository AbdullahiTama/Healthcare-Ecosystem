// Pure geospatial helpers for the field-activity location capture flow.
// No dependencies, no I/O — every function here is unit-tested in geo.test.js.

const EARTH_RADIUS_M = 6371000
const toRad = (d) => (d * Math.PI) / 180

// Verification tolerance for a GPS fix versus the detected/selected facility.
// 150 m absorbs consumer-GPS drift (~20–100 m urban) without waving through a
// rep logging from across town. Tunable per call; this is the project default.
export const FACILITY_VERIFY_THRESHOLD_M = 150

// All healthcare facility categories supported by CareFind. This list is the
// canonical taxonomy used by the facility selector and the GPS discovery
// service. Every category already configured in CareFind is represented here so
// a Manufacturer/Importer (or any business type) can find and log any nearby
// healthcare facility — the user’s business_type never restricts which
// facility categories are visible. Kept here so the service, the picker UI and
// the tests all share one source of truth.
export const FACILITY_CATEGORY = {
  HOSPITAL: 'Hospital',
  PHARMACY: 'Pharmacy',
  LABORATORY: 'Medical Laboratory / Diagnostic Centre',
  CLINIC: 'Clinic',
  MEDICAL_CENTRE: 'Medical Centre',
  AESTHETIC_CLINIC: 'Aesthetic Clinic',
  COSMETICS_SPA: 'Cosmetics & Spa',
  SPECIALIST_CLINIC: 'Specialist Clinic',
  DENTAL: 'Dental Clinic',
  EYE: 'Eye Clinic / Optometry Centre',
  PHYSIO: 'Physiotherapy / Rehabilitation Centre',
  PRIMARY: 'Primary Health Centre / Community Health Centre',
  OTHER: 'Other Health Facility',
  // Legacy aliases — rows written before this expansion still carry these
  // values. They are kept so old cached/rep-added rows remain readable and
  // filter correctly without a data migration.
  CLINIC_DIAGNOSTIC_LEGACY: 'Clinic/Diagnostic',
  OTHER_LEGACY: 'Other health facility',
}

// Filter keys used by the picker UI. The four buckets below are the
// user-visible pills (All + 4 category groups). Detailed categories are
// collapsed onto these buckets so the existing UI keeps working while the
// underlying taxonomy expands to the 13 facility types required for
// Manufacturer/Importer visits.
export const FACILITY_FILTER_KEYS = {
  hospital: FACILITY_CATEGORY.HOSPITAL,
  pharmacy: FACILITY_CATEGORY.PHARMACY,
  clinic: FACILITY_CATEGORY.CLINIC,
  other: FACILITY_CATEGORY.OTHER,
}

// Families for bucket matching — which detailed categories belong to which
// picker pill. This is the eligibility rule: every facility category belongs
// to exactly one bucket, and `matchesCategory` uses these sets.
const CLINIC_FAMILY = new Set([
  FACILITY_CATEGORY.CLINIC,
  FACILITY_CATEGORY.CLINIC_DIAGNOSTIC_LEGACY,
  FACILITY_CATEGORY.LABORATORY,
  FACILITY_CATEGORY.MEDICAL_CENTRE,
  FACILITY_CATEGORY.SPECIALIST_CLINIC,
])

const OTHER_FAMILY = new Set([
  FACILITY_CATEGORY.OTHER,
  FACILITY_CATEGORY.OTHER_LEGACY,
  FACILITY_CATEGORY.DENTAL,
  FACILITY_CATEGORY.EYE,
  FACILITY_CATEGORY.PHYSIO,
  FACILITY_CATEGORY.PRIMARY,
  FACILITY_CATEGORY.AESTHETIC_CLINIC,
  FACILITY_CATEGORY.COSMETICS_SPA,
])

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
 * Map an OpenStreetMap tag onto the app's category vocabulary. The input may
 * come from amenity, healthcare, or shop tags — parseOverpass tries them in
 * that order — so this function handles all three vocabularies. Diagnostic
 * centres, eye clinics, physiotherapy, dental, aesthetic/beauty and primary
 * health centres are all mapped to their canonical categories so the GPS
 * discovery and the category filters can surface them.
 *
 * This is intentionally NOT gated by business_type: a Manufacturer/Importer
 * user must be able to discover any healthcare facility category, so the
 * mapping is purely tag → category, never user → allowed categories.
 */
export function categoryFromAmenity(amenity) {
  const raw = (amenity || '').toLowerCase().trim()
  if (!raw) return FACILITY_CATEGORY.OTHER
  // Normalise common OSM spellings / separators
  const v = raw.replace(/-/g, '_')

  // Direct amenity/healthcare/shop values
  switch (v) {
    case 'hospital':
      return FACILITY_CATEGORY.HOSPITAL
    case 'pharmacy':
      return FACILITY_CATEGORY.PHARMACY
    case 'laboratory':
    case 'lab':
    case 'diagnostic':
    case 'diagnostics':
    case 'blood_donation':
      return FACILITY_CATEGORY.LABORATORY
    case 'clinic':
    case 'doctors':
    case 'doctor':
      return FACILITY_CATEGORY.CLINIC
    case 'medical_centre':
    case 'medical_center':
    case 'centre':
    case 'center':
      return FACILITY_CATEGORY.MEDICAL_CENTRE
    case 'specialist':
    case 'specialist_clinic':
      return FACILITY_CATEGORY.SPECIALIST_CLINIC
    case 'dentist':
      return FACILITY_CATEGORY.DENTAL
    case 'optician':
    case 'optometry':
    case 'optometrist':
    case 'optics':
    case 'eye_clinic':
      return FACILITY_CATEGORY.EYE
    case 'physiotherapist':
    case 'physiotherapy':
    case 'rehabilitation':
    case 'rehab':
      return FACILITY_CATEGORY.PHYSIO
    case 'health_post':
    case 'dispensary':
    case 'birthing_center':
    case 'primary_health_care':
    case 'primary_health_centre':
    case 'primary_health_center':
    case 'community_health_centre':
    case 'community_health_center':
      return FACILITY_CATEGORY.PRIMARY
    case 'aesthetic':
    case 'aesthetic_clinic':
    case 'dermatology':
      return FACILITY_CATEGORY.AESTHETIC_CLINIC
    case 'beauty':
    case 'cosmetics':
    case 'spa':
    case 'wellness':
      return FACILITY_CATEGORY.COSMETICS_SPA
    default:
      break
  }

  // Substring fallbacks for compound values like "healthcare=laboratory" already
  // stripped, but also handle tags such as "aesthetic_clinic" or "eye_clinic"
  // that may appear as combined strings, and shop values.
  if (v.includes('laboratory') || v.includes('diagnostic') || v.includes('lab')) return FACILITY_CATEGORY.LABORATORY
  if (v.includes('aesthetic')) return FACILITY_CATEGORY.AESTHETIC_CLINIC
  if (v.includes('beauty') || v.includes('cosmetic') || v.includes('spa')) return FACILITY_CATEGORY.COSMETICS_SPA
  if (v.includes('specialist')) return FACILITY_CATEGORY.SPECIALIST_CLINIC
  if (v.includes('dental') || v === 'dentist') return FACILITY_CATEGORY.DENTAL
  if (v.includes('optician') || v.includes('optometry') || v.includes('eye')) return FACILITY_CATEGORY.EYE
  if (v.includes('physio') || v.includes('rehab')) return FACILITY_CATEGORY.PHYSIO
  if (v.includes('primary') || v.includes('community_health')) return FACILITY_CATEGORY.PRIMARY
  if (v.includes('medical_centre') || v.includes('medical_center')) return FACILITY_CATEGORY.MEDICAL_CENTRE
  if (v === 'health_post' || v === 'dispensary' || v === 'birthing_center') return FACILITY_CATEGORY.PRIMARY
  if (v === 'clinic' || v === 'doctors' || v === 'doctor') return FACILITY_CATEGORY.CLINIC

  return FACILITY_CATEGORY.OTHER
}

// Backward-compatible alias — older code imports categoryFromAmenity for both
// amenity and healthcare values. parseOverpass also checks shop, healthcare
// and amenity; this wrapper keeps the name accurate.
export const categoryFromHealthcare = categoryFromAmenity

/**
 * Does the GPS fix sit within `thresholdM` of the selected/captured facility?
 * Verification is distance-only — we never text-match facility names. A missing
 * GPS or facility coordinate means "unverified", which must not block a submit.
 */
export function verifyFacilityMatch(gpsCoords, facilityCoords, thresholdM = FACILITY_VERIFY_THRESHOLD_M) {
  const d = haversineMeters(facilityCoords, gpsCoords)
  return d != null && d <= thresholdM
}

// The three states a logged location can be in. 'pending' is not a weaker
// 'verified' — it means the question has not been asked yet.
export const FACILITY_VERIFICATION = {
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
}

/**
 * Verification state for a chosen facility against the rep's GPS fix.
 *
 * A rep-added facility awaiting review CANNOT be verified, however close the
 * GPS says it is: its coordinates ARE the rep's own GPS (the picker attaches
 * them), so the distance is 0 by construction and the check would be circular.
 * Distance can only corroborate a position that came from somewhere else — a
 * facility detected from the map, or a rep-added one a manager has confirmed.
 * Until then the honest answer is 'pending', not a green tick on a name the rep
 * typed themselves.
 *
 * Never throws and never blocks a submit: no GPS, no facility, or coordinates
 * that cannot be compared all read as 'unverified'.
 */
export function facilityVerification(gpsCoords, facility, thresholdM = FACILITY_VERIFY_THRESHOLD_M) {
  if (!facility) return FACILITY_VERIFICATION.UNVERIFIED
  if (facility.pendingReview) return FACILITY_VERIFICATION.PENDING
  return verifyFacilityMatch(gpsCoords, { lat: facility.lat, lng: facility.lng }, thresholdM)
    ? FACILITY_VERIFICATION.VERIFIED
    : FACILITY_VERIFICATION.UNVERIFIED
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
 *
 * Tags are read in priority amenity → healthcare → shop so a way tagged
 * healthcare=laboratory or shop=beauty is still classified, not dropped to
 * "Other".
 */
export function parseOverpass(data) {
  if (!data || !Array.isArray(data.elements)) return []
  return data.elements
    .map(function (el) {
      const lat = el.lat != null ? Number(el.lat) : (el.center ? Number(el.center.lat) : null)
      const lng = el.lon != null ? Number(el.lon) : (el.center ? Number(el.center.lon) : null)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const tags = el.tags || {}
      const rawTag = tags.amenity || tags.healthcare || tags.shop || tags.leisure || ''
      // Prefer a human label from the most specific tag that was actually set
      const amenity = rawTag
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
 * FACILITY_FILTER_KEYS keys, or 'all'. The four buckets collapse the 13
 * detailed healthcare facility categories so the existing filter pills keep
 * working while covering every facility type a Manufacturer/Importer may visit:
 *   - hospital  → Hospital only
 *   - pharmacy  → Pharmacy only
 *   - clinic    → Clinic/Diagnostic family (Clinic, Lab/Diagnostic, Medical
 *                 Centre, Specialist Clinic) including legacy "Clinic/Diagnostic"
 *   - other     → Other family (Dental, Eye, Physio/Rehab, Primary/Community,
 *                 Aesthetic, Cosmetics & Spa, Other)
 * Category comparison is bucket-aware, not strict equality, so the UI and the
 * data never drift and no business_type gating is applied.
 */
export function matchesCategory(facility, filterKey) {
  if (!filterKey || filterKey === 'all') return true
  const cat = (facility && facility.category) ? String(facility.category) : ''
  if (!cat) return false
  // Legacy rows use "Clinic/Diagnostic" — treat as clinic family
  if (filterKey === 'hospital') return cat === FACILITY_CATEGORY.HOSPITAL
  if (filterKey === 'pharmacy') return cat === FACILITY_CATEGORY.PHARMACY
  if (filterKey === 'clinic') return CLINIC_FAMILY.has(cat)
  if (filterKey === 'other') return OTHER_FAMILY.has(cat)
  // Unknown filter key — show all rather than hide (fail-open)
  const target = FACILITY_FILTER_KEYS[filterKey]
  if (!target) return true
  return cat === target
}
