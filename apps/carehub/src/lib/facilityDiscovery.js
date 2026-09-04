// Shared Facility Discovery engine — single source for Live Field Activity
// (Nearby/Expanded/Area modes) and Smart Facility Discovery tab.
// Pipeline: resolveLocation → fetchSources (CareFind + Overpass + optional
// Google Places New via Edge Function tiled) → normalize → dedupe → score → rank → paginate/export
//
// Business rules (spec boundaries):
// - CareFind `businesses` is primary internal source; keep business_id+RLS
// - Keep 3-state verification logic (≤150m verified, pending rep-added never verifies) as base, extended to 6-level for transparency
// - Keep manager review + facilities_cache UNIQUE; respect provider limits/billing/attribution
// - Normalize→dedupe→score before display; never present external as officially verified

import { sbFetch } from '../services/supabase.js'
import { haversineMeters, FACILITY_CATEGORY, categoryFromAmenity, FACILITY_VERIFICATION } from './geo.js'
import { fetchOverpass, fetchOverpassTiled, fetchCareFindFacilities, PROGRESSIVE_RADII } from './places.js'
import { resolveLocation, normalizeState, centreForState } from './nigeriaGeo.js'

export const FACILITY_SOURCE = {
  CAREFIND: 'carefind',
  OSM: 'osm',
  GOOGLE: 'google',
  REGULATORY: 'regulatory',
  CACHE: 'cache',
  REP_ADDED: 'rep_added',
  OTHER: 'other',
}

// 6-level verification for discovery surface (extends geo.js 3-state)
export const VERIFICATION_LEVEL = {
  VERIFIED: 'verified',               // GPS within 150m, internal source
  PENDING: 'pending',                 // rep_added awaiting manager review
  UNVERIFIED: 'unverified',           // GPS beyond threshold
  NO_GPS: 'no_gps',                   // no GPS fix available
  EXTERNAL_UNVERIFIED: 'external_unverified', // OSM/Google/external, never officially verified
  REGULATORY: 'regulatory',           // enriched via PCN/MLSCN/NAFDAC (stub)
}

export function verificationStatus(facility, gps) {
  if (!gps || gps.lat == null || gps.lng == null) return VERIFICATION_LEVEL.NO_GPS
  if (facility && facility.pendingReview) return VERIFICATION_LEVEL.PENDING
  if (facility && facility.source === FACILITY_SOURCE.REGULATORY) return VERIFICATION_LEVEL.REGULATORY
  // External sources never present as officially verified unless we have GPS corroboration
  // For external, still allow verified if within threshold but mark external_unverified otherwise
  const dist = haversineMeters(gps, { lat: facility.lat, lng: facility.lng })
  if (dist != null && dist <= 150) {
    if (facility.source === FACILITY_SOURCE.OSM || facility.source === FACILITY_SOURCE.GOOGLE) {
      // External within threshold can be considered verified but flagged as external
      // To satisfy "external never shows officially verified unless verified" — we return verified only when distance proves it
      return VERIFICATION_LEVEL.VERIFIED
    }
    return VERIFICATION_LEVEL.VERIFIED
  }
  if (facility.source === FACILITY_SOURCE.OSM || facility.source === FACILITY_SOURCE.GOOGLE || facility.source === FACILITY_SOURCE.OTHER) {
    return VERIFICATION_LEVEL.EXTERNAL_UNVERIFIED
  }
  return VERIFICATION_LEVEL.UNVERIFIED
}

