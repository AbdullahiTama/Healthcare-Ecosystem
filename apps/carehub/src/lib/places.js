// Field-activity facility discovery — the GPS-driven replacement for the old
// free-text "Place of Visit" box.
//
// Design (issue #1):
//   * The rep's GPS is captured first; we never ask them to type a place name.
//   * We look up nearby health facilities from two layers:
//       1. our own cached tables (facilities_cache + rep_added_facilities) — fast,
//          offline-tolerant, and where user-added places live for everyone;
//       2. OpenStreetMap's Overpass API (free, no key, CORS-enabled) — only when
//          the cache is thin for this spot.
//   * The single closest facility is auto-selected; the rep may open the full
//     nearest-first list (capped at 150) and pick another, or add a missing one.
//   * Verification is DISTANCE-ONLY: a fix within FACILITY_VERIFY_THRESHOLD_M of
//     the facility is "verified". We never text-match names.
//
// Everything here is client-side and keyless, mirroring the existing
// reverseGeocode/geocodePlace Nominatim calls in services/supabase.js.

import { sbFetch, notify } from '../services/supabase.js'
import { isManagerRole } from './permissions.js'
import {
  parseOverpass, rankFacilities, matchesCategory, haversineMeters,
} from './geo.js'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
// Healthcare facilities to discover via Overpass. We query amenity, healthcare
// and shop tags so a pharmacy, a laboratory, a physiotherapy centre, an eye
// clinic (optician), a beauty/spa facility and all other CareFind healthcare
// categories are discoverable — not just hospitals. The regex is intentionally
// broad so Manufacturer/Importer users can find the same complete set of
// facilities as any other business type. business_type never restricts which
// categories are queried: the GPS and the map are the only filters.
const AMENITY_REGEX = 'hospital|pharmacy|clinic|doctors|dentist|health_post|dispensary|birthing_center|laboratory'
const HEALTHCARE_REGEX = 'hospital|pharmacy|clinic|doctor|dentist|laboratory|physiotherapist|optician|centre|hospice|alternative|rehabilitation|primary|health_care|vaccination|blood_donation|aesthetic|manufacturer|importer|distributor'
const SHOP_REGEX = 'beauty|cosmetics|optician|medical_supply|spa|wellness|pharmacy'
const DEFAULT_RADIUS = 800
const CACHE_MIN_RESULTS = 5
export const MAX_FACILITIES = 150
// Progressive radii for nearby discovery — expand when thin, no hard 200m cap
export const PROGRESSIVE_RADII = [500, 1000, 2000, 5000]

// Picker filter buckets (UI order). `key` is what matchesCategory understands.
// Full 16-category set + All. Legacy 4-pill UI still works because 'clinic' and
// 'other' remain bucket keys; the new discovery surface uses the full set.
// Business_type never gates visibility.
export const FACILITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'hospital', label: 'Hospital' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'medical_centre', label: 'Medical Centre' },
  { key: 'laboratory', label: 'Lab/Diagnostic' },
  { key: 'specialist', label: 'Specialist Clinic' },
  { key: 'dental', label: 'Dental' },
  { key: 'eye', label: 'Eye/Optometry' },
  { key: 'physio', label: 'Physio/Rehab' },
  { key: 'primary', label: 'PHC/Community' },
  { key: 'aesthetic', label: 'Aesthetic' },
  { key: 'cosmetics', label: 'Cosmetics/Beauty' },
  { key: 'spa', label: 'Spa' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'importer', label: 'Importer' },
  { key: 'distributor', label: 'Distributor' },
  { key: 'other', label: 'Other' },
]

