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
// Health amenities we care about. `healthcare=*` is accepted as a fallback tag
// inside parseOverpass but the Overpass query keys off `amenity`.
const AMENITY_REGEX = 'hospital|pharmacy|clinic|doctors|dentist|health_post|dispensary|birthing_center'
const DEFAULT_RADIUS = 200
const CACHE_MIN_RESULTS = 5
export const MAX_FACILITIES = 150

// Picker filter buckets (UI order). `key` is what matchesCategory understands.
export const FACILITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'hospital', label: 'Hospital' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'clinic', label: 'Clinic-Diagnostic' },
  { key: 'other', label: 'Other health facility' },
]

// Build an Overpass QL query for a radius around a point. `out center` gives us
// way centroids so polygons (hospitals are often mapped as ways) still resolve.
export function buildOverpassQuery(lat, lng, radius) {
  const bbox = '(around:' + radius + ',' + lat + ',' + lng + ')'
  return '[out:json][timeout:25];(' +
    'node["amenity"~"' + AMENITY_REGEX + '"]' + bbox + ';' +
    'way["amenity"~"' + AMENITY_REGEX + '"]' + bbox + ';' +
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
    '&select=id,name,lat,lng,category'
  ).catch(function (e) { console.error('rep_added_facilities read failed:', e); return [] })

  const fromCache = (cacheRows || []).filter(within).map(function (r) {
    return {
      id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng),
      category: r.category, address: r.address || '', source: r.source || 'detected',
    }
  })
  const fromRep = (repRows || []).filter(within).map(function (r) {
    return {
      id: r.id, name: r.name, lat: Number(r.lat), lng: Number(r.lng),
      category: r.category || 'Other health facility', address: '',
      source: 'rep_added',
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

/**
 * Main entry point used by the logger and the manager review tool.
 *
 * 1. Reads cached + rep-added facilities near the coords first.
 * 2. If that yields fewer than CACHE_MIN_RESULTS for this spot, tops up from
 *    Overpass (parsed, ranked, capped at 150) and writes the fresh ones to the
 *    cache. A failed Overpass call degrades gracefully to the cache alone.
 * 3. Filters by `category` and returns the nearest-first, capped list plus a
 *    `fromCache` flag the UI can show ("live" vs "cached").
 */
export async function nearbyHealthFacilities(lat, lng, options = {}) {
  const { radius = DEFAULT_RADIUS, category = 'all', businessId } = options
  const gps = { lat: lat, lng: lng }
  let fromCache = true

  let pool = []
  if (businessId) {
    pool = await readCachedNearby(businessId, lat, lng, radius)
  }

  if (pool.length < CACHE_MIN_RESULTS) {
    fromCache = false
    let fresh = []
    try {
      fresh = await fetchOverpass(lat, lng, radius)
    } catch (e) {
      console.error('Overpass lookup failed, using cache only:', e)
      fresh = []
    }
    if (fresh.length > 0) {
      const ranked = rankFacilities(fresh, gps, { cap: MAX_FACILITIES })
      if (businessId) await upsertCachedFacilities(businessId, ranked).catch(function () {})
      pool = mergeFacilities(pool, ranked)
    }
  }

  const filtered = pool.filter(function (f) { return matchesCategory(f, category) })
  return {
    facilities: rankFacilities(filtered, gps, { cap: MAX_FACILITIES }),
    fromCache: fromCache,
  }
}