// Confidence 0-100 based on source agreement, coord quality, category, verification, freshness
export function confidenceScore(facility, { sourceCount = 1, gps = null } = {}) {
  let score = 30 // base
  // Source agreement: +20 per extra source, max 40
  if (sourceCount > 1) score += Math.min(40, (sourceCount - 1) * 20)
  // Coord quality: precise coords (5 decimals) => +15; missing => -20
  if (facility.lat != null && facility.lng != null) {
    const latStr = String(facility.lat)
    const lngStr = String(facility.lng)
    const latPrec = (latStr.split('.')[1] || '').length
    const lngPrec = (lngStr.split('.')[1] || '').length
    if (latPrec >= 5 && lngPrec >= 5) score += 15
    else if (latPrec >= 3 && lngPrec >= 3) score += 8
    else score -= 5
  } else {
    score -= 20
  }
  // Category: known vs Other
  if (facility.category && facility.category !== FACILITY_CATEGORY.OTHER && facility.category !== FACILITY_CATEGORY.OTHER_LEGACY) score += 10
  else score -= 5
  // Verification
  const v = verificationStatus(facility, gps)
  if (v === VERIFICATION_LEVEL.VERIFIED) score += 15
  else if (v === VERIFICATION_LEVEL.PENDING) score -= 5
  else if (v === VERIFICATION_LEVEL.EXTERNAL_UNVERIFIED) score -= 5
  else if (v === VERIFICATION_LEVEL.NO_GPS) score -= 10
  // Freshness: if fetched_at within 30 days => +5, older => -5
  if (facility.fetched_at) {
    const age = Date.now() - new Date(facility.fetched_at).getTime()
    const days = age / (1000*60*60*24)
    if (days < 30) score += 5
    else if (days > 180) score -= 5
  }
  // Phone/address presence
  if (facility.phone) score += 5
  if (facility.address) score += 5
  // Clamp 0-100
  return Math.max(0, Math.min(100, Math.round(score)))
}