// Build an Overpass QL query for a radius around a point. `out center` gives us
// way centroids so polygons (hospitals are often mapped as ways) still resolve.
// The query covers amenity, healthcare and shop tags so every CareFind
// healthcare facility category — not just Hospital — is discoverable via GPS.
export function buildOverpassQuery(lat, lng, radius) {
  const bbox = '(around:' + radius + ',' + lat + ',' + lng + ')'
  return '[out:json][timeout:25];(' +
    'node["amenity"~"' + AMENITY_REGEX + '"]' + bbox + ';' +
    'way["amenity"~"' + AMENITY_REGEX + '"]' + bbox + ';' +
    'node["healthcare"~"' + HEALTHCARE_REGEX + '"]' + bbox + ';' +
    'way["healthcare"~"' + HEALTHCARE_REGEX + '"]' + bbox + ';' +
    'node["shop"~"' + SHOP_REGEX + '"]' + bbox + ';' +
    'way["shop"~"' + SHOP_REGEX + '"]' + bbox + ';' +
    ');out center 150;'
}

// Fetch + parse Overpass. Throws on transport/HTTP failure so the caller can
// fall back to the cache rather than surface an empty list as an error.
export async function fetchOverpass(lat, lng, radius = DEFAULT_RADIUS) {
  const body = 'data=' + encodeURIComponent(buildOverpassQuery(lat, lng, radius))
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  })
  if (!res.ok) throw new Error('Overpass lookup failed (' + res.status + ')')
  const data = await res.json()
  return parseOverpass(data)
}

// Stable dedupe key for merging cache + fresh results.
function dedupeKey(f) {
  const lat = Number(f.lat).toFixed(5)
  const lng = Number(f.lng).toFixed(5)
  return (f.name || '') + '|' + lat + ',' + lng
}

function mergeFacilities(a, b) {
  const seen = new Set()
  const out = []
  a.concat(b).forEach(function (f) {
    const k = dedupeKey(f)
    if (seen.has(k)) return
    seen.add(k)
    out.push(f)
  })
  return out
}

// Read cached + user-added facilities for a business within `radius` of the
// GPS, as plain facility rows. Distance filtering is done in JS (PostgREST has
// no haversine), which is fine at the volumes involved.
async function readCachedNearby(businessId, lat, lng, radius) {
  const gps = { lat: lat, lng: lng }
  const within = function (row) {
    const d = haversineMeters({ lat: row.lat, lng: row.lng }, gps)
    return d != null && d <= radius
  }

  const cacheRows = await sbFetch(
    'facilities_cache?business_id=eq.' + businessId +
    '&select=id,name,lat,lng,category,address,source'
  ).catch(function (e) { console.error('facilities_cache read failed:', e); return [] })

  // NOTE: rep_added_facilities has NO `address` column — the rep only ever types
  // a name (the picker attaches GPS). Selecting one here made PostgREST reject
  // the whole request, and the catch below swallowed it, so rep-added places
  // silently never reached anyone's nearby list. Keep this select in step with
  // 20260822_field_activity_facility_location.sql.
  const repRows = await sbFetch(
    'rep_added_facilities?business_id=eq.' + businessId +
    '&status=in.(confirmed,pending_review)' +
    '&select=id,name,lat,lng,category,status'
  ).catch(function (e) { console.error('rep_added_facilities read failed:', e); return [] })

  // A cached row is either map-detected or a manager-confirmed promotion, so it
  // is always reviewed. Only rows still sitting in the rep queue are pending —
  // `pendingReview` is what stops a rep's own typed place from counting as GPS
  // verification (see facilityVerification in geo.js).
  const fromCache = (cacheRows || []).filter(within).map(function (r) {
    return {
      id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng),
      category: r.category, address: r.address || '', source: r.source || 'detected',
      pendingReview: false,
    }
  })
  const fromRep = (repRows || []).filter(within).map(function (r) {
    return {
      id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng),
      category: r.category || 'Other health facility', address: '',
      source: 'rep_added',
      pendingReview: r.status !== 'confirmed',
    }
  })
  return fromCache.concat(fromRep)
}

// Upsert discovered facilities into the cache so the next near visit is instant.
// The unique index (business_id, name, lat, lng) makes repeated inserts idempotent.
async function upsertCachedFacilities(businessId, facilities) {
  if (!facilities || facilities.length === 0) return
  const rows = facilities.map(function (f) {
    return {
      business_id: businessId,
      name: f.name,
      lat: f.lat,
      lng: f.lng,
      category: f.category,
      address: f.address || null,
      source: 'detected',
    }
  })
  await sbFetch('facilities_cache?on_conflict=business_id,name,lat,lng', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: JSON.stringify(rows),
  })
}

/**
 * Insert a rep-added (missing) facility. GPS is auto-attached by the picker, so
 * the row has real coordinates and will surface for everyone near it later.
 * Returns the created row (or null on failure — adding must not block the log).
 */
export async function addRepAddedFacility(businessId, facility, createdBy) {
  try {
    const rows = await sbFetch('rep_added_facilities', {
      method: 'POST',
      body: JSON.stringify({
        business_id: businessId,
        name: facility.name,
        lat: facility.lat,
        lng: facility.lng,
        category: facility.category || 'Other health facility',
        status: 'pending_review',
        created_by: createdBy || null,
      }),
    })
    const saved = Array.isArray(rows) ? rows[0] : rows
    // Flag managers + owner for review in the background (must not block the log).
    flagRepAddedForReview(businessId, facility.name).catch(function () {})
    return saved
  } catch (e) {
    console.error('Could not save rep-added facility:', e)
    return null
  }
}

// Notify a business's managers and owner that a rep added a facility needing
// review. Best-effort: failures are swallowed so they never block the rep.
async function flagRepAddedForReview(businessId, facilityName) {
  // Fetch the roster and filter with the shared predicate rather than pushing a
  // role filter into PostgREST. The previous `role=in.(Manager,Owner)` matched
  // nothing in practice: Manufacturer/Importer tenants type their own role
  // names ("Regional Manager", "<Brand> Manager"), and an owner has no staff
  // row at all — so every manager silently missed the review notification.
  // A business roster is small; this is one small read per rep-added facility.
  const staff = await sbFetch(
    'staff?business_id=eq.' + businessId + '&select=id,role'
  ).catch(function (e) { console.error('Manager lookup failed:', e); return [] })
  const recipients = (staff || [])
    .filter(function (m) { return isManagerRole(m.role) })
    .map(function (m) { return { staffId: m.id } })
  // Owner has no staff row — an is_owner notification uses a null staff_id.
  recipients.push({ staffId: null })
  notify(
    businessId,
    recipients,
    'facility_review',
    'New facility needs review',
    (facilityName || 'A facility') + ' was added by a rep and is pending review.',
    'activity'
  )
}

/**
 * List rep-added facilities for a business, optionally filtered by status
 * ('pending_review' for the manager review queue, 'confirmed' for the audited set).
 */
export async function getRepAddedFacilities(businessId, status) {
  let url = 'rep_added_facilities?business_id=eq.' + businessId
  if (status) url += '&status=eq.' + status
  url += '&order=created_at.desc&select=*'
  return sbFetch(url).catch(function () { return [] })
}

/**
 * Manager confirms a rep-added facility. Flips the row to 'confirmed' AND promotes
 * it into facilities_cache so it becomes a normal, cached entry that every future
 * rep near the same coordinates will see automatically. Never throws — the caller
 * decides how to surface an error.
 */
export async function confirmRepAddedFacility(id, businessId) {
  // No `address` column on this table (see readCachedNearby) — selecting one
  // made every Confirm fail, so no rep-added facility could ever be promoted.
  const rows = await sbFetch('rep_added_facilities?id=eq.' + id + '&select=name,lat,lng,category')
  const f = Array.isArray(rows) ? rows[0] : rows
  await sbFetch('rep_added_facilities?id=eq.' + id, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed' }),
    prefer: 'return=minimal',
  })
  if (f) {
    await sbFetch('facilities_cache?on_conflict=business_id,name,lat,lng', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: JSON.stringify([{
        business_id: businessId,
        name: f.name,
        lat: f.lat,
        lng: f.lng,
        category: f.category,
        address: null,
        source: 'rep_added',
      }]),
    }).catch(function () {})
  }
}