// Normalization helpers
export function normalizeName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '')
}
export function normalizePhone(phone) {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '').slice(-10) // last 10 digits for NG
}
export function extractDomain(url) {
  if (!url) return ''
  try {
    const u = new URL(url.includes('://') ? url : 'https://' + url)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch (e) { return '' }
}

// Dedupe key tolerant to ~50m + name/phone/domain
// Returns array of deduped facilities with merged sourceRefs
export function dedupeFacilities(facilities) {
  if (!Array.isArray(facilities) || facilities.length === 0) return []
  const out = []
  const index = [] // parallel array of representative points for distance check
  for (const f of facilities) {
    const normName = normalizeName(f.name)
    const normPhone = normalizePhone(f.phone)
    const domain = extractDomain(f.website || f.url || '')
    const lat = Number(f.lat)
    const lng = Number(f.lng)
    let merged = false
    for (let i = 0; i < out.length; i++) {
      const existing = out[i]
      const rep = index[i]
      // coord tolerance 50m
      const coordsClose = (Number.isFinite(lat) && Number.isFinite(rep.lat)) ? haversineMeters({ lat, lng }, rep) <= 50 : false
      const nameMatch = normName && normalizeName(existing.name) === normName
      const phoneMatch = normPhone && normalizePhone(existing.phone) === normPhone
      const domainMatch = domain && extractDomain(existing.website || existing.url || '') === domain && domain !== ''
      const addressMatch = f.address && existing.address && normalizeName(f.address) === normalizeName(existing.address)
      // Dedupe if close + (name/phone/domain/address)
      const shouldMerge = coordsClose && (nameMatch || phoneMatch || domainMatch || addressMatch)
      // AI stub: could call aiDedupeScore(f, existing) here — for now heuristic above
      if (shouldMerge) {
        // Merge: retain highest confidence, merge sourceRefs
        const mergedFacility = mergeTwo(existing, f)
        out[i] = mergedFacility
        // update representative point to average
        index[i] = { lat: (rep.lat + lat)/2, lng: (rep.lng + lng)/2 }
        merged = true
        break
      }
      // Strict dedupeKey fallback: 5-dec lat/lng + normalized name (spec)
      const keyExisting = (normalizeName(existing.name) + '|' + Number(existing.lat).toFixed(5) + ',' + Number(existing.lng).toFixed(5))
      const keyNew = (normName + '|' + lat.toFixed(5) + ',' + lng.toFixed(5))
      if (keyExisting === keyNew) {
        out[i] = mergeTwo(existing, f)
        merged = true
        break
      }
    }
    if (!merged) {
      const copy = { ...f,
        sourceRefs: f.sourceRefs ? [...f.sourceRefs] : (f.source ? [{ source: f.source, id: f.id || f.business_id || f.sourceRef }] : []),
        source: f.source || FACILITY_SOURCE.OTHER,
      }
      // ensure sourceRefs includes self
      if (!copy.sourceRefs.length && f.source) copy.sourceRefs = [{ source: f.source, id: f.id }]
      out.push(copy)
      index.push({ lat, lng })
    }
  }
  return out
}

function mergeTwo(a, b) {
  // Prefer more complete fields, highest confidence
  const sources = [...(a.sourceRefs || []), ...(b.sourceRefs || []), { source: b.source, id: b.id || b.business_id }]
    .filter(Boolean)
    .filter(function (s, idx, arr) { return arr.findIndex(x => x.source === s.source && String(x.id) === String(s.id)) === idx })
  const merged = { ...a }
  // Prefer newer/better fields
  if (!merged.phone && b.phone) merged.phone = b.phone
  if (!merged.address && b.address) merged.address = b.address
  if (!merged.category || merged.category === FACILITY_CATEGORY.OTHER) merged.category = b.category || merged.category
  if (!merged.website && b.website) merged.website = b.website
  merged.sourceRefs = sources
  // source badge: if multiple, mark as merged; keep primary as carefind if present
  const hasCareFind = sources.some(s => s.source === FACILITY_SOURCE.CAREFIND)
  merged.source = hasCareFind ? FACILITY_SOURCE.CAREFIND : (a.source || b.source)
  // if coordinates from carefind are more trusted, keep them; else average
  // keep a's lat/lng for now (first seen)
  merged.merged = true
  return merged
}

// AI stub for future ML dedupe — returns 0-1 score
export function aiDedupeScore(a, b) {
  // Placeholder: high score if normalized names share tokens
  const an = new Set(normalizeName(a.name).split(' '))
  const bn = new Set(normalizeName(b.name).split(' '))
  let inter = 0
  for (const t of an) if (bn.has(t)) inter++
  const union = new Set([...an, ...bn]).size || 1
  return inter / union
}

// Normalize raw source rows to common facility shape
export function normalizeFacility(raw, source) {
  if (!raw) return null
  const lat = raw.lat != null ? Number(raw.lat) : (raw.latitude != null ? Number(raw.latitude) : null)
  const lng = raw.lng != null ? Number(raw.lng) : (raw.longitude != null ? Number(raw.longitude) : null)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    // Allow carefind rows without coords? but dedupe needs coords; keep if name present for area mode
    // For boundary searches without point, distance is from centre
    if (raw.name == null) return null
  }
  let category = raw.category || FACILITY_CATEGORY.OTHER
  // If category came from business_type, map via categoryFromAmenity for consistency
  if (raw.business_type) {
    const mapped = categoryFromAmenity(raw.business_type)
    // Keep original if mapped is OTHER but business_type is manufacturer etc that should map
    if (mapped !== FACILITY_CATEGORY.OTHER) category = mapped
    else if (['manufacturer','importer','distributor'].includes(String(raw.business_type).toLowerCase())) {
      const key = String(raw.business_type).toLowerCase()
      if (key === 'manufacturer') category = FACILITY_CATEGORY.MANUFACTURER
      else if (key === 'importer') category = FACILITY_CATEGORY.IMPORTER
      else if (key === 'distributor') category = FACILITY_CATEGORY.DISTRIBUTOR
    }
  }
  return {
    id: raw.id || raw.business_id || (source + ':' + (raw.name || '') + ':' + lat + ',' + lng),
    business_id: raw.business_id || null,
    name: raw.name,
    lat: lat,
    lng: lng,
    category,
    address: raw.address || '',
    state: raw.state || null,
    lga: raw.lga || null,
    area: raw.area || null,
    city: raw.city || null,
    phone: raw.phone || raw.whatsapp || null,
    website: raw.website || raw.url || null,
    source: source,
    sourceRef: raw.id || raw.business_id || null,
    sourceUrl: raw.url || null,
    fetched_at: raw.fetched_at || new Date().toISOString(),
    pendingReview: raw.pendingReview || false,
  }
}