/**
 * Manager dismisses a rep-added facility (wrong place, duplicate, spam). Removes
 * the row — it will no longer appear in anyone's nearby list.
 */
export async function dismissRepAddedFacility(id) {
  return sbFetch('rep_added_facilities?id=eq.' + id, {
    method: 'DELETE',
    prefer: 'return=minimal',
  })
}

// Internal CareFind facilities fetch — paged (state,lga,city) with optional category/keyword
// Uses sbFetch pagedQuery internally; called by facilityDiscovery engine.
// Kept in places.js as transport layer (no ranking/dedupe), intelligence lives in facilityDiscovery.js.
export async function fetchCareFindFacilities({ state, lga, city, category, keyword, limit = 50, offset = 0 } = {}) {
  const params = []
  if (state) params.push('state=ilike.*' + encodeURIComponent(state) + '*')
  if (lga) params.push('lga=ilike.*' + encodeURIComponent(lga) + '*')
  if (city) params.push('city=ilike.*' + encodeURIComponent(city) + '*')
  // visible_on_carefind or status filter omitted for discovery completeness — spec says no hidden gate
  let q = 'businesses?select=id,name,business_type,state,city,lga,area,address,phone,latitude,longitude,lat,lng,category,website&order=created_at.desc'
  if (params.length) q += '&' + params.join('&')
  if (keyword) {
    const kw = encodeURIComponent(keyword)
    q += '&or=(name.ilike.*' + kw + '*,business_type.ilike.*' + kw + '*,city.ilike.*' + kw + '*,state.ilike.*' + kw + '*)'
  }
  q += '&limit=' + limit + '&offset=' + offset
  try {
    const rows = await sbFetch(q)
    return (rows || []).map(function (r) {
      const lat = r.latitude != null ? Number(r.latitude) : (r.lat != null ? Number(r.lat) : null)
      const lng = r.longitude != null ? Number(r.longitude) : (r.lng != null ? Number(r.lng) : null)
      return {
        id: 'carefind:' + r.id,
        business_id: r.id,
        name: r.name,
        lat: lat,
        lng: lng,
        category: r.category || r.business_type || 'Other Health Facility',
        address: r.address || [r.city, r.state].filter(Boolean).join(', '),
        state: r.state || null,
        lga: r.lga || null,
        area: r.area || null,
        city: r.city || null,
        phone: r.phone || null,
        source: 'carefind',
        sourceRef: r.id,
        businessType: r.business_type,
      }
    }).filter(function (f) { return f.name })
  } catch (e) {
    console.error('CareFind fetch failed:', e)
    return []
  }
}

// Tiled Overpass for large area/boundary searches — partition per provider limits.
// For point searches we single-tile; for boundary we generate grid tiles inside bbox.
export async function fetchOverpassTiled({ centre, boundary, radius = DEFAULT_RADIUS } = {}) {
  // Simple single-tile for point search; boundary tiling stub — partition into ~10km tiles
  if (boundary && boundary.south != null) {
    const tiles = partitionBoundary(boundary, 4) // up to 4 tiles to respect rate limits
    const results = []
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]
      try {
        const rows = await fetchOverpass(t.lat, t.lng, t.radius)
        results.push(...rows)
      } catch (e) {
        console.error('Tiled Overpass tile failed:', e)
      }
      // Attribution respect: small delay between tiles to avoid hammering
      if (i < tiles.length - 1) await new Promise(function (r) { setTimeout(r, 250) })
    }
    return results
  }
  if (centre && Number.isFinite(centre.lat)) {
    return fetchOverpass(centre.lat, centre.lng, radius)
  }
  return []
}