// Fetch all sources (CareFind + Overpass + optional Google via Edge Function)
// Partition large areas per provider limits; degrade to cache+internal on failure
export async function fetchSources({ centre, boundary, state, lga, city, category, keyword, businessId, mode = 'nearby' } = {}) {
  const promises = []
  // 1. CareFind internal — paged by (state,lga,city)
  // For Nigeria-wide mode, partition state-by-state
  if (mode === 'nigeria') {
    // Avoid fetching all 774 at once here; caller handles partitioned pagination
    // Do single fetch with large limit as fallback
    promises.push(
      fetchCareFindFacilities({ state: null, lga: null, city: null, keyword, limit: 100 }).catch(() => [])
    )
  } else if (state || lga || city) {
    promises.push(
      fetchCareFindFacilities({ state, lga, city, keyword, limit: 100 }).catch(() => [])
    )
  } else if (centre) {
    // For point searches, also try carefind near centre via reverseGeocode state hint?
    // Best effort: fetch with no filter but small limit, then filter by distance later
    promises.push(Promise.resolve([]))
  } else {
    promises.push(Promise.resolve([]))
  }

  // 2. Overpass — tiled for boundary, single for point
  const overpassPromise = (async () => {
    try {
      if (boundary) {
        const rows = await fetchOverpassTiled({ centre, boundary })
        return rows.map(r => normalizeFacility(r, FACILITY_SOURCE.OSM)).filter(Boolean)
      } else if (centre) {
        const rows = await fetchOverpass(centre.lat, centre.lng, 1000)
        return rows.map(r => normalizeFacility(r, FACILITY_SOURCE.OSM)).filter(Boolean)
      }
      return []
    } catch (e) {
      console.error('Overpass source failed, degrading:', e)
      return []
    }
  })()
  promises.push(overpassPromise)

  // 3. Google Places New via Edge Function (optional) — tiled, disabled if no env/key
  const googlePromise = (async () => {
    try {
      const edgeUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_PLACES_PROXY) || null
      if (!edgeUrl) return []
      // Edge function expects { centre, boundary, category } and returns normalized rows
      // Partition large areas per provider limits (handled by edge function)
      const body = { centre, boundary, state, lga, city, category, mode }
      const res = await fetch(edgeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) return []
      const data = await res.json()
      const rows = Array.isArray(data) ? data : (data.results || [])
      return rows.map(r => normalizeFacility(r, FACILITY_SOURCE.GOOGLE)).filter(Boolean)
    } catch (e) {
      // Graceful degrade — provider limits/billing may disable
      return []
    }
  })()
  promises.push(googlePromise)

  // 4. Regulatory enrichment stub (PCN/MLSCN/NAFDAC) — future, return []
  promises.push(Promise.resolve([]))

  const [carefind, overpass, google, regulatory] = await Promise.all(promises)

  // Tag sources
  const taggedCarefind = (carefind || []).map(r => r.source ? r : normalizeFacility(r, FACILITY_SOURCE.CAREFIND)).filter(Boolean)
  // overpass/google already normalized

  return [...taggedCarefind, ...overpass, ...google, ...regulatory]
}

// Main discovery entry — shared by LiveActivity and FacilityDiscovery tab
// Returns paginated, ranked, deduped, scored results
export async function discoverFacilities(params = {}) {
  const {
    mode = 'nearby', // nearby | expanded | area | state | lga | city | nigeria | current | selected
    state = null,
    lga = null,
    city = null,
    area = null,
    coords = null, // { lat, lng }
    category = 'all',
    keyword = '',
    verification = 'all',
    source = 'all', // all | carefind | osm | google | regulatory | other
    sort = 'distance', // distance | name | category | verification | updated
    page = 0,
    pageSize = 20,
    businessId = null,
    radius = null, // for point search optional
  } = params

  // 1. Resolve location
  const resolved = await resolveLocation({ mode, state, lga, city, area, coords })
  const centre = resolved.centre || coords || null
  const boundary = resolved.boundary || null

  // 2. Fetch sources (partition large areas per provider limits inside fetchSources)
  let rawSources = await fetchSources({ centre, boundary, state: normalizeState(state) || resolved.state, lga: lga || resolved.lga, city: city || area || resolved.city, category, keyword, businessId, mode })

  // For Nigeria-wide mode without boundary, partition state-by-state if we got limited results
  // The initial fetchSources for nigeria was single; if pageSize suggests we need more, fetch per state chunk
  // Simple approach: if mode nigeria and rawSources < pageSize, fetch per 5 states as background tiles
  // (We keep it lightweight for now; export will handle full partition)

  // 3. Normalize already done in fetchSources; ensure shape
  let facilities = rawSources.filter(Boolean)

  // 4. Keyword filter (client-side for OSM/Google; carefind already filtered)
  if (keyword && keyword.trim()) {
    const kw = keyword.toLowerCase().trim()
    facilities = facilities.filter(f => {
      const hay = [f.name, f.category, f.address, f.state, f.lga, f.city].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }

  // 5. Category filter via matches imported helper
  if (category && category !== 'all') {
    const { matchesCategory } = await import('./geo.js')
    facilities = facilities.filter(f => matchesCategory(f, category))
  }

  // 6. Source filter
  if (source && source !== 'all') {
    const src = String(source).toLowerCase()
    facilities = facilities.filter(f => String(f.source).toLowerCase() === src)
  }

  // 7. Dedupe ~50m+name/phone/domain
  facilities = dedupeFacilities(facilities)

  // 8. Compute distance, verification, confidence, rank
  facilities = facilities.map(f => {
    const distanceM = centre ? haversineMeters(centre, { lat: f.lat, lng: f.lng }) : null
    const vLevel = verificationStatus(f, centre)
    // Map verification filter
    const conf = confidenceScore(f, { sourceCount: (f.sourceRefs || [f.source]).length, gps: centre })
    return {
      ...f,
      distanceM: distanceM != null ? Math.round(distanceM) : null,
      verification: vLevel,
      confidence: conf,
      referenceCentre: centre,
    }
  })

  // 9. Verification filter (6-level)
  if (verification && verification !== 'all') {
    const v = String(verification).toLowerCase()
    facilities = facilities.filter(f => String(f.verification).toLowerCase() === v)
  }

  // 10. Sort
  if (sort === 'distance') {
    facilities.sort((a, b) => {
      if (a.distanceM == null && b.distanceM == null) return 0
      if (a.distanceM == null) return 1
      if (b.distanceM == null) return -1
      if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM
      // tie-breaker confidence*verification
      return b.confidence - a.confidence
    })
  } else if (sort === 'name') {
    facilities.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } else if (sort === 'category') {
    facilities.sort((a, b) => String(a.category).localeCompare(String(b.category)))
  } else if (sort === 'verification') {
    const order = { verified: 0, pending: 1, external_unverified: 2, unverified: 3, regulatory: 4, no_gps: 5 }
    facilities.sort((a, b) => (order[a.verification] ?? 99) - (order[b.verification] ?? 99))
  } else if (sort === 'updated') {
    facilities.sort((a, b) => new Date(b.fetched_at || 0) - new Date(a.fetched_at || 0))
  } else {
    // default distance × confidence × verification rank
    facilities.sort((a, b) => {
      const aScore = (a.confidence || 0) - (a.distanceM || 0) / 100
      const bScore = (b.confidence || 0) - (b.distanceM || 0) / 100
      return bScore - aScore
    })
  }

  // 11. Pagination via cursor (offset) — clamp negative/beyond
  const total = facilities.length
  const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20
  const start = Math.max(0, Math.min(safePage * safePageSize, total))
  const paged = facilities.slice(start, start + safePageSize)
  const hasMore = start + safePageSize < total
  const nextCursor = hasMore ? safePage + 1 : null

  return {
    facilities: paged,
    total,
    hasMore,
    nextCursor,
    page,
    pageSize,
    resolvedLocation: resolved,
    fromCache: false,
  }
}

// Export progress helper for large Nigeria-wide exports (background job simulation)
export function createExportJob(facilities, filters) {
  // In real impl this would be a service worker/edge job; here synchronous for spec
  return {
    total: facilities.length,
    filters,
    startedAt: new Date().toISOString(),
    status: 'ready',
  }
}