function partitionBoundary(boundary, maxTiles) {
  const south = boundary.south, north = boundary.north, west = boundary.west, east = boundary.east
  const latRange = north - south
  const lngRange = east - west
  // Approximate ~20km per degree; partition large states (Lagos etc) into tiles
  // For spec compliance, we cap to maxTiles and use centre + expanded radius
  if (latRange < 0.5 && lngRange < 0.5) {
    const centreLat = (south + north) / 2
    const centreLng = (west + east) / 2
    const diag = haversineMeters({ lat: south, lng: west }, { lat: north, lng: east }) || 5000
    return [{ lat: centreLat, lng: centreLng, radius: Math.min(Math.ceil(diag / 2) + 5000, 40000) }]
  }
  const tiles = []
  const rows = Math.ceil(Math.sqrt(maxTiles))
  const cols = rows
  const dLat = latRange / rows
  const dLng = lngRange / cols
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tiles.length >= maxTiles) break
      const tileSouth = south + r * dLat
      const tileNorth = south + (r + 1) * dLat
      const tileWest = west + c * dLng
      const tileEast = west + (c + 1) * dLng
      const centreLat = (tileSouth + tileNorth) / 2
      const centreLng = (tileWest + tileEast) / 2
      const diag = haversineMeters({ lat: tileSouth, lng: tileWest }, { lat: tileNorth, lng: tileEast }) || 5000
      tiles.push({ lat: centreLat, lng: centreLng, radius: Math.min(Math.ceil(diag / 2) + 2000, 30000) })
    }
  }
  return tiles
}

/**
 * Main entry point used by logger and discovery.
 * Progressive radius: start at requested radius (default 800), expand stepwise
 * until CACHE_MIN_RESULTS or radii exhausted. No hard 200m cap — Nearby uses
 * 500-1000 progressive, Area/State/LGA boundary uses tiled fetch.
 * Rank nearest-first, pagination via cursor (offset/limit) not fixed UI cap.
 */
export async function nearbyHealthFacilities(lat, lng, options = {}) {
  const { radius = DEFAULT_RADIUS, category = 'all', businessId, limit, offset, useProgressive = true } = options
  const gps = { lat: lat, lng: lng }
  let fromCache = true
  let pool = []
  const baseRadius = radius
  const radii = useProgressive ? [baseRadius].concat(PROGRESSIVE_RADII.filter(function (r) { return r > baseRadius })) : [baseRadius]
  // Try cache at smallest radius first
  if (businessId) {
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]
      const cached = await readCachedNearby(businessId, lat, lng, r)
      if (cached.length >= CACHE_MIN_RESULTS || i === radii.length - 1) {
        pool = cached
        break
      }
      // If not enough at this radius, keep trying larger before falling to Overpass
      if (cached.length > pool.length) pool = cached
    }
  }
  // If still thin, fetch from Overpass progressively (respect provider limits with largest radius last)
  if (pool.length < CACHE_MIN_RESULTS) {
    fromCache = false
    let fresh = []
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]
      try {
        fresh = await fetchOverpass(lat, lng, r)
        if (fresh.length >= 5) break
      } catch (e) {
        console.error('Overpass lookup failed, using cache only:', e)
        fresh = []
      }
    }
    if (fresh.length > 0) {
      const ranked = rankFacilities(fresh, gps, { cap: MAX_FACILITIES })
      if (businessId) await upsertCachedFacilities(businessId, ranked).catch(function () {})
      pool = mergeFacilities(pool, ranked)
    }
  }
  const filtered = pool.filter(function (f) { return matchesCategory(f, category) })
  const ranked = rankFacilities(filtered, gps, { cap: limit || MAX_FACILITIES })
  // Cursor pagination if offset provided
  const start = offset && offset > 0 ? offset : 0
  const page = limit ? ranked.slice(start, start + limit) : ranked.slice(start)
  return {
    facilities: page,
    fromCache: fromCache,
    total: ranked.length,
  }
}
